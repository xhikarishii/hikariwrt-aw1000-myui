// luci.aw1000-modem (hikariwrt feed). Types list only what the UI reads.
//
// AT-port rule: `status`, `lockinfo`, `usageinfo`, `profileinfo`,
// `routerstatus` are cheap/cached and may be polled. `diag`, `refresh`,
// `smslist` and every set* talk to the modem: call them on page open or on
// a user action, never on a timer.

import { call } from './ubus'

export interface ModemSignal {
  tech: string
  band: string
  rsrp: number | null
  rsrq: number | null
  rssi: number | null
  sinr: number | null
  pci: number | null
  arfcn: number | null
  cell_id: string | null
  percent: number
  bars: number
  quality: string
}

export interface ModemBand {
  role: string
  tech: string
  band: string
  bandwidth: number | null
  pci: number | null
  arfcn: number | null
  rssi?: number | null
  rsrp?: number | null
  rsrq?: number | null
  sinr?: number | null
}

export interface ModemStatus {
  ok: boolean
  sim: string
  registered: boolean
  mode?: string
  mode_label?: string
  /** Display name: the SIM's own (EF_SPN), else the operator list by
   *  MCC/MNC, else the network's broadcast name tidied up. */
  operator?: string
  operator_source?: 'sim' | 'list' | 'network' | null
  spn?: string | null
  network_name?: string | null
  roaming_abroad?: boolean
  /** The network the modem is registered on, as strings ("515", "02"). */
  mcc?: string | null
  mnc?: string | null
  /** Aggregate Maximum Bit Rate of the data session, kbps: the network's speed ceiling. */
  ambr?: { dl: number; ul: number; apn: string | null; rat: 'lte' | 'nr' } | null
  tac?: string
  gnb_id_bits?: number
  error?: string | null
  /** The cell carrying the connection: the LTE anchor, or the NR cell in SA. */
  signal?: ModemSignal | null
  /** The NR leg of 5G NSA; null otherwise. */
  signal_nr?: ModemSignal | null
  ca?: { lte: number; nr: number; total: number; active: boolean }
  bands?: ModemBand[]
  identity?: { imei: string | null; imsi: string | null; iccid: string | null; msisdn: string | null }
  link?: { interface: string; up: boolean; uptime: number; ipv4: string | null; ipv6: string | null }
}

export interface ModemDiag {
  ok: boolean
  module?: { manufacturer: string; model: string; revision: string; firmware: string }
  registration?: { ims: number; ims_reg: number }
  temperatures?: { sensor: string; celsius: number }[]
}

export interface BandSet {
  supported: number[]
  effective: number[]
  configured: number[]
}

export interface LteCellRef {
  arfcn: number
  pci: number
}
export interface NrCellRef {
  arfcn: number
  pci: number
  band: number
  scs: number
}

export interface KnownCell {
  tech: 'LTE' | 'NR'
  arfcn: number
  pci: number
  band: number | null
  scs: number | null
  rsrp: number | null
  quality: string
  rsrq: number | null
  plmn: string | null
  cellid: string | null
  bandwidth: number | null
  source: 'serving' | 'ca' | 'neighbour' | 'scan'
  age: number
  lockable: boolean
}

export interface LockInfo {
  ok: boolean
  error?: string
  bands: { lte: BandSet; nsa: BandSet; sa: BandSet; gw: BandSet }
  mode: { pref: string; nr5g_disable: number; rat_order: string }
  cell_lock: {
    lte: { count: number; max: number; cells: LteCellRef[] }
    nr: NrCellRef | null
  }
  cells: KnownCell[]
  saved?: { persist: boolean; lte: LteCellRef[]; nr: NrCellRef | null }
}

export interface ScanStatus {
  ok: boolean
  state: 'idle' | 'running' | 'done' | 'failed'
  running: boolean
  supported: boolean
  started: number | null
  finished: number | null
  elapsed: number | null
  timeout: number
  found: number | null
  error: string | null
  warning: string | null
}

