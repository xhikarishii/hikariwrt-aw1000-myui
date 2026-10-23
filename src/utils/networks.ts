// Networks: extra LANs beside Home, each with its own bridge, subnet, DHCP
// pool, firewall zone and (optionally) Wi-Fi - pure, so it is tested. The
// API (api/networks.ts) reads the router's uci into a Snapshot, asks this
// what a change means, and stages the resulting operations.
//
// The model is the one the AW1000's NSS offloads (see the Phase 0 tests in
// the feed's notes): every network is a plain Linux bridge; a LAN port joins
// it untagged (`lan3`, moved out of Home) or tagged (`lan3.30`, an 802.1Q
// sub-interface, so the port can stay in Home untagged at the same time).
// Bridge VLAN filtering (`vlan_filtering`, `bridge-vlan`, `lan1:t`) has no
// hardware path on this router and breaks NSS Wi-Fi offload, so nothing here
// ever writes it - buildOps() refuses to.
//
// Section names: everything a network owns is named after it, so editing and
// removing find exactly what was made:
//   network   hikari_net_<id>_dev (bridge br-<id>) and interface <id>
//   dhcp      <id>
//   firewall  zone hikari_net_<id> (named <id>), rules hikari_net_<id>_dhcp
//             / _dns / _ntp, forwardings hikari_fwd_<src>__<dst>
//   wireless  hikari_net_<id>_<radio>
//   hikariui  net_<id>: label, kind, the IoT choices
// The guest network api/guest.ts made before this existed keeps its
// hikari_guest* names (legacy), so it shows up here as one more network.

import type { UciSection } from '@/api/uci'
import { keyError, ssidError } from './validate'

export const LAN_PORTS = ['lan1', 'lan2', 'lan3', 'lan4'] as const
export type LanPort = (typeof LAN_PORTS)[number]
export type PortMode = 'off' | 'untagged' | 'tagged'
export type NetKind = 'guest' | 'iot' | 'trusted' | 'custom'

/**
 * What "optimise for IoT" changes (only for kind iot):
 *   compat     WPA2 (no WPA3), no PMF and no 802.11r: what cheap smart-home
 *              chips manage to join
 *   keepAwake  sleepy battery devices aren't dropped: no disconnect on low
 *              ACK, an hour of inactivity allowed
 *   longLeases 24 h DHCP leases, so devices keep their address
 *   ntp        the router answers NTP, so devices without internet keep time
 */
export interface IotOptions {
  compat: boolean
  keepAwake: boolean
  longLeases: boolean
  ntp: boolean
}

export interface NetworkWifi {
  enabled: boolean
  ssid: string
  key: string
  encryption: string
  /** wifi-device sections (radio0, radio1) */
  radios: string[]
  /** clients can't reach each other */
  isolate: boolean
}

export interface NetworkAccess {
  /** may use the internet */
  internet: boolean
  /** may open the router's own pages (and SSH); without it, DHCP/DNS (and NTP) only */
  router: boolean
  /** may reach devices on Home */
  toHome: boolean
  /** Home may reach its devices (to control smart-home gear from a phone) */
  fromHome: boolean
}

export interface NetworkSpec {
  /** netifd interface and firewall zone name */
  id: string
  label: string
  kind: NetKind
  /** first three octets, e.g. "192.168.90"; the router is .1 */
  prefix: string
  /** 802.1Q ID used on tagged ports */
  vid: number | null
  ports: Record<LanPort, PortMode>
  wifi: NetworkWifi
  access: NetworkAccess
  iot: IotOptions
  /** the guest network api/guest.ts made (hikari_guest* names) */
  legacy?: boolean
}

export interface Snapshot {
  network: Record<string, UciSection>
  dhcp: Record<string, UciSection>
  firewall: Record<string, UciSection>
  wireless: Record<string, UciSection>
  hikariui: Record<string, UciSection>
}

/** A bridge something else made (LuCI): shown read-only, its ports are taken. */
export interface ForeignBridge {
  name: string
  ports: string[]
}

export interface Model {
  /** Home (br-lan): the plain ports in it */
  home: { ports: LanPort[]; section: string | null; prefix: string | null }
  networks: NetworkSpec[]
  foreign: ForeignBridge[]
}

