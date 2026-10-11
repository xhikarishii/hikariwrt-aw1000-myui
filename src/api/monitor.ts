// Internet uptime and quality, and the 5G modem's signal over time, via
// luci.aw1000-monitor (aw1000-monitor in the hikariwrt feed). The collector
// keeps the history; this reads it and can ask for a save now. Settings
// (targets, thresholds, intervals, where history is kept) are changed on the
// LuCI pages under Monitoring.

import { call } from './ubus'

export type Range = '1h' | '3h' | '6h' | '12h' | '24h' | '7d' | '30d' | '90d' | '365d'

export interface MonitorWan {
  name: string
  label: string
  enabled: boolean
  /** Its network interface is switched off (a 5G router's wired wan): not monitored, not shown. */
  iface_disabled?: boolean
  targets: string[]
  last: {
    ts: number
    up: boolean
    link: boolean
    rtt: number | null
    loss: number | null
    rx_rate: number
    tx_rate: number
    device: string | null
  } | null
  /** Averages over the last five minutes, for a steady status chip. */
  recent?: { rtt: number | null; loss: number } | null
  outage: { start: number; cause: 'link' | 'noreply' } | null
  uptime: { '24h': number | null; '7d': number | null; '30d': number | null }
}

/** Where a history is kept beyond RAM; the same shape for uptime and signal. */
export interface Persist {
  enabled: boolean
  /** "router" (the router's own storage) or a drive's mountpoint */
  target: string | null
  /** null while the chosen drive isn't mounted */
  path: string | null
  /** flash: the router's internal flash; usb: router storage on USB (extroot); drive: a mounted drive */
  kind?: 'flash' | 'usb' | 'drive' | null
  days: number
  /** seconds between saves (also saved on shutdown) */
  flush_interval?: number
  last_flush: number | null
  error: string | null
}

export interface StorageOption {
  id: string
  label: string
  path: string
  kind?: 'flash' | 'usb' | 'drive'
}

export interface MonitorStatus {
  ok: boolean
  running: boolean
  clock_ok: boolean
  now: number
  interval: number
  timeout: number
  degraded_loss: number
  degraded_rtt: number
  retain_days: number
  persist: Persist
  storage: StorageOption[]
  wans: MonitorWan[]
}

/** Bucket state: 0 no data, 1 up, 2 degraded, 3 down. */
export type BucketState = 0 | 1 | 2 | 3

export interface WanSeries {
  name: string
  label: string
  ts: number[]
  state: BucketState[]
  rtt: (number | null)[]
  rmin: (number | null)[]
  rmax: (number | null)[]
  jitter: (number | null)[]
  loss: (number | null)[]
  /** Bytes per second over the bucket. */
  rx: (number | null)[]
  tx: (number | null)[]
  summary: { uptime: number | null; rtt: number | null; loss: number | null; jitter: number | null; rx: number; tx: number; down_seconds: number; samples: number }
}

export interface Series {
  ok: boolean
  range: Range
  from: number
  to: number
  step: number
  degraded_loss: number
  degraded_rtt: number
  wans: WanSeries[]
}

export interface Outage {
  wan: string
  label: string
  start: number
  end: number | null
  cause: 'link' | 'noreply'
  duration: number
}

export const status = () => call<MonitorStatus>('luci.aw1000-monitor', 'status')
export const series = (range: Range, wan = 'all') => call<Series>('luci.aw1000-monitor', 'series', { wan, range })
export const events = (range: Range) => call<{ ok: boolean; range: Range; events: Outage[] }>('luci.aw1000-monitor', 'events', { range })

/** Save every monitor's history to storage now (when it's kept there). */
export const flush = () => call<{ ok: boolean; error?: string }>('luci.aw1000-monitor', 'flush')

// ---- the modem's signal (Monitoring -> Signal) ----

export type SignalMode = 'sa' | 'nsa' | 'lte' | 'none'

export interface SignalReading {
  band: string | null
  pci: number | null
  arfcn: number | null
  rsrp: number | null
  rsrq: number | null
  sinr: number | null
  rssi?: number | null
}

export interface SignalStatus {
  ok: boolean
  /** The modem package is installed. */
  modem: boolean
  running: boolean
  clock_ok: boolean
  now: number
  enabled: boolean
  /** Seconds between readings. */
  interval: number
  retain_days: number
  /** The RSRP window (dBm) aw1000-modem grades by, per radio. */
  rsrp_window: { lte: [number, number]; nr: [number, number] }
  persist: Persist
  storage: StorageOption[]
  last: { ts: number; mode: SignalMode; ca: number | null; cell: string | null; lte: SignalReading; nr: SignalReading } | null
}

/** Mode per bucket: 0 no data, 1 5G SA, 2 5G NSA, 3 LTE, 4 no service. */
export type ModeState = 0 | 1 | 2 | 3 | 4