/** Envelope of lock/SMS/profile writes: `state` is a fresh read. */
export interface WriteReply<T> {
  ok: boolean
  action?: string
  changed?: boolean
  warning?: string
  error?: string
  state?: T
}

export interface UsageTotal {
  rx: number
  tx: number
  total: number
}

export interface UsageInfo {
  ok: boolean
  enabled: boolean
  clock_ok?: boolean
  link_up?: boolean
  settings: {
    limit: number
    limit_value: number
    unit: string
    decimal?: boolean
    reset_day: number
    warn_percent: number
    sms_notify: boolean
    sms_number: string | null
    action: string
    retain_days: number
    /** seconds between saves of the running count */
    flush_interval?: number
  }
  /** Where the daily history is kept (aw1000-modem-usage). */
  persist?: {
    /** "router" (/etc/aw1000-usage) or a drive's mountpoint */
    target: string
    kind: 'flash' | 'usb' | 'drive'
    /** the file, or "" while the chosen drive isn't mounted */
    path: string
    available: boolean
    flush_interval: number
    flush_bytes: number
  }
  storage?: { id: string; label: string; path: string; kind: 'flash' | 'usb' | 'drive' }[]
  recorded?: { days: number; first: string; last: string }
  period: { start: string; end: string; next: string; days: number; elapsed: number; left: number }
  cycle: {
    rx: number
    tx: number
    total: number
    percent: number
    remaining: number
    limit_human: string
    projected: number
    over: boolean
    warn: boolean
  }
  totals?: Record<'today' | 'week' | 'cycle' | 'month' | 'days30' | 'all', UsageTotal>
  state?: { blocked: boolean; override: boolean; warned: boolean }
  days?: { date: string; rx: number; tx: number; total: number }[]
}

export interface SmsPart {
  index: number
  sender: string
  timestamp: string
  reference?: number
  part?: number
  total?: number
  content: string
}

export interface SmsList {
  ok: boolean
  error?: string
  incoming: string | null
  incoming_label?: string
  smsc?: string
  saved?: { storage: string; persist: boolean }
  stores: { name: string; label: string; used: number; total: number; msg: SmsPart[] }[]
}

export interface Carrier {
  id: string
  mcc: string
  mnc: string
  country: string
  name: string
  apn: string
  auth: string
  username?: string
  password?: string
  pdptype: string
}

export interface ProfileInfo {
  ok: boolean
  apn: {
    mode: 'auto' | 'list' | 'custom' | string
    carrier: string
    value: string
    auth: string
    username: string
    has_password: boolean
    pdptype: string
    modem_context: string
  }
  apn_verify: number
  verify: { state: 'pending' | 'ok' | 'rolled_back' | string; at: number | null; restored: string }
  ttl: {
    value: number
    /** The rule is loaded and covers the device the modem is on now. */
    active: boolean
    pattern?: string
    device?: string
    /** Packets rewritten since the firewall last loaded the rule. */
    packets?: number
    /** NSS acceleration: paused ("off") while TTL is on and the modem is up,
     *  because offloaded packets never pass the rule. */
    offload?: 'on' | 'off' | 'absent'
    paused_for_ttl?: boolean
  }
  mcc: string
  carriers?: Carrier[]
}

export interface Ipv6Info {
  ok: boolean
  config: {
    mode: string
    carrier?: string
    /** dual (one IPv4v6 context), split (one per family), v6only, v4only */
    style: string
    pdptype: string
    apnv6?: string
    multiplexing?: string
    nat64: string
    nat64prefix?: string
    delegate: string
    sourcefilter?: string
    prefixlifetime?: string
    passthrough: string
  }
  call: { up: boolean; families: string; ipv4: string; ipv6: string; ipv6_length: string; prefix: string; prefix_length: string }
  assessment: { state: string; text: string; style: string; why: string }
}

export interface RouterStatus {
  ok: boolean
  mode: string
  applied: string
  pending: boolean
  services?: { name: string; state: string }[]
}