// ---------------------------------------------------------------- helpers --

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v ?? '').split(/\s+/)).filter(Boolean)
const isLan = (p: string): p is LanPort => (LAN_PORTS as readonly string[]).includes(p)

/** "lan3.30" -> { port: "lan3", vid: 30 }; "wan" -> { port: "wan", vid: null } */
export function parseVlanDev(dev: string): { port: string; vid: number | null } {
  const m = /^([A-Za-z0-9_-]+)\.(\d{1,4})$/.exec(dev)
  return m ? { port: m[1]!, vid: Number(m[2]) } : { port: dev, vid: null }
}

/** The physical port under a device name: "wan.832" -> "wan", "@wan" stays. */
export const baseDevice = (dev: string) => parseVlanDev(dev).port

export const prefixOf = (ip: unknown) => {
  const a = String(ip ?? '').split('/')[0]!.split('.')
  return a.length === 4 ? a.slice(0, 3).join('.') : null
}

export interface Names {
  dev: string
  bridge: string
  zone: string
  zoneName: string
  dhcpRule: string
  dnsRule: string
  ntpRule: string
  wan: string
  meta: string
  wifi: (radio: string) => string
}

export function names(id: string, legacy = false): Names {
  if (legacy)
    return {
      dev: 'hikari_guest_dev',
      bridge: 'br-guest',
      zone: 'hikari_guest',
      zoneName: 'guest',
      dhcpRule: 'hikari_guest_dhcp',
      dnsRule: 'hikari_guest_dns',
      ntpRule: 'hikari_guest_ntp',
      wan: 'hikari_guest_wan',
      meta: 'net_guest',
      wifi: (r) => `hikari_guest_${r}`,
    }
  const p = `hikari_net_${id}`
  return {
    dev: `${p}_dev`,
    bridge: `br-${id}`,
    zone: p,
    zoneName: id,
    dhcpRule: `${p}_dhcp`,
    dnsRule: `${p}_dns`,
    ntpRule: `${p}_ntp`,
    wan: `hikari_fwd_${id}__wan`,
    meta: `net_${id}`,
    wifi: (r) => `${p}_${r}`,
  }
}

const fwdName = (src: string, dst: string) => `hikari_fwd_${src}__${dst}`
/** fw4 rule names as api/guest.ts wrote them: "Guest-DHCP". */
const cap = (z: string) => z.charAt(0).toUpperCase() + z.slice(1)

// ------------------------------------------------------------------ parse --

const noPorts = (): Record<LanPort, PortMode> => ({ lan1: 'off', lan2: 'off', lan3: 'off', lan4: 'off' })

function bridgeSection(net: Record<string, UciSection>, bridge: string): UciSection | undefined {
  return Object.values(net).find((s) => s['.type'] === 'device' && s.name === bridge)
}

function readNetwork(s: Snapshot, id: string, legacy: boolean): NetworkSpec | null {
  const n = names(id, legacy)
  const iface = s.network[id]
  if (!iface) return null
  const meta = s.hikariui[n.meta]
  const dev = s.network[n.dev] ?? bridgeSection(s.network, n.bridge)
  const ports = noPorts()
  let vid: number | null = meta?.vid ? Number(meta.vid) : null
  for (const p of list(dev?.ports)) {
    const v = parseVlanDev(p)
    if (!isLan(v.port)) continue
    ports[v.port] = v.vid ? 'tagged' : 'untagged'
    if (v.vid) vid = v.vid
  }
  const aps = Object.values(s.wireless).filter((w) => w['.type'] === 'wifi-iface' && w.mode === 'ap' && w.network === id)
  const ap = aps[0]
  const zone = s.firewall[n.zone]
  const fwds = Object.values(s.firewall).filter((f) => f['.type'] === 'forwarding')
  const fwd = (src: string, dst: string) => fwds.some((f) => f.src === src && f.dest === dst)
  const kind = (meta?.kind as NetKind | undefined) ?? (legacy ? 'guest' : 'custom')
  return {
    id,
    label: String(meta?.label ?? (legacy ? 'Guest' : id)),
    kind,
    prefix: prefixOf(iface.ipaddr) ?? '',
    vid,
    ports,
    wifi: {
      enabled: !!ap,
      ssid: String(ap?.ssid ?? ''),
      key: String(ap?.key ?? ''),
      encryption: String(ap?.encryption ?? 'psk2'),
      radios: aps.map((a) => String(a.device)),
      isolate: ap?.isolate === '1',
    },
    access: {
      internet: fwd(n.zoneName, 'wan'),
      router: zone?.input === 'ACCEPT',
      toHome: fwd(n.zoneName, 'lan'),
      fromHome: fwd('lan', n.zoneName),
    },
    iot: {
      compat: meta?.iot_compat === '1',
      keepAwake: meta?.iot_keepawake === '1',
      longLeases: meta?.iot_longleases === '1',
      ntp: meta?.iot_ntp === '1',
    },
    ...(legacy ? { legacy: true } : {}),
  }
}

