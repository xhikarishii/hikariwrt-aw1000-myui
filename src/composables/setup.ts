// The setup wizard's state: what the router has now, what you've chosen,
// whether each step is valid, and the ordered apply. Nothing touches the
// router until apply(); leaving the wizard midway changes nothing.
//
// Apply order is chosen so the browser keeps its connection as long as
// possible: password, name/time, WAN, APN, the 5G IP arrangement, multi-WAN
// and the "setup done" flag all leave LAN and Wi-Fi alone, and Wi-Fi goes
// last with applyNow() (not rollback) because changing the SSID/key (or the
// country) of the network this browser is on disconnects it, which would make
// a rollback always fire.
//
// The Storage step offers a drive plugged into the router for the histories
// the router keeps - monitoring (speed test results included), 5G data usage - and, when it
// has to be, mounts or formats it first. Its tasks run after the network
// ones and before Wi-Fi.
//
// The country chosen on the "Name and time" step is used twice: as the Wi-Fi
// regulatory domain (which channels and power are legal) and to pick the
// carrier list the 5G APN comes from - so the two can't disagree.

import { computed, reactive, ref, watch } from 'vue'
import * as uci from '@/api/uci'
import * as sys from '@/api/system'
import * as modem from '@/api/modem'
import {
  multiwanFull, saveMultiwan, saveWan, saveWanMac, setWanAsLan, wanConfig, wanMac, wanPort,
  type MultiwanFull, type WanConfig, type WanMac, type WanPort,
} from '@/api/wan'
import { wifiRadios, type WifiRadio } from '@/api/wifi'
import * as storageApi from '@/api/storage'
import * as monitor from '@/api/monitor'
import { speedStatus, type SpeedStatus } from '@/api/services'
import { driveOffers, driveTitle, firstPartition, needsFormat } from '@/utils/drive'
import { markSetupDone, wanCarrier } from '@/api/setup'
import { useSession } from '@/stores/session'
import { dnsError, ipError, keyError, macError, mtuError, netmaskError, normalizeMac, parseList, ssidError } from '@/utils/validate'
import { countryByIso, guessCountry } from '@/utils/countries'

export type StepId = 'welcome' | 'password' | 'system' | 'internet' | 'wifi' | 'storage' | 'review'
export const STEPS: { id: StepId; title: string; lead: string }[] = [
  { id: 'welcome', title: 'Welcome', lead: 'A few minutes to get your router ready. Nothing changes until the last step.' },
  { id: 'password', title: 'Admin password', lead: 'Protects these settings. You’ll use it to sign in here, in LuCI and over SSH.' },
  { id: 'system', title: 'Name, country and time', lead: 'What the router is called on your network, and where it is. The country sets which Wi-Fi channels are allowed.' },
  { id: 'internet', title: 'Internet', lead: 'How the router connects: a cable from your ISP, the 5G SIM, or both.' },
  { id: 'wifi', title: 'Wi-Fi', lead: 'The network your devices join.' },
  { id: 'storage', title: 'Storage', lead: 'A USB drive or SD card for the history your router keeps.' },
  { id: 'review', title: 'Review', lead: 'Check everything, then set it up.' },
]

export type TaskState = 'pending' | 'running' | 'done' | 'failed'
export interface Task {
  id: string
  label: string
  state: TaskState
  error?: string
  run: () => Promise<unknown>
}

interface ApnForm {
  mode: 'auto' | 'list' | 'custom'
  carrier: string
  apn: string
  auth: string
  username: string
  password: string
  pdptype: string
}

/** failover: wired WAN first, 5G takes over when it fails. standalone: 5G only. */
export type Usage = 'failover' | 'standalone'

interface BandForm {
  section: string
  band: string
  ssid: string
  key: string
  encryption: string
}

