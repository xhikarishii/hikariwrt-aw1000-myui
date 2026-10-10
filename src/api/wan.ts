// Wired WAN (uci network.wan) and multi-WAN (uci multiwan) settings.
// Both have procd reload triggers, so a commit applies them; netifd only
// restarts the interface whose config changed. A failed save reverts the
// session's staged changes so a later apply can't pick up half of it.

import { call } from './ubus'
import * as uci from './uci'

export type WanProto = 'dhcp' | 'pppoe' | 'static'

export interface WanConfig {
  proto: WanProto | string
  username: string
  password: string
  ipaddr: string
  netmask: string
  gateway: string
  /** Custom DNS servers; empty = use the ones the ISP hands out. */
  dns: string[]
  mtu: string
  ipv6: boolean
}

const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(/\s+/).filter(Boolean) : [])

export async function wanConfig(): Promise<WanConfig | null> {
  try {
    const s = await uci.getSection('network', 'wan')
    return {
      proto: String(s.proto ?? 'dhcp'),
      username: String(s.username ?? ''),
      password: String(s.password ?? ''),
      ipaddr: String(s.ipaddr ?? ''),
      netmask: String(s.netmask ?? '255.255.255.0'),
      gateway: String(s.gateway ?? ''),
      dns: s.peerdns === '0' || String(s.proto) === 'static' ? list(s.dns) : [],
      mtu: String(s.mtu ?? ''),
      ipv6: s.ipv6 !== '0',
    }
  } catch {
    return null
  }
}

async function staged<T>(configs: string[], fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    for (const c of configs) await uci.revert(c).catch(() => undefined)
    throw e
  }
}

const PROTO_OPTS: Record<string, string[]> = {
  pppoe: ['username', 'password'],
  static: ['ipaddr', 'netmask', 'gateway'],
  dhcp: [],
}

export async function saveWan(c: WanConfig): Promise<void> {
  await staged(['network'], async () => {
    const values: Record<string, string | string[]> = { proto: c.proto, ipv6: c.ipv6 ? 'auto' : '0' }
    if (c.proto === 'pppoe') Object.assign(values, { username: c.username, password: c.password })
    if (c.proto === 'static') Object.assign(values, { ipaddr: c.ipaddr, netmask: c.netmask, gateway: c.gateway })
    if (c.mtu) values.mtu = c.mtu
    if (c.dns.length) {
      values.dns = c.dns
      if (c.proto !== 'static') values.peerdns = '0'
    }
    await uci.set('network', 'wan', values)
    // Options that belong to the other protocols, and emptied fields.
    const drop = Object.entries(PROTO_OPTS)
      .filter(([p]) => p !== c.proto)
      .flatMap(([, o]) => o)
    if (!c.mtu) drop.push('mtu')
    if (!c.dns.length) drop.push('dns', 'peerdns')
    await uci.del('network', 'wan', drop)
    await uci.commit('network')
  })
}

// ---- the WAN port's MAC address ----

export interface WanMac {
  /** the WAN interface's device, e.g. "wan" */
  device: string
  /** the `config device` section for it, if there is one */
  section: string | null
  /** the address it's set to use ("AA:BB:..."), or "" for its own */
  mac: string
  /** the address it has right now */
  current: string | null
}

/**
 * The WAN port's MAC override. It lives on the device (a `config device`
 * section named after it), not on the interface, so it holds for whichever
 * protocol runs on the port - DHCP, PPPoE or static.
 */
export async function wanMac(): Promise<WanMac | null> {
  try {
    const v = await uci.getConfig('network')
    const device = String(v.wan?.device ?? '')
    if (!/^[A-Za-z0-9_.-]+$/.test(device)) return null
    const sec = Object.values(v).find((s) => s['.type'] === 'device' && s.name === device)
    const st = await call<{ macaddr?: string }>('network.device', 'status', { name: device }).catch(() => null)
    return {
      device,
      section: sec?.['.name'] ?? null,
      mac: sec?.macaddr ? String(sec.macaddr).toUpperCase() : '',
      current: st?.macaddr ? st.macaddr.toUpperCase() : null,
    }
  } catch {
    return null
  }
}

/** Give the WAN port `mac`, or back its own with "". netifd re-applies the device, so the WAN reconnects. */
export async function saveWanMac(w: WanMac, mac: string): Promise<void> {
  await staged(['network'], async () => {
    if (mac) {
      if (w.section) await uci.set('network', w.section, { macaddr: mac })
      else await call('uci', 'add', { config: 'network', type: 'device', values: { name: w.device, macaddr: mac } })
    } else if (w.section) {
      await uci.del('network', w.section, ['macaddr'])
    }
    await uci.commit('network')
  })
}