/** Read Home, every network this page manages, and bridges it doesn't. */
export function parseModel(s: Snapshot): Model {
  const lanDev = bridgeSection(s.network, 'br-lan')
  const home = {
    ports: list(lanDev?.ports).filter(isLan),
    section: lanDev?.['.name'] ?? null,
    prefix: prefixOf(s.network.lan?.ipaddr),
  }
  const networks: NetworkSpec[] = []
  if (s.firewall.hikari_guest && s.network.guest) {
    const g = readNetwork(s, 'guest', true)
    if (g) networks.push(g)
  }
  const ids = new Set<string>()
  for (const sec of Object.values(s.hikariui)) {
    const m = /^net_([a-z][a-z0-9]*)$/.exec(sec['.name'])
    if (m && sec['.type'] === 'network' && m[1] !== 'guest') ids.add(m[1]!)
  }
  for (const sec of Object.values(s.network)) {
    const m = /^hikari_net_([a-z][a-z0-9]*)_dev$/.exec(sec['.name'])
    if (m) ids.add(m[1]!)
  }
  for (const id of [...ids].sort()) {
    const n = readNetwork(s, id, false)
    if (n) networks.push(n)
  }
  const ours = new Set(['br-lan', ...networks.map((n) => names(n.id, n.legacy).bridge)])
  const foreign = Object.values(s.network)
    .filter((d) => d['.type'] === 'device' && d.type === 'bridge' && !ours.has(String(d.name)))
    .map((d) => ({ name: String(d.name), ports: list(d.ports) }))
  return { home, networks, foreign }
}

// ---------------------------------------------------------------- presets --

export const KIND_INFO: Record<NetKind, { title: string; text: string }> = {
  guest: { title: 'Guests', text: 'Internet only. Visitors can’t see your devices, the router’s settings, or each other.' },
  iot: { title: 'Smart home (IoT)', text: 'Cameras, plugs, speakers and sensors, kept apart from your computers and phones, with settings they connect best with.' },
  trusted: { title: 'Trusted', text: 'A second network for your own devices: internet, the router and Home all reachable.' },
  custom: { title: 'Custom', text: 'Start from internet only and choose everything yourself.' },
}

export interface PresetContext {
  hostname: string
  /** radio names with their band ("2g", "5g") */
  radios: { name: string; band: string; disabled?: boolean }[]
  prefix: string
  password: string
}

export function preset(kind: NetKind, id: string, ctx: PresetContext): NetworkSpec {
  const on = ctx.radios.filter((r) => !r.disabled)
  const r24 = on.filter((r) => r.band === '2g').map((r) => r.name)
  const label = KIND_INFO[kind].title.replace(' (IoT)', '')
  const base: NetworkSpec = {
    id,
    label: kind === 'iot' ? 'Smart home' : label,
    kind,
    prefix: ctx.prefix,
    vid: null,
    ports: noPorts(),
    wifi: {
      enabled: true,
      ssid: `${ctx.hostname} ${kind === 'iot' ? 'IoT' : kind === 'guest' ? 'Guest' : kind === 'trusted' ? 'Trusted' : 'Network'}`,
      key: ctx.password,
      encryption: 'sae-mixed',
      radios: on.map((r) => r.name),
      isolate: false,
    },
    access: { internet: true, router: false, toHome: false, fromHome: false },
    iot: { compat: false, keepAwake: false, longLeases: false, ntp: false },
  }
  if (kind === 'guest') base.wifi.isolate = true
  if (kind === 'trusted') base.access = { internet: true, router: true, toHome: true, fromHome: true }
  if (kind === 'iot') {
    // Most smart-home radios are 2.4 GHz only, and many can't do WPA3 or
    // PMF; Home may reach them (to control them), they may not reach Home.
    base.wifi.radios = r24.length ? r24 : base.wifi.radios
    base.wifi.encryption = 'psk2'
    base.access = { internet: true, router: false, toHome: false, fromHome: true }
    base.iot = { compat: true, keepAwake: true, longLeases: true, ntp: true }
  }
  return base
}