export const status = () => call<ModemStatus>('luci.aw1000-modem', 'status')
export const diag = () => call<ModemDiag>('luci.aw1000-modem', 'diag')
export const refresh = () => call<ModemStatus>('luci.aw1000-modem', 'refresh')
export const lockinfo = () => call<LockInfo>('luci.aw1000-modem', 'lockinfo')
export const usageinfo = () => call<UsageInfo>('luci.aw1000-modem', 'usageinfo')
export const smslist = () => call<SmsList>('luci.aw1000-modem', 'smslist')
export const profileinfo = () => call<ProfileInfo>('luci.aw1000-modem', 'profileinfo')
/** The same, with the carrier list of another country (by MCC). */
export const profileinfoFor = (mcc: string) => call<ProfileInfo>('luci.aw1000-modem', 'profileinfo', { mcc })
export const ipv6info = () => call<Ipv6Info>('luci.aw1000-modem', 'ipv6info')
export const routerstatus = () => call<RouterStatus>('luci.aw1000-modem', 'routerstatus')

// ---------------------------------------------------------- engineering ---
// aw1000-modem-eng: while a session runs, one loop on the router reads the
// modem every interval and owns the AT port; other timed readers serve their
// last reading. `engread` and `engseries` only read files, so they may be
// polled at the session's interval; `engstart`/`engstop` start and end it.

export type EngPause = 'scan' | 'write' | 'busy' | 'noport'

/** One receive path's readings, RX0..RX3; null where the carrier doesn't use it. */
export interface EngPaths {
  rsrp?: (number | null)[]
  rsrq?: (number | null)[]
  sinr?: (number | null)[]
}

export interface EngLte {
  duplex: string | null
  mcc: string | null
  mnc: string | null
  cell_id: string | null
  pci: number | null
  earfcn: number | null
  band: number | null
  ul_bw: number | null
  dl_bw: number | null
  tac: string | null
  rsrp: number | null
  rsrq: number | null
  rssi: number | null
  /** from +QCAINFO, the scale every other reading uses */
  sinr: number | null
  /** +QENG's own LTE SINR, on a scale of its own on this firmware */
  sinr_qeng: number | null
  cqi: number | null
  /** dBm */
  tx_power: number | null
  srxlev: number | null
}

export interface EngNr {
  kind: 'nsa' | 'sa'
  duplex: string | null
  mcc: string | null
  mnc: string | null
  cell_id: string | null
  pci: number | null
  tac: string | null
  arfcn: number | null
  band: number | null
  bw_raw: number | null
  scs_raw: number | null
  rsrp: number | null
  rsrq: number | null
  sinr: number | null
  srxlev: number | null
}

export interface EngNeighbour {
  kind: 'intra' | 'inter' | null
  tech: string
  arfcn: number | null
  pci: number | null
  rsrp: number | null
  rsrq: number | null
  rssi: number | null
  sinr: number | null
}

export interface EngNow {
  ok: boolean
  ts: number
  /** parse.awk on the same reply: mode, serving cells, carriers */
  status: Pick<ModemStatus, 'ok' | 'mode' | 'mode_label' | 'operator' | 'mcc' | 'mnc' | 'tac' | 'gnb_id_bits' | 'signal' | 'signal_nr' | 'ca' | 'bands'>
  eng: {
    /** CONNECT, NOCONN, SEARCH, LIMSRV */
    state: string | null
    lte: EngLte | null
    nr: EngNr | null
    antennas: { lte?: EngPaths; nr?: EngPaths }
    neighbours: EngNeighbour[]
  }
}

export interface EngSession {
  ok: boolean
  error?: string
  active: boolean
  interval: number
  started: number | null
  paused_for: EngPause | null
  /** how long the last reading took on the router */
  last_ms: number | null
  /** seconds since the last reading */
  age: number | null
  ring_minutes: number
  data?: EngNow | null
}

/** History columns, as aw1000-modem-eng's ring_cols. */
export const ENG_COLS = [
  'lte_rsrp', 'lte_rsrq', 'lte_sinr', 'lte_rssi', 'lte_pci', 'lte_band',
  'nr_rsrp', 'nr_rsrq', 'nr_sinr', 'nr_pci', 'nr_band',
  'lte_a0', 'lte_a1', 'lte_a2', 'lte_a3', 'lte_s0', 'lte_s1', 'lte_s2', 'lte_s3',
  'nr_a0', 'nr_a1', 'nr_a2', 'nr_a3', 'nr_s0', 'nr_s1', 'nr_s2', 'nr_s3', 'ca',
] as const
export type EngCol = (typeof ENG_COLS)[number]