export type SignalMetric = 'lte_rsrp' | 'lte_rsrq' | 'lte_sinr' | 'lte_rssi' | 'nr_rsrp' | 'nr_rsrq' | 'nr_sinr'

type Values = (number | null)[]

export type SignalSeries = {
  ok: boolean
  range: Range
  from: number
  to: number
  step: number
  ts: number[]
  mode: ModeState[]
  /** The most used band in each bucket. */
  lband: (string | null)[]
  nband: (string | null)[]
  /** Average number of aggregated carriers. */
  ca: Values
  summary: {
    samples: number
    /** Share of the period in each mode, %. */
    modes: Record<SignalMode, number> | null
    bands: { lte: { band: string; share: number }[]; nr: { band: string; share: number }[] }
  } & Record<SignalMetric, { avg: number; min: number; max: number } | null>
} & Record<SignalMetric | `${SignalMetric}_min` | `${SignalMetric}_max`, Values>

export interface SignalChange {
  ts: number
  kind: 'mode' | 'lte_band' | 'lte_cell' | 'nr_band' | 'nr_cell'
  from: string
  to: string
}

export const sigstatus = () => call<SignalStatus>('luci.aw1000-monitor', 'sigstatus')
export const sigseries = (range: Range) => call<SignalSeries>('luci.aw1000-monitor', 'sigseries', { range })
export const sigevents = (range: Range) => call<{ ok: boolean; range: Range; changes: SignalChange[] }>('luci.aw1000-monitor', 'sigevents', { range })

// ---- websites (Monitoring -> Sites) ----

/** One check: an HTTP ping (or the gateway's ICMP ping). */
export interface SiteResult {
  ts: number
  ok: boolean
  /** HTTP status; null for the gateway or without an answer */
  code: number | null
  /** ms from the request to its first answer (DNS and TLS left out) */
  latency: number | null
  /** ms for the TCP connect alone */
  connect: number | null
}

export interface SiteWan {
  name: string
  label: string
  iface_disabled: boolean
  /** It checks the sites. */
  sites: boolean
  action: 'none' | 'restart' | 'restart_reboot'
  /** minutes with no site answering before the action */
  after: number
  /** null before the first check */
  link: boolean | null
  dark_since: number | null
  last_action: number | null
  restarts: number | null
  gateway: { addr: string; last: SiteResult | null } | null
  results: Record<string, SiteResult>
}

export interface SitesStatus {
  ok: boolean
  running: boolean
  clock_ok: boolean
  now: number
  enabled: boolean
  /** seconds between checks */
  interval: number
  timeout: number
  retain_days: number
  max_reboots: number
  boot_grace: number
  reboots_24h: number
  dryrun: boolean
  /** when the last check finished */
  checked: number | null
  /** bytes a day the checks cost */
  estimate: number
  persist: Persist
  storage: StorageOption[]
  /** `icon`: a file under /aw1000-site-icons/, or null for a letter tile */
  sites: { id: string; site: string; host: string; url: string; icon: string | null }[]
  wans: SiteWan[]
}

export interface SitesSeries {
  ok: boolean
  site: string
  range: Range
  from: number
  to: number
  step: number
  /** rtt is the response time; loss the share of checks that failed */
  wans: WanSeries[]
}

export interface SiteAction {
  ts: number
  wan: string
  label: string | null
  action: 'restart' | 'reboot' | 'recovered' | 'skipped'
  detail: string
}

export const sitestatus = () => call<SitesStatus>('luci.aw1000-monitor', 'sitestatus')
/** site: an id, 'gw' for the gateway, or 'all' (every site summed per WAN) */
export const sitesseries = (site: string, range: Range) => call<SitesSeries>('luci.aw1000-monitor', 'sitesseries', { site, range })
export const siteevents = (range: Range) => call<{ ok: boolean; range: Range; actions: SiteAction[] }>('luci.aw1000-monitor', 'siteevents', { range })
/** Starts a check on the router and returns at once; watch `checked` in sitestatus. */
export const sitecheck = () => call<{ ok: boolean; started?: number; error?: string }>('luci.aw1000-monitor', 'sitecheck')
export const siteaction = (wan: string, action: 'restart' | 'reboot') =>
  call<{ ok: boolean; error?: string }>('luci.aw1000-monitor', 'siteaction', { wan, action })

// ---- one storage setting for every monitor ----

export interface StorageInfo {
  ok: boolean
  retain_days: number
  /** the setting itself; last_flush and error are per history, below */
  persist: Omit<Persist, 'last_flush' | 'error'>
  storage: StorageOption[]
  /** the histories running now */
  histories: { id: 'uptime' | 'sites' | 'signal' | 'clients'; name: string; last_flush: number | null; error: string | null; kb: number }[]
}

/** Where every monitor's history is kept, and what each has saved. */
export const storage = () => call<StorageInfo>('luci.aw1000-monitor', 'storage')