/**
 * A free id for a new network of this kind: "iot", "iot2", ... A guest
 * network takes the plain "guest" (with the legacy hikari_guest* names, see
 * names()) when there is none yet, so the Wireless page's guest card and the
 * Home tile keep finding it; that is the caller's choice (isLegacyGuestFree).
 */
export function freeId(kind: NetKind, taken: Set<string>): string {
  const stem = kind === 'custom' ? 'net' : kind
  const free = (id: string) => !taken.has(id) && !RESERVED.includes(id)
  if (free(stem)) return stem
  for (let i = 2; i < 100; i++) if (free(`${stem}${i}`)) return `${stem}${i}`
  return `${stem}${Date.now() % 1000}`
}

/** No guest network yet: a new one can be the classic "guest" (legacy names). */
export const isLegacyGuestFree = (s: Snapshot) => !s.network.guest && !s.firewall.hikari_guest

/** The first free 192.168.x.0/24 from 89 upwards. */
export function pickFreePrefix(used: Iterable<string>): string {
  const u = new Set(used)
  for (let x = 89; x < 255; x++) if (!u.has(`192.168.${x}`)) return `192.168.${x}`
  for (let x = 89; x < 255; x++) if (!u.has(`10.${x}.0`)) return `10.${x}.0`
  return '10.250.0'
}

// ------------------------------------------------------------- validation --

/** Interface and zone names already taken, and words netifd/fw4 reserve. */
export const RESERVED = ['lan', 'wan', 'wan6', 'wwan0', 'loopback', 'guest', 'aw1000pt', 'mesh', 'any', 'all']

export interface ValidateContext {
  /** every netifd interface and firewall zone name in use (other than this network's own) */
  takenIds: Set<string>
  /** /24 prefixes in use by anything other than this network */
  usedPrefixes: Set<string>
  /** other networks' VLAN IDs */
  usedVids: Set<number>
  /** access points each radio already has, not counting this network's */
  apsPerRadio: Record<string, number>
  isNew: boolean
}

export type Errors = Partial<Record<'id' | 'label' | 'prefix' | 'vid' | 'ports' | 'ssid' | 'key' | 'radios', string>>

