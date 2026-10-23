// Wireless: radios and their access points from uci `wireless`, joined with
// what the driver reports (iwinfo) and who is connected.

import { call } from './ubus'
import * as uci from './uci'

export interface WifiNetwork {
  section: string
  ssid: string
  key: string
  encryption: string
  hidden: boolean
  disabled: boolean
  network: string
  ifname: string | null
  clients: number
  /** on Home (network lan): a main Wi-Fi band; others belong to Networks */
  main: boolean
  guest: boolean
}

export interface WifiRadio {
  name: string
  band: string
  channel: string
  htmode: string
  country: string
  disabled: boolean
  htmodes: string[]
  channels: { channel: number; mhz: number }[]
  txpower: number | null
  /** aw1000-mesh uses this radio; channel and width are the mesh's. */
  meshOwned: boolean
  networks: WifiNetwork[]
}

interface IwInfo {
  htmodes?: string[]
  hwmodes?: string[]
  txpower?: number
}

export async function wifiRadios(): Promise<WifiRadio[]> {
  const [conf, live] = await Promise.all([
    uci.getConfig('wireless'),
    call<Record<string, { interfaces: { section: string; ifname?: string }[] }>>('network.wireless', 'status'),
  ])
  const sections = Object.values(conf)
  const ifnameOf = (sec: string) => Object.values(live).flatMap((r) => r.interfaces).find((i) => i.section === sec)?.ifname ?? null

  const radios = sections.filter((s) => s['.type'] === 'wifi-device')
  return Promise.all(
    radios.map(async (r) => {
      const ifaces = sections.filter((s) => s['.type'] === 'wifi-iface' && s.device === r['.name'])
      const aps = ifaces.filter((s) => s.mode === 'ap')
      const probe = aps.map((a) => ifnameOf(a['.name'])).find(Boolean) ?? null
      const [info, freq] = probe
        ? await Promise.all([
            call<IwInfo>('iwinfo', 'info', { device: probe }).catch(() => ({}) as IwInfo),
            call<{ results: { channel: number; mhz: number; restricted: boolean }[] }>('iwinfo', 'freqlist', { device: probe }).catch(() => ({ results: [] })),
          ])
        : [{} as IwInfo, { results: [] }]
      const networks = await Promise.all(
        aps.map(async (a) => {
          const ifname = ifnameOf(a['.name'])
          const assoc = ifname ? await call<{ results: unknown[] }>('iwinfo', 'assoclist', { device: ifname }).catch(() => ({ results: [] })) : { results: [] }
          const net = String(a.network ?? '')
          return {
            section: a['.name'],
            ssid: String(a.ssid ?? ''),
            key: String(a.key ?? ''),
            encryption: String(a.encryption ?? 'none'),
            hidden: a.hidden === '1',
            disabled: a.disabled === '1',
            network: net,
            ifname,
            clients: assoc.results.length,
            main: net === 'lan',
            guest: net !== 'lan' && (/guest/i.test(net) || /guest/i.test(a['.name'])),
          }
        }),
      )
      // Offer the widths of the newest standard the radio speaks.
      const std = info.hwmodes?.includes('ax') ? 'HE' : info.hwmodes?.includes('ac') ? 'VHT' : 'HT'
      return {
        name: r['.name'],
        band: String(r.band ?? ''),
        channel: String(r.channel ?? 'auto'),
        htmode: String(r.htmode ?? ''),
        country: String(r.country ?? ''),
        disabled: r.disabled === '1',
        htmodes: (info.htmodes ?? []).filter((h) => h.replace(/\d+$/, '') === std),
        channels: freq.results.filter((f) => !f.restricted).map((f) => ({ channel: f.channel, mhz: f.mhz })),
        txpower: info.txpower ?? null,
        meshOwned: ifaces.some((s) => s.mode === 'mesh' && s.disabled !== '1'),
        networks,
      }
    }),
  )
}

export interface WifiChange {
  radio: string
  radioValues: Record<string, string>
  section: string
  values: Record<string, string>
  drop: string[]
}

/**
 * Stage and apply one card's changes. `safe` uses rollback (right for
 * channel/width or when you're on another network); unsafe applies at once,
 * for SSID/password changes of the Wi-Fi this browser is on, where a
 * rollback would always fire because the browser loses the network.
 */
export async function saveWifi(c: WifiChange, safe: boolean): Promise<void> {
  try {
    if (Object.keys(c.radioValues).length) await uci.set('wireless', c.radio, c.radioValues)
    if (Object.keys(c.values).length) await uci.set('wireless', c.section, c.values)
    await uci.del('wireless', c.section, c.drop)
  } catch (e) {
    await uci.revert('wireless').catch(() => undefined)
    throw e
  }
  if (safe) await uci.applyWithRollback(30)
  else await uci.applyNow()
}

/**
 * One name and password on several bands ("same name on both bands"): the
 * same values and removals staged on every section, then applied once, so
 * the bands never sit on different settings between two applies.
 */
export async function saveWifiShared(sections: string[], values: Record<string, string>, drop: string[], safe: boolean): Promise<void> {
  try {
    for (const s of sections) {
      await uci.set('wireless', s, values)
      await uci.del('wireless', s, drop)
    }
  } catch (e) {
    await uci.revert('wireless').catch(() => undefined)
    throw e
  }
  if (safe) await uci.applyWithRollback(30)
  else await uci.applyNow()
}
