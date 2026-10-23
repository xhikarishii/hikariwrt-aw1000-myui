// Everything else the pages read or switch: multi-WAN, speed test, VPN,
// storage, mesh, ad blocking, Wi-Fi, CPU. Types list only what the UI reads.

import { call } from './ubus'
import * as uci from './uci'

// ---- multi-WAN (aw1000-multiwan): status file + uci `multiwan` ----

export interface MultiwanIface {
  name: string
  interface?: string
  /** ipv4 or ipv6: multi-WAN watches each family of a link as its own entry. */
  family?: 'ipv4' | 'ipv6' | string
  label: string
  status: string
  device: string
  ipaddr: string | null
  gateway: string | null
  metric: number
  weight: number
  latency: number | null
  since: number | null
  active: boolean
}

export interface MultiwanStatus {
  mode: string
  enabled: number
  internet: boolean
  updated: number
  interfaces: MultiwanIface[]
  active_ipv4: string
}

/** null when multiwand isn't installed or hasn't written its status yet. */
export async function multiwanStatus(): Promise<MultiwanStatus | null> {
  try {
    const r = await call<{ data: string }>('file', 'read', { path: '/var/run/multiwan/status.json' })
    return JSON.parse(r.data) as MultiwanStatus
  } catch {
    return null
  }
}

export interface MultiwanConfig {
  mode: 'failover' | 'balance'
  notify: { enabled: boolean; recipients: string[] }
}

export async function multiwanConfig(): Promise<MultiwanConfig | null> {
  try {
    const v = await uci.getConfig('multiwan')
    const g = v.globals
    const n = v.notify
    const rec = n?.recipient
    return {
      mode: g?.mode === 'balance' ? 'balance' : 'failover',
      notify: { enabled: n?.enabled === '1', recipients: Array.isArray(rec) ? rec : rec ? [rec] : [] },
    }
  } catch {
    return null
  }
}

/** multiwand has a procd reload trigger, so a commit applies it. */
export async function setMultiwanMode(mode: 'failover' | 'balance'): Promise<void> {
  await uci.set('multiwan', 'globals', { mode })
  await uci.commit('multiwan')
}

// ---- speed test (luci.aw1000-speedtest, Ookla CLI) ----

export interface SpeedIface {
  name: string
  label: string
  device: string
  available: boolean
  reason: string
}

/** Bandwidths are bytes per second (Ookla's unit). */
export interface SpeedResult {
  ok: boolean
  started: number
  interface: string
  download?: number
  upload?: number
  latency?: number
  jitter?: number
  loss?: number
  isp?: string
  server?: string
  location?: string
  /** the result on speedtest.net */
  url?: string
  /** run by the schedule */
  auto?: boolean
  /** what the test moved, both ways */
  bytes?: number
  error?: string
}

export interface SpeedStatus {
  ok: boolean
  accepted: boolean
  installed: boolean
  running: boolean
  run?: {
    interface: string
    /** started by the schedule */
    auto?: boolean
    started: number
    stage: string
    progress: number | null
    latency: number | null
    download: number | null
    upload: number | null
    server: string
    isp: string
  }
  results: SpeedResult[]
  /** results kept (10, 25, 50 or 100) */
  keep?: number
  /**
   * where the results are kept beyond RAM; shared: by the monitoring
   * history's one storage setting (Monitoring -> Storage)
   */
  persist?: { shared?: boolean; enabled: boolean; target: string; path: string; kind: 'flash' | 'usb' | 'drive'; flush_interval: number; cards: boolean }
  /** testing by itself: every `interval` hours over `ifaces`; set on LuCI's Monitoring -> Speed test */
  schedule?: SpeedSchedule
}

export interface SpeedSchedule {
  enabled: boolean
  /** hours: 1, 3, 6, 12 or 24 */
  interval: number
  ifaces: string[]
  /** the slot last run, and the next (null when off), epoch s */
  last: number | null
  next: number | null
  /** per uplink, from its last tests: bytes a test, and a day at this interval */
  estimate: { iface: string; per_test: number; per_day: number }[]
}

export type SpeedRange = '24h' | '7d' | '30d' | '90d' | '365d'

/** One uplink in the history: per bucket the mean and low-high of each, in Mbps and ms. */
export interface SpeedHistoryIface {
  name: string
  label: string
  tests: number
  failed: number
  last: number | null
  download: (number | null)[]
  download_min: (number | null)[]
  download_max: (number | null)[]
  upload: (number | null)[]
  upload_min: (number | null)[]
  upload_max: (number | null)[]
  latency: (number | null)[]
  latency_min: (number | null)[]
  latency_max: (number | null)[]
  summary: Record<'download' | 'upload' | 'latency', { avg: number; min: number; max: number } | null>
}

export interface SpeedHistory {
  ok: boolean
  range: SpeedRange
  from: number
  to: number
  step: number
  ts: number[]
  /** every IPv4 uplink in multiwan's order (the other Monitoring pages' colours), then any other tested */
  ifaces: SpeedHistoryIface[]
  /** every test of the period, newest first: started, uplink, ok, download and upload Mbps, latency ms, scheduled */
  log: [number, string, boolean, number | null, number | null, number | null, boolean][]
}

export const speedInterfaces = () =>
  call<{ default_device: string; interfaces: SpeedIface[] }>('luci.aw1000-speedtest', 'interfaces')
export const speedStatus = () => call<SpeedStatus>('luci.aw1000-speedtest', 'status')
export const speedStart = (iface: string) =>
  call<{ ok: boolean; error?: string }>('luci.aw1000-speedtest', 'start', { interface: iface })