const privatePrefix = (p: string) => {
  const o = p.split('.').map(Number)
  if (o.length !== 3 || o.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false
  return o[0] === 10 || (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) || (o[0] === 192 && o[1] === 168)
}

export function validate(spec: NetworkSpec, model: Model, ctx: ValidateContext): Errors {
  const e: Errors = {}
  if (ctx.isNew) {
    if (!/^[a-z][a-z0-9]{0,9}$/.test(spec.id)) e.id = 'Lowercase letters and digits, starting with a letter, up to 10'
    else if (ctx.takenIds.has(spec.id) || (RESERVED.includes(spec.id) && !spec.legacy)) e.id = 'That name is taken'
  }
  const label = spec.label.trim()
  if (!label || label.length > 32) e.label = 'A name of 1 to 32 characters'
  if (!privatePrefix(spec.prefix)) e.prefix = 'A private range, like 192.168.90'
  else if (ctx.usedPrefixes.has(spec.prefix)) e.prefix = 'Another network uses this range'
  const tagged = LAN_PORTS.filter((p) => spec.ports[p] === 'tagged')
  if (tagged.length || spec.vid != null) {
    if (spec.vid == null || !Number.isInteger(spec.vid) || spec.vid < 2 || spec.vid > 4094) e.vid = 'A VLAN ID from 2 to 4094'
    else if (ctx.usedVids.has(spec.vid)) e.vid = 'Another network uses this VLAN ID'
  }
  const next = homePortsAfter(model, spec)
  const foreign = LAN_PORTS.filter((p) => spec.ports[p] === 'untagged' && model.foreign.some((b) => b.ports.includes(p)))
  if (foreign.length) e.ports = `${foreign.join(', ')} belongs to a bridge made elsewhere (${model.foreign.find((b) => b.ports.includes(foreign[0]!))!.name})`
  else if (!next.length) e.ports = 'Keep at least one port on your Home network'
  if (spec.wifi.enabled) {
    const s = ssidError(spec.wifi.ssid)
    if (s) e.ssid = s
    const k = keyError(spec.wifi.key, spec.wifi.encryption)
    if (k) e.key = k
    if (!spec.wifi.radios.length) e.radios = 'Pick at least one band'
    else {
      const full = spec.wifi.radios.find((r) => (ctx.apsPerRadio[r] ?? 0) >= 4)
      if (full) e.radios = 'That band already has four Wi-Fi networks'
    }
  }
  return e
}

/** Home's plain ports once this network is saved. */
export function homePortsAfter(model: Model, spec: NetworkSpec | null, removing?: string): LanPort[] {
  return LAN_PORTS.filter((p) => {
    if (spec && spec.ports[p] === 'untagged') return false
    const owner = model.networks.find((n) => n.id !== spec?.id && n.id !== removing && n.ports[p] === 'untagged')
    if (owner) return false
    if (model.foreign.some((b) => b.ports.includes(p))) return model.home.ports.includes(p)
    // Not untagged anywhere else: it is Home's (a port released by a network
    // goes back to Home rather than being left in no bridge at all).
    return true
  })
}

// --------------------------------------------------------------------- ops --

export type Values = Record<string, string | string[]>
export type Op =
  | { op: 'add'; config: string; section: string; type: string; values: Values }
  | { op: 'set'; config: string; section: string; values: Values }
  | { op: 'delete'; config: string; section: string }
  | { op: 'unset'; config: string; section: string; options: string[] }

/** Options this page writes on each kind of section it owns (anything else is left alone). */
const MANAGED: Record<string, string[]> = {
  device: ['name', 'type', 'bridge_empty', 'ports'],
  interface: ['proto', 'device', 'ipaddr', 'netmask'],
  dhcp: ['interface', 'start', 'limit', 'leasetime'],
  zone: ['name', 'network', 'input', 'output', 'forward'],
  rule: ['name', 'src', 'proto', 'dest_port', 'target', 'family'],
  forwarding: ['src', 'dest'],
  'wifi-iface': ['device', 'mode', 'network', 'ssid', 'encryption', 'key', 'isolate', 'ieee80211w', 'ieee80211r', 'disassoc_low_ack', 'max_inactivity'],
  network: ['label', 'kind', 'vid', 'iot_compat', 'iot_keepawake', 'iot_longleases', 'iot_ntp'],
}

const same = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? a.map(String) : String(a ?? '')) === JSON.stringify(Array.isArray(b) ? b.map(String) : String(b ?? ''))

/** Make one section look like `values` (for the options this page manages). */
function sync(ops: Op[], cur: UciSection | undefined, config: string, section: string, type: string, values: Values): void {
  const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v !== '')))
  if (!cur) {
    ops.push({ op: 'add', config, section, type, values: clean })
    return
  }
  const changed = Object.fromEntries(Object.entries(clean).filter(([k, v]) => !same(cur[k], v)))
  if (Object.keys(changed).length) ops.push({ op: 'set', config, section, values: changed })
  const drop = (MANAGED[type] ?? []).filter((k) => k in cur && !(k in clean))
  if (drop.length) ops.push({ op: 'unset', config, section, options: drop })
}

function portsOf(spec: NetworkSpec): string[] {
  return LAN_PORTS.flatMap((p) => (spec.ports[p] === 'untagged' ? [p] : spec.ports[p] === 'tagged' && spec.vid ? [`${p}.${spec.vid}`] : []))
}

