// One list of devices from the four places the router knows about them.
// Pure (no I/O) so it's unit tested; api/clients.ts feeds it.
//
//   leases     dnsmasq DHCP leases (name the device asked for, address)
//   hints      luci-rpc host hints (ARP/ND neighbours, /etc/ethers, leases)
//   hosts      uci dhcp host sections (names you gave, reserved addresses)
//   assoc      Wi-Fi associations per access point (only Wi-Fi is "live")
//   blocked    MACs with a hikari_block_* firewall rule

export interface AssocInfo {
  mac: string
  signal: number
  connected_time: number
  rx: { rate: number; bytes?: number }
  tx: { rate: number; bytes?: number }
}

export interface ApInfo {
  ifname: string
  band: string
  guest: boolean
  results: AssocInfo[]
}

export interface HostSection {
  section: string
  name: string
  mac: string[]
  ip: string
}

export type Link = 'wifi' | 'wired' | 'unknown'

export interface Client {
  mac: string
  /** Best name: yours, else the device's, else null. */
  name: string | null
  ip: string | null
  link: Link
  band: string | null
  guest: boolean
  online: boolean
  signal: number | null
  /** kbit/s, as the driver reports. */
  rxRate: number | null
  txRate: number | null
  rxBytes: number | null
  txBytes: number | null
  connected: number | null
  /** Seconds left on its DHCP lease; -1 for one that never expires, null without a lease. */
  lease: number | null
  ifname: string | null
  host: HostSection | null
  reserved: boolean
  blocked: boolean
  /** Locally administered MAC: phones' per-network "private address". */
  randomMac: boolean
}

export interface ClientSources {
  leases: { hostname?: string; macaddr: string; ipaddr?: string; expires?: number }[]
  hints: Record<string, { name?: string; ipaddrs?: string[] }>
  hosts: HostSection[]
  aps: ApInfo[]
  blocked: Set<string>
  /** First three octets of the guest subnet, if there is one. */
  guestPrefix: string | null
  /**
   * First three octets of the subnets that hold your devices (LAN, guest).
   * Host hints also carry WAN-side neighbours (the ISP gateway, the 5G
   * address); anything with an address outside these is not a client.
   */
  localPrefixes: string[]
  /** The router's own addresses (LAN, guest): it lists itself in the hints. */
  selfIps?: string[]
}

const up = (m: string) => m.toUpperCase()
const stripDomain = (n: string) => n.replace(/\.lan$/i, '')

export function isRandomMac(mac: string): boolean {
  const b = parseInt(mac.slice(0, 2), 16)
  return Number.isFinite(b) && (b & 0x02) !== 0
}

export function mergeClients(s: ClientSources): Client[] {
  const all = new Map<string, Client>()
  const get = (mac: string): Client => {
    const k = up(mac)
    let c = all.get(k)
    if (!c) {
      c = {
        mac: k, name: null, ip: null, link: 'unknown', band: null, guest: false, online: false,
        signal: null, rxRate: null, txRate: null, rxBytes: null, txBytes: null, connected: null,
        lease: null, ifname: null, host: null, reserved: false, blocked: false, randomMac: isRandomMac(k),
      }
      all.set(k, c)
    }
    return c
  }

  for (const [mac, h] of Object.entries(s.hints)) {
    const v4 = h.ipaddrs?.[0]
    // Hints include every neighbour the router has seen; only keep ones
    // with an IPv4 address or a name, the rest are link-local noise.
    if (!v4 && !h.name) continue
    const c = get(mac)
    c.ip ??= v4 ?? null
    if (h.name) c.name ??= stripDomain(h.name)
  }
  for (const l of s.leases) {
    const c = get(l.macaddr)
    if (l.ipaddr) c.ip = l.ipaddr
    if (l.hostname) c.name = l.hostname
    if (typeof l.expires === 'number') c.lease = l.expires
  }
  for (const h of s.hosts) {
    for (const mac of h.mac) {
      const c = get(mac)
      c.host = h
      if (h.name) c.name = h.name
      if (h.ip) {
        c.reserved = true
        c.ip ??= h.ip
      }
    }
  }
  for (const ap of s.aps) {
    for (const a of ap.results) {
      const c = get(a.mac)
      Object.assign(c, {
        link: 'wifi' as Link,
        band: ap.band,
        guest: ap.guest,
        online: true,
        signal: a.signal,
        rxRate: a.rx.rate,
        txRate: a.tx.rate,
        rxBytes: a.rx.bytes ?? null,
        txBytes: a.tx.bytes ?? null,
        connected: a.connected_time,
        ifname: ap.ifname,
      })
    }
  }
  const local = (ip: string) => s.localPrefixes.some((p) => ip.startsWith(`${p}.`))
  for (const [k, c] of all) {
    if ((c.ip && !local(c.ip) && !c.online) || (c.ip && s.selfIps?.includes(c.ip))) {
      all.delete(k)
      continue
    }
    if (c.link === 'unknown' && c.ip) c.link = 'wired'
    if (s.guestPrefix && c.ip?.startsWith(`${s.guestPrefix}.`)) c.guest = true
    c.blocked = s.blocked.has(c.mac)
  }
  // Online Wi-Fi first, then by name.
  return [...all.values()].sort((a, b) => Number(b.online) - Number(a.online) || (a.name ?? a.mac).localeCompare(b.name ?? b.mac))
}

/** "64.9 Mbit/s" from kbit/s. */
export function rate(kbit: number | null): string {
  if (kbit == null) return '—'
  return kbit >= 1000 ? `${(kbit / 1000).toFixed(kbit >= 100000 ? 0 : 1)} Mbit/s` : `${kbit} kbit/s`
}

/** Signal in words, the scale phones use. */
export function signalWord(dbm: number | null): string {
  if (dbm == null) return ''
  if (dbm >= -55) return 'Excellent'
  if (dbm >= -67) return 'Good'
  if (dbm >= -75) return 'Fair'
  return 'Weak'
}

/** Firewall section name for a MAC's block rule. */
export function blockSection(mac: string): string {
  return `hikari_block_${mac.replace(/:/g, '').toLowerCase()}`
}

/** "6 h 33 min", "never" - a DHCP lease's time left. */
export function leaseLeft(seconds: number | null): string | null {
  if (seconds == null) return null
  if (seconds < 0) return 'never expires'
  if (seconds < 60) return 'renewing now'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}