export const speedCancel = () => call('luci.aw1000-speedtest', 'cancel')
export const speedAccept = () => call('luci.aw1000-speedtest', 'accept')
/** Every test of a period, per uplink, for the graphs. */
export const speedHistory = (range: SpeedRange) => call<SpeedHistory>('luci.aw1000-speedtest', 'history', { range })
/** Forget every kept result and the history, and the saved copies. */
export const speedClear = () => call<{ ok: boolean; error?: string }>('luci.aw1000-speedtest', 'clear')
/** Results kept, and where: persist on a target, saved every flush seconds (0: after each test). */
export const speedSettings = (keep: number, persist: boolean, target: string, flush: number, cards: boolean) =>
  call<{ ok: boolean; error?: string }>('luci.aw1000-speedtest', 'settings', {
    keep: String(keep),
    persist: persist ? '1' : '0',
    persist_target: target,
    flush_interval: String(flush),
    persist_cards: cards ? '1' : '0',
  })

// ---- WireGuard (luci.aw1000-vpn) ----

export interface VpnTunnel {
  name: string
  label?: string
  enabled?: boolean
  up?: boolean
}

export const vpnList = () => call<{ ok: boolean; wg: boolean; tunnels: VpnTunnel[] }>('luci.aw1000-vpn', 'list')
export const vpnEnable = (name: string, enabled: boolean) =>
  call<{ ok: boolean; error?: string }>('luci.aw1000-vpn', 'enable', { name, enabled: enabled ? '1' : '0' })

// ---- storage (luci.aw1000-storage) ----

export interface StoragePart {
  name: string
  label: string | null
  mounted: boolean
  mountpoint: string | null
  total_kb: number | null
  used_kb: number | null
  mode: string
}

export interface StorageStatus {
  ok: boolean
  internal: { location: string; dev: string; total_kb: number; used_kb: number }
  disks: { name: string; model: string; vendor: string; partitions: StoragePart[] }[]
}

export const storageStatus = () => call<StorageStatus>('luci.aw1000-storage', 'status')

// ---- mesh (luci.aw1000-mesh) ----

export interface MeshStatus {
  ok: boolean
  config: { role: string; applied_role: string; mesh_id: string; band: string; channel: number }
  live: { present: boolean; operstate: string; peers_estab: number }
  offload?: { nss_offload: number }
}

export const meshStatus = () => call<MeshStatus>('luci.aw1000-mesh', 'status')

// ---- ad blocking (adblock) ----

/** null when adblock isn't installed. */
export async function adblockEnabled(): Promise<boolean | null> {
  try {
    const s = await uci.getSection('adblock', 'global')
    return s.adb_enabled === '1'
  } catch {
    return null
  }
}

/**
 * adblock reads adb_enabled when it (re)starts; the commit's config event
 * reaches procd, and the explicit restart covers images whose init script
 * has no reload trigger.
 */
export async function setAdblock(on: boolean): Promise<void> {
  await uci.set('adblock', 'global', { adb_enabled: on ? '1' : '0' })
  await uci.commit('adblock')
  await call('luci', 'setInitAction', { name: 'adblock', action: 'restart' })
}

// ---- Wi-Fi: access points per band, from uci `wireless` ----

export interface WifiAp {
  section: string
  radio: string
  band: string
  ssid: string
  network: string
  disabled: boolean
  /** on Home (network lan): the main Wi-Fi bands */
  main: boolean
  guest: boolean
}

export async function wifiAps(): Promise<WifiAp[]> {
  const v = await uci.getConfig('wireless')
  const radios = Object.values(v).filter((s) => s['.type'] === 'wifi-device')
  return Object.values(v)
    .filter((s) => s['.type'] === 'wifi-iface' && s.mode === 'ap')
    .map((s) => {
      const radio = radios.find((r) => r['.name'] === s.device)
      const net = String(s.network ?? '')
      return {
        section: s['.name'],
        radio: String(s.device ?? ''),
        band: String(radio?.band ?? ''),
        ssid: String(s.ssid ?? ''),
        network: net,
        disabled: s.disabled === '1' || radio?.disabled === '1',
        main: net === 'lan',
        guest: net !== 'lan' && (/guest/i.test(net) || /guest/i.test(s['.name'])),
      }
    })
}

/**
 * Turning off the band you're connected over would strand you, so this uses
 * rollback: if the browser can't confirm within 30 s, rpcd restores it.
 */
export async function setWifiAp(section: string, on: boolean): Promise<void> {
  await uci.set('wireless', section, { disabled: on ? '0' : '1' })
  await uci.applyWithRollback(30)
}

/** Several access points in one apply (the phone's Wi-Fi tile). */
export async function setWifiAps(sections: string[], on: boolean): Promise<void> {
  for (const section of sections) await uci.set('wireless', section, { disabled: on ? '0' : '1' })
  await uci.applyWithRollback(30)
}

// ---- CPU usage: two /proc/stat samples ----

export interface CpuSample {
  busy: number
  total: number
}

export async function cpuSample(): Promise<CpuSample> {
  const r = await call<{ data: string }>('file', 'read', { path: '/proc/stat' })
  const f = r.data.split('\n')[0]!.trim().split(/\s+/).slice(1).map(Number)
  // user nice system idle iowait irq softirq steal
  const idle = (f[3] ?? 0) + (f[4] ?? 0)
  const total = f.slice(0, 8).reduce((a, b) => a + b, 0)
  return { busy: total - idle, total }
}

export function cpuPercent(a: CpuSample, b: CpuSample): number {
  const dt = b.total - a.total
  return dt > 0 ? Math.round(((b.busy - a.busy) / dt) * 100) : 0
}

// ---- netifd: bounce an interface (Reconnect) ----

export async function reconnect(iface: string): Promise<void> {
  await call('network.interface', 'down', { interface: iface })
  await new Promise((r) => setTimeout(r, 1500))
  await call('network.interface', 'up', { interface: iface })
}