/** Every section a network wants, keyed "config/section". */
function desired(spec: NetworkSpec): Map<string, { type: string; values: Values }> {
  const n = names(spec.id, spec.legacy)
  const m = new Map<string, { type: string; values: Values }>()
  const put = (config: string, section: string, type: string, values: Values) => m.set(`${config}/${section}`, { type, values })
  const iot = spec.kind === 'iot'
  put('network', n.dev, 'device', { name: n.bridge, type: 'bridge', bridge_empty: '1', ports: portsOf(spec) })
  put('network', spec.id, 'interface', { proto: 'static', device: n.bridge, ipaddr: `${spec.prefix}.1`, netmask: '255.255.255.0' })
  put('dhcp', spec.id, 'dhcp', {
    interface: spec.id,
    start: '100',
    limit: '150',
    leasetime: iot && spec.iot.longLeases ? '24h' : spec.kind === 'guest' ? '2h' : '12h',
  })
  put('firewall', n.zone, 'zone', { name: n.zoneName, network: [spec.id], input: spec.access.router ? 'ACCEPT' : 'REJECT', output: 'ACCEPT', forward: 'REJECT' })
  if (!spec.access.router) {
    put('firewall', n.dhcpRule, 'rule', { name: `${cap(n.zoneName)}-DHCP`, src: n.zoneName, proto: 'udp', dest_port: '67-68', target: 'ACCEPT', family: 'ipv4' })
    put('firewall', n.dnsRule, 'rule', { name: `${cap(n.zoneName)}-DNS`, src: n.zoneName, proto: ['tcp', 'udp'], dest_port: '53', target: 'ACCEPT' })
    if (iot && spec.iot.ntp) put('firewall', n.ntpRule, 'rule', { name: `${cap(n.zoneName)}-NTP`, src: n.zoneName, proto: 'udp', dest_port: '123', target: 'ACCEPT' })
  }
  if (spec.access.internet) put('firewall', n.wan, 'forwarding', { src: n.zoneName, dest: 'wan' })
  if (spec.access.toHome) put('firewall', fwdName(n.zoneName, 'lan'), 'forwarding', { src: n.zoneName, dest: 'lan' })
  if (spec.access.fromHome) put('firewall', fwdName('lan', n.zoneName), 'forwarding', { src: 'lan', dest: n.zoneName })
  if (spec.wifi.enabled)
    for (const radio of spec.wifi.radios) {
      const compat = iot && spec.iot.compat
      const enc = compat && spec.wifi.encryption !== 'none' ? 'psk2' : spec.wifi.encryption
      const v: Values = { device: radio, mode: 'ap', network: spec.id, ssid: spec.wifi.ssid, encryption: enc, isolate: spec.wifi.isolate ? '1' : '0' }
      if (enc !== 'none') v.key = spec.wifi.key
      if (compat) Object.assign(v, { ieee80211w: '0', ieee80211r: '0' })
      if (iot && spec.iot.keepAwake) Object.assign(v, { disassoc_low_ack: '0', max_inactivity: '3600' })
      put('wireless', n.wifi(radio), 'wifi-iface', v)
    }
  put('hikariui', n.meta, 'network', {
    label: spec.label.trim(),
    kind: spec.kind,
    vid: spec.vid ? String(spec.vid) : '',
    iot_compat: iot && spec.iot.compat ? '1' : '',
    iot_keepawake: iot && spec.iot.keepAwake ? '1' : '',
    iot_longleases: iot && spec.iot.longLeases ? '1' : '',
    iot_ntp: iot && spec.iot.ntp ? '1' : '',
  })
  return m
}

/** Every section a network owns now: by name, plus forwardings to or from its zone. */
function owned(s: Snapshot, spec: { id: string; legacy?: boolean }): string[] {
  const n = names(spec.id, spec.legacy)
  const keys: string[] = []
  const has = (config: keyof Snapshot, section: string) => !!s[config][section] && keys.push(`${config}/${section}`)
  has('network', n.dev)
  has('network', spec.id)
  has('dhcp', spec.id)
  has('firewall', n.zone)
  has('firewall', n.dhcpRule)
  has('firewall', n.dnsRule)
  has('firewall', n.ntpRule)
  has('hikariui', n.meta)
  for (const f of Object.values(s.firewall))
    if (f['.type'] === 'forwarding' && (f.src === n.zoneName || f.dest === n.zoneName) && /^hikari_(fwd_|guest_wan$)/.test(f['.name'])) keys.push(`firewall/${f['.name']}`)
  for (const w of Object.values(s.wireless)) if (w['.type'] === 'wifi-iface' && w['.name'].startsWith(n.wifi('')) && w.network === spec.id) keys.push(`wireless/${w['.name']}`)
  return keys
}