export interface EngSeries {
  ok: boolean
  rows: number
  series: Partial<Record<EngCol | 'ts', (number | null)[]>> & { mode?: string[] }
  marks: { ts: number; label: string }[]
}

export const engRead = () => call<EngSession>('luci.aw1000-modem', 'engread')
export const engSeries = (since = 0) => call<EngSeries>('luci.aw1000-modem', 'engseries', { since: String(since) })
export const engStart = (interval: number) => call<EngSession>('luci.aw1000-modem', 'engstart', { interval: String(interval) })
export const engStop = () => call<EngSession>('luci.aw1000-modem', 'engstop')
export const engMark = (label: string) => call<{ ok: boolean; ts: number; label: string }>('luci.aw1000-modem', 'engmark', { label })

/** One AT command through aw1000-modem-at (takes the shared modem lock). */
export const atRun = (command: string) =>
  call<{ ok: boolean; command: string; lines?: string[]; error?: string }>('luci.aw1000-modem', 'atrun', { command })

/**
 * Band lists are colon-separated band numbers; '-' leaves that group as it
 * is. `reregister` makes the modem drop and re-attach so the change takes
 * effect now instead of on the next reconnect.
 */
export const setBands = (p: { lte?: number[]; nsa?: number[]; sa?: number[]; gw?: number[]; reregister: boolean }) =>
  call<{ ok: boolean; error?: string }>('luci.aw1000-modem', 'setbands', {
    lte: p.lte ? p.lte.join(':') : '-',
    nsa: p.nsa ? p.nsa.join(':') : '-',
    sa: p.sa ? p.sa.join(':') : '-',
    gw: p.gw ? p.gw.join(':') : '-',
    reregister: p.reregister ? '1' : '0',
  })

// ---- cells, scan, network mode ----

/**
 * Sets the whole lock state: `lte` up to cell_lock.lte.max cells, `nr` one
 * cell (scs in kHz); empty/null unlocks that side. `persist` makes the
 * router re-apply it at boot. The modem re-searches after a lock write.
 */
export const setLock = (lte: LteCellRef[], nr: NrCellRef | null, persist: boolean) =>
  call<WriteReply<LockInfo>>('luci.aw1000-modem', 'setlock', {
    lte: lte.map((c) => `${c.arfcn}/${c.pci}`).join(','),
    nr: nr ? `${nr.arfcn}/${nr.pci}/${nr.band}/${nr.scs}` : '',
    persist: persist ? '1' : '0',
  })

/** 1 = LTE, 2 = NR, 3 = both. Data drops for the whole sweep (~90 s). */
export const scanStart = (mode: 1 | 2 | 3) => call<ScanStatus>('luci.aw1000-modem', 'scanstart', { mode: String(mode) })
export const scanStatus = () => call<ScanStatus>('luci.aw1000-modem', 'scanstatus')
export const scanClear = () => call<WriteReply<LockInfo>>('luci.aw1000-modem', 'scanclear')

/**
 * mode: AUTO | LTE:NR5G | NR5G | LTE; nr5g: 0 SA+NSA, 1 NSA only, 2 SA only.
 * reregister cycles the radio (CFUN 4/1) when something changed.
 */
export const setMode = (mode: string, nr5g: 0 | 1 | 2, reregister: boolean) =>
  call<WriteReply<LockInfo>>('luci.aw1000-modem', 'setmode', { mode, nr5g: String(nr5g), reregister: reregister ? '1' : '0' })

// ---- SMS ----

export const smsRefresh = () => call<SmsList>('luci.aw1000-modem', 'smsrefresh')
/** One message: 160 GSM-7 characters or 70 UCS-2 units; no multipart send. */
export const smsSend = (number: string, text: string) =>
  call<WriteReply<SmsList>>('luci.aw1000-modem', 'smssend', { number, text })
