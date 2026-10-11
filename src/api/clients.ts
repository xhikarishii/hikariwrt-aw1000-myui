// Devices: read the sources mergeClients() needs, and the actions a device
// sheet offers. Names and reservations are dnsmasq `host` sections; blocks
// are fw4 rules named hikari_block_<mac>. dhcp and firewall both have procd
// reload triggers, so a commit applies them.

import { call, UbusError } from './ubus'
import * as uci from './uci'
import { blockSection, mergeClients, type ApInfo, type Client, type HostSection } from '@/utils/clients'

interface WirelessStatus {
  [radio: string]: { config: { band?: string }; interfaces: { section: string; ifname?: string; config: { mode: string; network?: string[] | string } }[] }
}

export async function loadClients(): Promise<Client[]> {
  const [leases, hints, dhcp, fw, wl, guestIface, lanIface] = await Promise.all([
    call<{ dhcp_leases: { hostname?: string; macaddr: string; ipaddr?: string; expires?: number }[] }>('luci-rpc', 'getDHCPLeases'),
    call<Record<string, { name?: string; ipaddrs?: string[] }>>('luci-rpc', 'getHostHints'),
    uci.getConfig('dhcp'),
    uci.getConfig('firewall'),
    call<WirelessStatus>('network.wireless', 'status'),
    uci.getSection('network', 'guest').catch(() => null),
    uci.getSection('network', 'lan').catch(() => null),
  ])

  const hosts: HostSection[] = Object.values(dhcp)
    .filter((s) => s['.type'] === 'host')
    .map((s) => ({
      section: s['.name'],
      name: String(s.name ?? ''),
      mac: (Array.isArray(s.mac) ? s.mac : String(s.mac ?? '').split(/\s+/)).filter(Boolean).map((m) => m.toUpperCase()),
      ip: String(s.ip ?? ''),
    }))

  const blocked = new Set(
    Object.values(fw)
      .filter((s) => s['.name'].startsWith('hikari_block_') && s.enabled !== '0')
      .map((s) => String(s.src_mac ?? '').toUpperCase()),
  )

  const apIfaces = Object.values(wl).flatMap((r) =>
    r.interfaces
      .filter((i) => i.config.mode === 'ap' && i.ifname)
      .map((i) => {
        const nets = Array.isArray(i.config.network) ? i.config.network : [i.config.network ?? '']
        return { ifname: i.ifname!, band: r.config.band ?? '', guest: nets.some((n) => /guest/i.test(n)) }
      }),
  )
  const aps: ApInfo[] = await Promise.all(
    apIfaces.map(async (a) => ({
      ...a,
      results: await call<{ results: ApInfo['results'] }>('iwinfo', 'assoclist', { device: a.ifname }).then((r) => r.results, () => []),
    })),
  )

  const prefix = (s: uci.UciSection | null) => (s?.ipaddr ? String(s.ipaddr).split('/')[0]!.split('.').slice(0, 3).join('.') : null)
  const gp = prefix(guestIface)
  const local = [prefix(lanIface), gp].filter((p): p is string => !!p)
  const self = [lanIface?.ipaddr, guestIface?.ipaddr].filter(Boolean).map((a) => String(a).split('/')[0]!)
  return mergeClients({ leases: leases.dhcp_leases ?? [], hints, hosts, aps, blocked, guestPrefix: gp, localPrefixes: local, selfIps: self })
}

async function staged(config: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    await uci.commit(config)
  } catch (e) {
    await uci.revert(config).catch(() => undefined)
    throw e
  }
}

/** Name and/or reserved address. Empty name and no ip removes the host entry. */
export async function saveHost(c: Client, name: string, ip: string | null): Promise<void> {
  await staged('dhcp', async () => {
    const values: Record<string, string> = { mac: c.mac }
    if (name) values.name = name
    if (ip) values.ip = ip
    if (c.host) {
      if (!name && !ip) {
        await call('uci', 'delete', { config: 'dhcp', section: c.host.section })
        return
      }
      await uci.set('dhcp', c.host.section, values)
      const drop = [...(!name ? ['name'] : []), ...(!ip ? ['ip'] : [])]
      await uci.del('dhcp', c.host.section, drop)
    } else if (name || ip) {
      // dns=1 makes dnsmasq answer the name for the address too.
      await call('uci', 'add', { config: 'dhcp', type: 'host', values: { ...values, dns: '1' } })
    }
  })
}

/**
 * Stop a device reaching the internet (it still reaches the LAN and this
 * router). New connections stop at once; ones already open, especially
 * NSS-accelerated flows, can run on until they time out.
 */
export async function setBlocked(c: Client, blocked: boolean): Promise<void> {
  const section = blockSection(c.mac)
  await staged('firewall', async () => {
    if (blocked) {
      await call('uci', 'add', {
        config: 'firewall',
        type: 'rule',
        name: section,
        values: { name: `Block ${c.name ?? c.mac}`, src: c.guest ? 'guest' : 'lan', src_mac: c.mac, dest: 'wan', proto: 'all', target: 'REJECT' },
      })
    } else {
      await call('uci', 'delete', { config: 'firewall', section }).catch((e: unknown) => {
        if (!(e instanceof UbusError && e.code === 4)) throw e
      })
    }
  })
}

/** Kick a device off Wi-Fi; it may rejoin straight away (no ban). */
export async function disconnectWifi(c: Client): Promise<void> {
  if (!c.ifname) throw new Error('This device is not on Wi-Fi.')
  await call(`hostapd.${c.ifname}`, 'del_client', { addr: c.mac.toLowerCase(), reason: 5, deauth: true, ban_time: 0 })
}

// ---- traffic (aw1000-monitor's clients collector, luci.aw1000-monitor) ----

export interface ClientTraffic {
  /** bytes a second at the last sample */
  down: number
  up: number
  today: { down: number; up: number }
  month: { down: number; up: number }
}

export interface ClientStats {
  ok: boolean
  enabled: boolean
  running: boolean
  /** seconds between samples */
  interval: number
  now: number
  sampled: number | null
  /** keyed by MAC, upper case */
  clients: Record<string, ClientTraffic>
}

export interface ClientHistory {
  ok: boolean
  mac: string
  interval: number
  /** the last ten minutes, one point per sample, bytes a second */
  ts: number[]
  down: number[]
  up: number[]
  /** totals for every day kept, oldest first */
  days: { date: string; down: number; up: number }[]
}

export const clientStats = () => call<ClientStats>('luci.aw1000-monitor', 'clientstats')
export const clientHistory = (mac: string) => call<ClientHistory>('luci.aw1000-monitor', 'clienthistory', { mac })