/** Home's bridge (and any of our other networks' bridges) as the port moves leave them. */
function syncPorts(s: Snapshot, model: Model, ops: Op[], spec: NetworkSpec | null, removing?: string): void {
  const homeNext = homePortsAfter(model, spec, removing)
  if (model.home.section) {
    const cur = s.network[model.home.section]!
    // Home keeps any tagged members it has (lanN.V a user added in LuCI).
    const keep = list(cur.ports).filter((p) => !isLan(p))
    const want = [...homeNext, ...keep]
    if (!same(list(cur.ports), want)) ops.push({ op: 'set', config: 'network', section: model.home.section, values: { ports: want } })
  }
  // Other networks of ours lose a port this one now takes untagged.
  for (const other of model.networks) {
    if (other.id === spec?.id || other.id === removing) continue
    const taken = LAN_PORTS.filter((p) => other.ports[p] === 'untagged' && spec?.ports[p] === 'untagged')
    if (!taken.length) continue
    const n = names(other.id, other.legacy)
    const ports = portsOf({ ...other, ports: { ...other.ports, ...Object.fromEntries(taken.map((p) => [p, 'off'])) } })
    ops.push({ op: 'set', config: 'network', section: n.dev, values: { ports } })
  }
}

/** Refuse anything the NSS can't offload or the mesh preflight rejects. */
function assertSafe(ops: Op[]): Op[] {
  for (const o of ops) {
    const v = o.op === 'add' || o.op === 'set' ? o.values : {}
    for (const p of list(v.ports)) if (p.includes(':')) throw new Error(`refusing bridge VLAN filtering syntax (${p})`)
    if ('vlan_filtering' in v) throw new Error('refusing vlan_filtering')
    if (o.op === 'add' && o.type === 'bridge-vlan') throw new Error('refusing bridge-vlan')
  }
  return ops
}

/** Operations that make the router match `spec` (create or edit). */
export function buildSaveOps(s: Snapshot, model: Model, spec: NetworkSpec, extras: { ntpServer?: boolean } = {}): Op[] {
  const ops: Op[] = []
  const want = desired(spec)
  const have = owned(s, spec)
  // deletions first: a wifi-iface or rule this network no longer wants
  for (const key of have) {
    if (want.has(key)) continue
    const [config, section] = key.split('/') as [string, string]
    ops.push({ op: 'delete', config, section })
  }
  for (const [key, d] of want) {
    const [config, section] = key.split('/') as [keyof Snapshot, string]
    sync(ops, s[config][section], config, section, d.type, d.values)
  }
  syncPorts(s, model, ops, spec)
  if (extras.ntpServer) ops.push({ op: 'set', config: 'system', section: 'ntp', values: { enable_server: '1' } })
  return assertSafe(ops)
}

/** Operations that remove a network; its untagged ports go back to Home. */
export function buildRemoveOps(s: Snapshot, model: Model, id: string): Op[] {
  const spec = model.networks.find((n) => n.id === id)
  if (!spec) return []
  const ops: Op[] = owned(s, spec).map((key) => {
    const [config, section] = key.split('/') as [string, string]
    return { op: 'delete' as const, config, section }
  })
  syncPorts(s, model, ops, null, id)
  return assertSafe(ops)
}

/** Whether a change moves ports (and so may cut off a wired browser): longer rollback, stronger warning. */
export function movesPorts(model: Model, spec: NetworkSpec | null, removing?: string): boolean {
  const before = model.home.ports.join(' ')
  const after = homePortsAfter(model, spec, removing).join(' ')
  const cur = model.networks.find((n) => n.id === (spec?.id ?? removing))
  const tagChange = spec ? LAN_PORTS.some((p) => (cur?.ports[p] ?? 'off') !== spec.ports[p]) : false
  return before !== after || tagChange
}