export function useSetup() {
  const session = useSession()
  const hasModem = computed(() => session.has('luci.aw1000-modem'))

  const loading = ref(true)
  const loadError = ref('')

  // ---- current state (for defaults and "changed") ----
  const orig = reactive({
    system: null as sys.SystemSettings | null,
    wan: null as WanConfig | null,
    radios: [] as WifiRadio[],
    profile: null as modem.ProfileInfo | null,
    modem: null as modem.ModemStatus | null,
    multiwan: null as MultiwanFull | null,
    ipv6: null as modem.Ipv6Info | null,
    wanPort: null as WanPort | null,
    wanMac: null as WanMac | null,
    /** drives plugged in (re-read while the Storage step is open) */
    drives: null as storageApi.StorageStatus | null,
    /** where each history is kept now */
    monStorage: null as monitor.StorageInfo | null,
    usage: null as modem.UsageInfo | null,
    speed: null as SpeedStatus | null,
  })

  // What the router is set up as now: standalone when multi-WAN has the wired
  // WAN turned off or puts 5G first.
  const origUsage = computed<Usage>(() => {
    const f = orig.multiwan?.ifaces ?? []
    const wan = f.find((i) => i.name === 'wan')
    if (orig.wanPort?.inLan) return 'standalone'
    return wan && (!wan.enabled || f[0]?.name === 'wwan0') ? 'standalone' : 'failover'
  })
  // The choice only exists with a modem and multi-WAN to act on it.
  const hasUsage = computed(() => hasModem.value && !!orig.multiwan?.ifaces.some((i) => i.name === 'wwan0') && !!orig.multiwan.ifaces.some((i) => i.name === 'wan'))
  const origCountry = computed(() => orig.radios.find((r) => r.country)?.country?.toUpperCase() ?? '')
  const carriers = ref<modem.Carrier[]>([])
  const zones = ref<Record<string, { tzstring: string }>>({})
  const carrier = ref<boolean | null>(null)

  // ---- the draft ----
  const draft = reactive({
    password: { a: '', b: '' },
    system: { hostname: '', zonename: '', country: '' },
    usage: 'failover' as Usage,
    /** 5G router only: the WAN port joins the LAN bridge as one more LAN port. */
    wanAsLan: true,
    /** The 5G dial: v4only, dual (IPv4 + IPv6), v6only - or split, kept as it is. */
    v6style: 'dual',
    wan: { proto: 'dhcp', username: '', password: '', ipaddr: '', netmask: '255.255.255.0', gateway: '', dns: '', mtu: '', ipv6: true },
    /** The WAN port's MAC: its own, or one the ISP has registered. */
    mac: { mode: 'own' as 'own' | 'custom', value: '' },
    apn: { mode: 'auto', carrier: '', apn: '', auth: 'none', username: '', password: '', pdptype: '' } as ApnForm,
    wifi: { same: true, ssid: '', key: '', encryption: 'sae-mixed', bands: [] as BandForm[] },
    /**
     * A drive for the router's histories. `disk` names it; `format` erases it
     * first (a blank or unreadable drive); the rest say what goes on it.
     * `touched` stops a drive plugged in later from changing a choice made.
     */
    storage: { use: false, disk: '', format: false, monitoring: true, usage: true, touched: false, old: 'keep' as 'keep' | 'fresh' },
  })

  async function load(): Promise<void> {
    loading.value = true
    try {
      const [s, z, w, r, p, m, c, mw, v6, wp, wm, dr, ms, us, sp] = await Promise.all([
        sys.systemSettings().catch(() => null),
        sys.timezones().catch(() => ({})),
        wanConfig(),
        wifiRadios().catch(() => []),
        hasModem.value ? modem.profileinfo().catch(() => null) : Promise.resolve(null),
        hasModem.value ? modem.status().catch(() => null) : Promise.resolve(null),
        wanCarrier(),
        multiwanFull().catch(() => null),
        hasModem.value ? modem.ipv6info().catch(() => null) : Promise.resolve(null),
        wanPort(),
        wanMac(),
        session.has('luci.aw1000-storage') ? storageApi.status().catch(() => null) : Promise.resolve(null),
        session.has('luci.aw1000-monitor') ? monitor.storage().catch(() => null) : Promise.resolve(null),
        hasModem.value ? modem.usageinfo().catch(() => null) : Promise.resolve(null),
        session.has('luci.aw1000-speedtest') ? speedStatus().catch(() => null) : Promise.resolve(null),
      ])
      Object.assign(orig, {
        system: s, wan: w, radios: r, profile: p?.ok ? p : null, modem: m, multiwan: mw, ipv6: v6?.ok ? v6 : null, wanPort: wp, wanMac: wm,
        drives: dr?.ok ? dr : null, monStorage: ms?.ok ? ms : null, usage: us?.ok ? us : null, speed: sp?.ok && sp.persist ? sp : null,
      })
      carriers.value = orig.profile?.carriers ?? []
      zones.value = z
      carrier.value = c

      fill('system')
      fill('internet')
      fill('wifi')
      fill('storage')
      loadError.value = ''
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  /** Put one step's draft back to what the router has (defaults on load, Skip). */
  function fill(step: StepId): void {
    const o = orig
    if (step === 'password') Object.assign(draft.password, { a: '', b: '' })
    if (step === 'system') {
      // A router still on the factory default (UTC) gets this browser's zone.
      const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
      draft.system.hostname = o.system?.hostname ?? 'HikariWrt'
      draft.system.zonename =
        o.system && o.system.zonename !== 'UTC' ? o.system.zonename : browserZone in zones.value ? browserZone : (o.system?.zonename ?? 'UTC')
      draft.system.country = guessCountry({ mcc: o.modem?.mcc, wifi: origCountry.value, locale: navigator.language })?.iso ?? origCountry.value
    }
    if (step === 'internet') {
      draft.usage = origUsage.value
      // Already a 5G router: keep the port where it is. Switching to one:
      // offer the port as a LAN port.
      draft.wanAsLan = origUsage.value === 'standalone' ? !!o.wanPort?.inLan : true
      draft.v6style = o.ipv6?.config.style || 'dual'
      if (o.wan) Object.assign(draft.wan, { ...o.wan, dns: o.wan.dns.join(', ') })
      draft.mac.mode = o.wanMac?.mac ? 'custom' : 'own'
      draft.mac.value = o.wanMac?.mac ?? ''
      const a = o.profile?.apn
      if (a) {
        Object.assign(draft.apn, {
          mode: a.mode === 'list' || a.mode === 'custom' ? a.mode : 'auto',
          carrier: a.carrier,
          apn: a.value,
          auth: a.auth || 'none',
          username: a.username,
          password: '',
          pdptype: a.pdptype || '',
        })
      }
    }
    if (step === 'storage') {
      const offers = driveOffers(o.drives)
      // A drive that can be used as it is (or only needs mounting) is offered
      // switched on; formatting one is never chosen for you.
      const usable = offers.find((x) => !needsFormat(x))
      const first = usable ?? offers[0]
      Object.assign(draft.storage, {
        use: !!usable,
        disk: first?.disk.name ?? '',
        format: false,
        monitoring: !!o.monStorage,
        usage: !!o.usage?.persist,
        touched: false,
        old: 'keep',
      })
    }
    if (step === 'wifi') {
      const aps = o.radios.flatMap((radio) => radio.networks.filter((n) => !n.guest).map((n) => ({ radio, n })))
      draft.wifi.bands = aps.map(({ radio, n }) => ({
        section: n.section,
        band: radio.band,
        ssid: n.ssid,
        key: n.key,
        encryption: n.encryption === 'none' ? 'sae-mixed' : n.encryption,
      }))
      const first = draft.wifi.bands[0]
      draft.wifi.same = new Set(draft.wifi.bands.map((b) => `${b.ssid}\n${b.key}`)).size <= 1
      if (first) Object.assign(draft.wifi, { ssid: first.ssid, key: first.key, encryption: first.encryption })
    }
  }

  // The carrier list follows the chosen country. The router answers with the
  // list for the network the SIM is on, so another country is asked for by
  // its MCC; a carrier picked from the old list is let go.
  watch(
    () => draft.system.country,
    async (iso) => {
      const c = countryByIso(iso)
      if (!hasModem.value || !c || !c.mcc.length) return
      if (orig.profile && c.mcc.includes(orig.profile.mcc)) {
        carriers.value = orig.profile.carriers ?? []
      } else {
        const r = await modem.profileinfoFor(c.mcc[0]!).catch(() => null)
        if (draft.system.country !== iso) return
        carriers.value = r?.ok ? (r.carriers ?? []) : []
      }
      if (draft.apn.mode === 'list' && !carriers.value.some((x) => x.id === draft.apn.carrier)) draft.apn.carrier = ''
    },
  )

  // ---- the Storage step's drives ----
  const offers = computed(() => driveOffers(orig.drives))
  const offer = computed(() => offers.value.find((x) => x.disk.name === draft.storage.disk) ?? null)
  /** Re-read the drives (the step polls this): a drive plugged in now is offered. */
  async function refreshDrives(): Promise<void> {
    const st = await storageApi.status().catch(() => null)
    if (!st?.ok) return
    const had = orig.drives?.disks.map((d) => d.name).join() ?? ''
    orig.drives = st
    if (!draft.storage.touched && st.disks.map((d) => d.name).join() !== had) fill('storage')
  }
  /** Where the histories would go on the chosen drive (null until formatted). */
  const storageTarget = computed(() => {
    const o = offer.value
    if (!o) return null
    if (draft.storage.format) return `/mnt/${firstPartition(o.disk.name)}`
    return o.target
  })

  /**
   * Monitoring history already on the chosen drive from before - this router
   * before a reset, or another one - and not the place in use now. The step
   * asks whether to carry on with it or start afresh; a format erases it anyway.
   */
  const oldHistory = computed(() => {
    const t = storageTarget.value
    if (!t || draft.storage.format) return null
    return orig.monStorage?.found?.find((f) => f.id === t && !f.current) ?? null
  })

  // ---- validation per step ----
  const passwordErrors = computed(() => {
    const { a, b } = draft.password
    if (!a && !b) return session.noPassword ? { a: 'Choose a password', b: null } : { a: null, b: null }
    return { a: a.length < 8 ? 'At least 8 characters' : null, b: b && a !== b ? 'The two don’t match' : !b ? 'Type it again' : null }
  })

  const wanErrors = computed(() => {
    const w = draft.wan
    // 5G only: the wired settings are neither shown nor applied.
    if (draft.usage === 'standalone' && hasUsage.value) return { username: null, ipaddr: null, netmask: null, gateway: null, dns: null, mtu: null, mac: null }
    return {
      username: w.proto === 'pppoe' && !w.username.trim() ? 'Required' : null,
      ipaddr: w.proto === 'static' ? ipError(w.ipaddr) : null,
      netmask: w.proto === 'static' ? netmaskError(w.netmask) : null,
      gateway: w.proto === 'static' ? ipError(w.gateway) : null,
      dns: w.dns.trim() ? dnsError(w.dns) : w.proto === 'static' ? 'Static needs a DNS server' : null,
      mtu: mtuError(w.mtu),
      mac: draft.mac.mode === 'custom' && orig.wanMac ? macError(draft.mac.value) : null,
    }
  })
  const apnError = computed(() => {
    const a = draft.apn
    if (!hasModem.value || a.mode === 'auto') return null
    if (a.mode === 'list') return a.carrier ? null : 'Pick your carrier'
    return /^[A-Za-z0-9._-]+$/.test(a.apn.trim()) ? null : 'Letters, digits, dots, dashes and underscores'
  })

  const wifiErrors = computed(() => {
    const w = draft.wifi
    if (w.same) return { ssid: ssidError(w.ssid), key: keyError(w.key, w.encryption), bands: [] as { ssid: string | null; key: string | null }[] }
    return { ssid: null, key: null, bands: w.bands.map((b) => ({ ssid: ssidError(b.ssid), key: keyError(b.key, b.encryption) })) }
  })

  const valid = computed<Record<StepId, boolean>>(() => ({
    welcome: true,
    password: !passwordErrors.value.a && !passwordErrors.value.b,
    system: /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(draft.system.hostname) && draft.system.zonename in zones.value && !!countryByIso(draft.system.country),
    internet: Object.values(wanErrors.value).every((e) => !e) && !apnError.value,
    wifi: !wifiErrors.value.ssid && !wifiErrors.value.key && wifiErrors.value.bands.every((b) => !b.ssid && !b.key),
    storage:
      !draft.storage.use ||
      (!!offer.value &&
        (!needsFormat(offer.value) || draft.storage.format) &&
        (draft.storage.monitoring || draft.storage.usage)),
    review: true,
  }))

  // ---- what will change ----
  const wanNext = computed<WanConfig>(() => ({
    proto: draft.wan.proto,
    username: draft.wan.username.trim(),
    password: draft.wan.password,
    ipaddr: draft.wan.ipaddr.trim(),
    netmask: draft.wan.netmask.trim(),
    gateway: draft.wan.gateway.trim(),
    dns: parseList(draft.wan.dns),
    mtu: draft.wan.mtu.trim(),
    ipv6: draft.wan.ipv6,
  }))
  /** The MAC the WAN port should use: "" for its own. */
  const macNext = computed(() => (draft.mac.mode === 'custom' ? (normalizeMac(draft.mac.value) ?? '') : ''))
  // Multi-WAN as the chosen use needs it: wired first with 5G behind it, or
  // 5G alone with the wired WAN left out. Balance mode is only replaced when
  // the choice actually changes (see changes.usage).
  const usageNext = computed<MultiwanFull | null>(() => {
    const m = orig.multiwan
    if (!m) return null
    const wan = m.ifaces.find((i) => i.name === 'wan')
    const wwan = m.ifaces.find((i) => i.name === 'wwan0')
    const rest = m.ifaces.filter((i) => i.name !== 'wan' && i.name !== 'wwan0')
    if (!wan || !wwan) return null
    const ifaces =
      draft.usage === 'standalone'
        ? [{ ...wwan, enabled: true }, { ...wan, enabled: false }, ...rest]
        : [{ ...wan, enabled: true }, { ...wwan, enabled: true }, ...rest]
    return { ...m, enabled: true, mode: 'failover', ifaces }
  })
  const wifiNext = computed<BandForm[]>(() =>
    draft.wifi.same ? draft.wifi.bands.map((b) => ({ ...b, ssid: draft.wifi.ssid, key: draft.wifi.key, encryption: draft.wifi.encryption })) : draft.wifi.bands,
  )

  const changes = computed(() => {
    const o = orig
    const wan = o.wan && JSON.stringify(wanNext.value) !== JSON.stringify(o.wan)
    const a = o.profile?.apn
    const apn =
      hasModem.value &&
      !!a &&
      (draft.apn.mode !== (a.mode === 'list' || a.mode === 'custom' ? a.mode : 'auto') ||
        (draft.apn.mode === 'list' && draft.apn.carrier !== a.carrier) ||
        (draft.apn.mode === 'custom' && (draft.apn.apn.trim() !== a.value || draft.apn.auth !== (a.auth || 'none') || draft.apn.username !== a.username || !!draft.apn.password || draft.apn.pdptype !== (a.pdptype || ''))))
    const wifi = wifiNext.value.some((b) => {
      const n = o.radios.flatMap((r) => r.networks).find((x) => x.section === b.section)
      return !n || n.ssid !== b.ssid || n.key !== b.key || n.encryption !== b.encryption
    })
    const standalone = hasUsage.value && draft.usage === 'standalone'
    const p = o.wanPort
    // In the bridge when it should be out, or the other way round. Going back
    // to wired always takes it out: the wired uplink needs its port.
    const lanPort = !!p && (standalone ? draft.wanAsLan !== p.inLan : p.inLan)
    return {
      password: !!draft.password.a,
      system: !!o.system && (draft.system.hostname !== o.system.hostname || draft.system.zonename !== o.system.zonename),
      usage: hasUsage.value && draft.usage !== origUsage.value,
      lanPort,
      wan: !!wan && !standalone,
      mac: !!o.wanMac && !standalone && macNext.value !== o.wanMac.mac,
      apn,
      ipv6: hasModem.value && !!o.ipv6 && draft.v6style !== (o.ipv6.config.style || 'dual'),
      country: !!draft.system.country && o.radios.some((r) => (r.country || '').toUpperCase() !== draft.system.country),
      wifi,
      storage: storageChanges.value.any,
    }
  })

  // What the Storage step would do: prepare the drive, then move each chosen
  // history onto it - only those not already there.
  const storageChanges = computed(() => {
    const d = draft.storage
    const o = offer.value
    const none = { any: false, prepare: null as 'format' | 'mount' | null, monitoring: false, usage: false, wipe: false }
    if (!d.use || !o) return none
    const t = storageTarget.value
    const prepare = d.format ? ('format' as const) : o.state === 'unmounted' ? ('mount' as const) : null
    const ms = orig.monStorage?.persist
    const monitoring = d.monitoring && !!orig.monStorage && !(ms?.enabled && ms.target === t)
    const usage = d.usage && !!orig.usage?.persist && orig.usage.persist.target !== t
    // what an earlier stay on this drive left: kept (merged with what the
    // router has now, when the monitor restarts on it) or deleted first
    const wipe = monitoring && !!oldHistory.value && d.old === 'fresh'
    return { any: !!prepare || monitoring || usage, prepare, monitoring, usage, wipe }
  })

  // ---- apply ----
  const tasks = ref<Task[]>([])
  const applying = ref(false)
  const finished = ref(false)

  function buildTasks(): Task[] {
    const c = changes.value
    const t: Task[] = []
    if (c.password) t.push({ id: 'password', label: 'Set the admin password', state: 'pending', run: () => sys.setPassword(draft.password.a) })
    if (c.system && orig.system) {
      const s = orig.system
      t.push({
        id: 'system',
        label: 'Name the router and set its time zone',
        state: 'pending',
        run: () => sys.saveSystem(s.section, draft.system.hostname, draft.system.zonename, zones.value[draft.system.zonename]?.tzstring ?? 'UTC0'),
      })
    }
    // Before the wired settings, so the ISP sees the address it expects the
    // first time the WAN asks for a lease or dials.
    if (c.mac && orig.wanMac) {
      const w = orig.wanMac
      const mac = macNext.value
      t.push({
        id: 'mac',
        label: mac ? `Give the WAN port the MAC ${mac}` : 'Give the WAN port back its own MAC',
        state: 'pending',
        run: () => saveWanMac(w, mac),
      })
    }
    if (c.wan) t.push({ id: 'wan', label: 'Connect the wired internet', state: 'pending', run: () => saveWan(wanNext.value) })
    if (c.apn) {
      const a = draft.apn
      const row = carriers.value.find((x) => x.id === a.carrier)
      const args =
        a.mode === 'auto'
          ? { mode: 'auto', apn: '', auth: 'none', username: '', password: '', pdptype: '', carrier: '' }
          : a.mode === 'list' && row
            ? { mode: 'list', apn: row.apn, auth: row.auth || 'none', username: row.username ?? '', password: row.password ?? '', pdptype: row.pdptype ?? '', carrier: row.id }
            : { mode: 'custom', apn: a.apn.trim(), auth: a.auth, username: a.username.trim(), password: a.password, pdptype: a.pdptype, carrier: '' }
      t.push({
        id: 'apn',
        label: 'Set up the 5G connection',
        state: 'pending',
        run: async () => {
          const r = await modem.setApn(args)
          if (!r.ok) throw new Error(r.error || 'The modem refused the APN.')
        },
      })
    }
    if (c.ipv6 && orig.ipv6) {
      const cfg = modem.withStyle(orig.ipv6.config, draft.v6style)
      t.push({
        id: 'ipv6',
        label: 'Set the 5G IP version',
        state: 'pending',
        run: async () => {
          const r = await modem.setIpv6(cfg)
          if (!r.ok) throw new Error(r.error || 'The modem refused the IP version.')
        },
      })
    }
    if (c.usage && usageNext.value) {
      const next = usageNext.value
      t.push({
        id: 'usage',
        label: draft.usage === 'standalone' ? 'Use 5G as the only internet' : 'Use the cable first, with 5G as backup',
        state: 'pending',
        run: () => saveMultiwan(next),
      })
    }
    // After multi-WAN has stopped using the wired uplink (or before it starts
    // using it again, which saveMultiwan above does in the same run).
    if (c.lanPort && orig.wanPort) {
      const p = orig.wanPort
      const on = hasUsage.value && draft.usage === 'standalone' && draft.wanAsLan
      t.push({
        id: 'lanport',
        label: on ? 'Turn the WAN port into a LAN port' : 'Give the WAN port back to the wired internet',
        state: 'pending',
        run: () => setWanAsLan(p, on),
      })
    }
    const sc = storageChanges.value
    if (sc.any && offer.value) {
      const o = offer.value
      const name = driveTitle(o.disk)
      // the drive's mountpoint once it's ready: known now, or read back after a format
      let target = storageTarget.value
      if (sc.prepare === 'format')
        t.push({
          id: 'format',
          label: `Erase ${o.disk.name} (${name}) and format it`,
          state: 'pending',
          run: async () => {
            const r = await storageApi.format(o.disk.name, 'ext4', 'HikariWrt', o.disk.name)
            if (!r.ok) throw new Error(r.error || 'The drive could not be formatted.')
            // a background job on the router; it mounts the drive when done
            for (let i = 0; i < 300; i++) {
              await new Promise((ok) => setTimeout(ok, 2000))
              const j = (await storageApi.job().catch(() => null))?.job
              if (j?.state === 'failed') throw new Error(j.error || j.message || 'Formatting failed.')
              if (j?.state === 'done') break
            }
            const st = await storageApi.status()
            const p = st.disks.find((x) => x.name === o.disk.name)?.partitions.find((x) => x.mounted && x.mountpoint)
            if (!p?.mountpoint) throw new Error('The drive was formatted but isn’t mounted; mount it on the Storage page.')
            target = p.mountpoint
            orig.drives = st
          },
        })
      if (sc.prepare === 'mount' && o.part) {
        const part = o.part
        t.push({
          id: 'mount',
          label: `Mount ${part.name} on ${name}`,
          state: 'pending',
          run: async () => {
            const r = await storageApi.mount(part.name)
            if (!r.ok) throw new Error(r.error || 'The drive could not be mounted.')
            const st = await storageApi.status()
            const p = st.disks.flatMap((x) => x.partitions).find((x) => x.name === part.name)
            if (p?.mountpoint) target = p.mountpoint
            orig.drives = st
          },
        })
      }
      // the speed test's results go with the monitoring history (one storage setting)
      const what = [sc.monitoring && (orig.speed ? 'monitoring and speed test' : 'monitoring'), sc.usage && '5G data usage'].filter(Boolean)
      if (what.length)
        t.push({
          id: 'storage',
          label:
            `Keep the ${what.join(', ')} history on ${o.disk.name}` +
            (sc.wipe ? ', deleting what an earlier setup left there' : sc.monitoring && oldHistory.value ? ', carrying on with what’s there' : ''),
          state: 'pending',
          run: async () => {
            if (!target) throw new Error('The drive has no mountpoint yet.')
            if (sc.wipe) {
              const r = await monitor.storageWipe(target)
              if (!r.ok) throw new Error(r.error ? `Old monitoring history: ${r.error}` : 'The old monitoring history could not be deleted.')
            }
            if (sc.monitoring) {
              const p = orig.monStorage?.persist
              const r = await monitor.storageSettings(true, target, p?.days ?? 365, p?.flush_interval ?? 1800)
              if (!r.ok) throw new Error(r.error ? `Monitoring history: ${r.error}` : 'The monitoring history could not be moved.')
            }
            if (sc.usage && orig.usage) {
              const u = orig.usage
              const s = u.settings
              const r = await modem.usageSet({
                enabled: u.enabled,
                limit: s.limit_value ? String(s.limit_value) : '0',
                unit: s.unit,
                reset_day: s.reset_day,
                warn_percent: s.warn_percent,
                sms_notify: s.sms_notify,
                sms_number: s.sms_number ?? '',
                action: s.action === 'disconnect' ? 'disconnect' : 'none',
                retain_days: s.retain_days,
                persist_target: target,
                flush_interval: s.flush_interval,
              })
              if (!r.ok) throw new Error(r.error ? `5G data usage: ${r.error}` : 'The data usage history could not be moved.')
            }
          },
        })
    }
    t.push({ id: 'done', label: 'Remember that setup is finished', state: 'pending', run: () => markSetupDone() })
    if (c.wifi || c.country) {
      const country = draft.system.country
      t.push({
        id: 'wifi',
        label: c.wifi ? 'Restart Wi-Fi with the new name and password' : 'Restart Wi-Fi for the new country',
        state: 'pending',
        run: async () => {
          if (c.wifi) for (const b of wifiNext.value) await uci.set('wireless', b.section, { ssid: b.ssid, key: b.key, encryption: b.encryption })
          // The regulatory domain decides which channels are legal. A channel
          // pinned under the old country may not exist under the new one, and
          // the radio would then not start at all - so it goes back to
          // automatic. Not on a radio the mesh owns: every node has to stay on
          // the mesh's channel, and the Mesh page moves them together.
          if (c.country)
            for (const r of orig.radios) {
              const v: Record<string, string> = { country }
              if (!r.meshOwned && r.channel !== 'auto') v.channel = 'auto'
              await uci.set('wireless', r.name, v)
            }
          // If this browser is on the Wi-Fi being changed, the reply may never
          // arrive: the router got the request, the connection just dropped.
          await Promise.race([uci.applyNow().catch(() => undefined), new Promise((r) => setTimeout(r, 8000))])
        },
      })
    }
    return t
  }

  async function apply(from = 0): Promise<void> {
    if (!from) tasks.value = buildTasks()
    applying.value = true
    for (let i = from; i < tasks.value.length; i++) {
      const task = tasks.value[i]!
      task.state = 'running'
      task.error = undefined
      try {
        await task.run()
        task.state = 'done'
      } catch (e) {
        task.state = 'failed'
        task.error = e instanceof Error ? e.message : String(e)
        if (task.id === 'wifi') await uci.revert('wireless').catch(() => undefined)
        applying.value = false
        return
      }
    }
    applying.value = false
    finished.value = true
    session.noPassword = false
    session.setupDone = true
  }

  const retry = () => apply(tasks.value.findIndex((t) => t.state === 'failed'))

  return {
    loading, loadError, load, fill, orig, zones, carrier, hasModem, hasUsage, carriers, draft,
    passwordErrors, wanErrors, apnError, wifiErrors, valid, changes, wifiNext, macNext,
    offers, offer, refreshDrives, storageTarget, storageChanges, oldHistory,
    tasks, applying, finished, apply, retry,
  }
}

export type SetupState = ReturnType<typeof useSetup>

/** For the Done screen: the network devices should rejoin. */
export function primaryNetwork(s: SetupState): { ssid: string; key: string; encryption: string } | null {
  const b = s.wifiNext.value.find((x) => x.band === '5g') ?? s.wifiNext.value[0]
  return b ? { ssid: b.ssid, key: b.key, encryption: b.encryption } : null
}

/** The router's LAN address, for "open http://…/webui/". */
export async function lanAddress(): Promise<string> {
  try {
    const s = await uci.getSection('network', 'lan')
    return String(s.ipaddr ?? '192.168.1.1').split('/')[0]!
  } catch {
    return window.location.hostname
  }
}