/** spec: "ME:3,SM:0" — every part of a multipart message. */
export const smsDelete = (spec: string[]) => call<WriteReply<SmsList>>('luci.aw1000-modem', 'smsdelete', { spec: spec.join(',') })
export const smsDeleteAll = (storage: 'ME' | 'SM' | 'all') => call<WriteReply<SmsList>>('luci.aw1000-modem', 'smsdeleteall', { storage })
export const smsStorage = (storage: 'ME' | 'SM', persist: boolean) =>
  call<WriteReply<SmsList>>('luci.aw1000-modem', 'smsstorage', { storage, persist: persist ? '1' : '0' })

// ---- APN / TTL ----

/**
 * mode auto (no APN) | list (a carrier row) | custom. Empty username or
 * password deletes the stored one. When something changes the uplink
 * reconnects, and a watchdog restores the old settings if no address
 * comes up within `apn_verify` seconds: poll profileinfo().verify.state.
 */
export const setApn = (p: { mode: string; apn: string; auth: string; username: string; password: string; pdptype: string; carrier: string }) =>
  call<WriteReply<ProfileInfo>>('luci.aw1000-modem', 'setapn', p)
/** 1..255 rewrites outgoing TTL/hop limit; 0 turns it off. */
/**
 * The dial's IP arrangement (aw1000-modem-ipv6 set). Every option is sent,
 * because the helper writes each one as given: a blank would clear it - and
 * sourcefilter cleared is IPv6 dropped upstream as spoofed. `withStyle` keeps
 * the current settings and changes only the arrangement.
 */
export const setIpv6 = (c: Ipv6Info['config']) =>
  call<WriteReply<Ipv6Info>>('luci.aw1000-modem', 'setipv6', {
    mode: c.mode === 'list' && c.carrier ? 'list' : 'manual',
    carrier: c.mode === 'list' ? (c.carrier ?? '') : '',
    style: c.style,
    apnv6: c.apnv6 ?? '',
    nat64: c.nat64 ?? 'auto',
    nat64prefix: c.nat64prefix ?? '',
    delegate: c.delegate ?? '',
    sourcefilter: c.sourcefilter ?? '',
    prefixlifetime: c.prefixlifetime ?? '',
  })
export const withStyle = (c: Ipv6Info['config'], style: string): Ipv6Info['config'] => ({ ...c, mode: 'manual', carrier: '', style })

export const setTtl = (value: number) => call<WriteReply<ProfileInfo>>('luci.aw1000-modem', 'setttl', { value: String(value) })

// ---- data usage (replies are the full usageinfo, with `done`) ----

export const usageSet = (p: {
  enabled: boolean
  limit: string
  unit: string
  reset_day: number
  warn_percent: number
  sms_notify: boolean
  sms_number: string
  action: 'none' | 'disconnect'
  retain_days: number
  /** "router" or a mountpoint; left out, the router keeps its choice */
  persist_target?: string
  /** 1800, 3600, 21600, 43200 or 86400; left out, the router keeps its choice */
  flush_interval?: number
}) =>
  call<UsageInfo & { error?: string }>('luci.aw1000-modem', 'usageset', {
    enabled: p.enabled ? '1' : '0',
    limit: p.limit || '0',
    unit: p.unit,
    reset_day: String(p.reset_day),
    warn_percent: String(p.warn_percent),
    sms_notify: p.sms_notify ? '1' : '0',
    sms_number: p.sms_number,
    action: p.action,
    retain_days: String(p.retain_days),
    persist_target: p.persist_target ?? '',
    flush_interval: p.flush_interval ? String(p.flush_interval) : '',
  })
/** period zeroes this billing period; all deletes every recorded day. */
export const usageReset = (what: 'period' | 'all') => call<UsageInfo & { error?: string }>('luci.aw1000-modem', 'usagereset', { what })
/** Bring the uplink back after a limit cut it, for the rest of this period. */
export const usageResume = () => call<UsageInfo & { error?: string }>('luci.aw1000-modem', 'usageresume')