// ---- multi-WAN ----

export interface MwIface {
  name: string
  label: string
  enabled: boolean
  metric: number
  weight: number
}

export interface MultiwanFull {
  enabled: boolean
  mode: 'failover' | 'balance'
  interval: number
  trackIp: string[]
  ifaces: MwIface[]
  notify: { enabled: boolean; recipients: string[]; throttle: number } | null
}

export async function multiwanFull(): Promise<MultiwanFull | null> {
  try {
    const v = await uci.getConfig('multiwan')
    const g = v.globals ?? ({} as uci.UciSection)
    const n = v.notify
    return {
      enabled: g.enabled !== '0',
      mode: g.mode === 'balance' ? 'balance' : 'failover',
      interval: Number(g.interval ?? 5),
      trackIp: list(g.track_ip),
      ifaces: Object.values(v)
        .filter((s) => s['.type'] === 'interface')
        .map((s) => ({
          name: s['.name'],
          label: String(s.label ?? s['.name']),
          enabled: s.enabled !== '0',
          metric: Number(s.metric ?? 10),
          weight: Number(s.weight ?? 1),
        }))
        .sort((a, b) => a.metric - b.metric),
      notify: n ? { enabled: n.enabled === '1', recipients: list(n.recipient), throttle: Number(n.throttle ?? 300) } : null,
    }
  } catch {
    return null
  }
}

/** Order becomes metrics 10, 20, 30… (lower = preferred), as multiwand reads them. */
export async function saveMultiwan(m: MultiwanFull): Promise<void> {
  await staged(['multiwan'], async () => {
    await uci.set('multiwan', 'globals', { enabled: m.enabled ? '1' : '0', mode: m.mode })
    for (const [i, f] of m.ifaces.entries()) {
      await uci.set('multiwan', f.name, { metric: String((i + 1) * 10), weight: String(f.weight), enabled: f.enabled ? '1' : '0' })
    }
    if (m.notify) {
      await uci.set('multiwan', 'notify', {
        enabled: m.notify.enabled ? '1' : '0',
        recipient: m.notify.recipients,
        throttle: String(m.notify.throttle),
      })
    }
    await uci.commit('multiwan')
  })
}

// ---- the WAN port as a LAN port ("5G router") ----

export interface WanPort {
  /** uci section of the br-lan device */
  bridge: string
  /** the WAN interface's device, e.g. "wan" */
  device: string
  ports: string[]
  inLan: boolean
  hasWan6: boolean
}

/**
 * Where the WAN port is now. Null when there is nothing safe to move: no
 * br-lan device section, or a WAN device that isn't a plain port (a VLAN, an
 * alias, a bridge of its own).
 */
export async function wanPort(): Promise<WanPort | null> {
  try {
    const v = await uci.getConfig('network')
    const device = String(v.wan?.device ?? '')
    const br = Object.values(v).find((s) => s['.type'] === 'device' && s.name === 'br-lan')
    if (!br || !/^[A-Za-z0-9_-]+$/.test(device) || device.startsWith('br-')) return null
    // "ports" is a list on most routers but a plain string on this one
    // (aw1000-defaults writes it that way); both read the same.
    const ports = list(br.ports)
    return { bridge: br['.name'], device, ports, inLan: ports.includes(device), hasWan6: !!v.wan6 }
  } catch {
    return null
  }
}

/**
 * Put the WAN port into the LAN bridge, or take it back out. In the bridge,
 * the wan and wan6 interfaces are disabled rather than deleted: their
 * settings are kept for the day the router goes back to a wired uplink, and
 * a DHCP client running on a bridge member would only fight the bridge.
 */
export async function setWanAsLan(p: WanPort, on: boolean): Promise<void> {
  await staged(['network'], async () => {
    const ports = on ? [...new Set([...p.ports, p.device])] : p.ports.filter((x) => x !== p.device)
    await uci.set('network', p.bridge, { ports })
    for (const iface of p.hasWan6 ? ['wan', 'wan6'] : ['wan']) {
      if (on) await uci.set('network', iface, { disabled: '1' })
      else await uci.del('network', iface, ['disabled'])
    }
    await uci.commit('network')
  })
}
