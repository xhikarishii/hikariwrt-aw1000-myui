// WireGuard via luci.aw1000-vpn (aw1000-vpn in the hikariwrt feed). Tunnels
// are native netifd wireguard interfaces; aw1000-vpn owns their routing
// policy (which networks egress through which tunnel), firewall zones and
// the flow flush NSS needs. New tunnels start disabled with routing off.

import { call } from './ubus'

export interface VpnPeer {
  id: string
  endpoint: string
  /** Unix time of the last handshake, 0 = never. */
  handshake: number
  rx: number
  tx: number
}

export type RouteMode = 'off' | 'selected' | 'all'

export interface Tunnel {
  name: string
  label: string
  enabled: boolean
  up: boolean
  device: string
  source: string
  route_mode: RouteMode
  killswitch: boolean
  egress: string
  src_net: string[]
  src_addr: string[]
  /** Devices routed by MAC (lower case), whatever address they have. */
  src_mac: string[]
  addresses: string[]
  peers: VpnPeer[]
}

export interface VpnNetworks {
  networks: { name: string; device: string; zone: string }[]
  uplinks: { name: string; device: string }[]
  multiwan: { present: boolean; active: string; device: string }
}

type Reply = { ok: boolean; error?: string; warning?: string; name?: string }

export const list = () => call<{ ok: boolean; wg: boolean; tunnels: Tunnel[] }>('luci.aw1000-vpn', 'list')
export const networks = () => call<VpnNetworks & { ok: boolean }>('luci.aw1000-vpn', 'networks')
export const genkey = () => call<{ ok: boolean; private_key: string; public_key: string }>('luci.aw1000-vpn', 'genkey')

/** From a wg-quick .conf (what VPN providers hand out). */
export const importConf = (label: string, conf: string) => call<Reply>('luci.aw1000-vpn', 'import', { label, conf })

export interface CreateArgs {
  label: string
  private_key: string
  /** Space separated, e.g. "10.2.0.2/32 fd00::2/128". */
  addresses: string
  public_key: string
  allowed_ips: string
  endpoint_host: string
  endpoint_port: string
  preshared_key: string
  keepalive: string
  mtu: string
  listen_port: string
}
export const create = (a: CreateArgs) => call<Reply>('luci.aw1000-vpn', 'create', { ...a })

export const remove = (name: string) => call<Reply>('luci.aw1000-vpn', 'remove', { name })
export const enable = (name: string, on: boolean) => call<Reply>('luci.aw1000-vpn', 'enable', { name, enabled: on ? '1' : '0' })

/**
 * Whose traffic uses the tunnel: off (nobody; the tunnel is only a link),
 * selected (these networks, devices by MAC and/or addresses), all (every
 * local network). The kill switch drops that traffic while the tunnel is
 * down instead of letting it leak out of the WAN.
 */
export const route = (name: string, mode: RouteMode, nets: string[], addrs: string[], killswitch: boolean, macs: string[] = []) =>
  call<Reply>('luci.aw1000-vpn', 'route', {
    name,
    mode,
    networks: nets.join(' '),
    addresses: addrs.join(' '),
    killswitch: killswitch ? '1' : '0',
    clients: macs.join(' '),
  })

/** "auto" follows multi-WAN's primary uplink; a name pins the tunnel to it. */
export const egress = (name: string, iface: string) => call<Reply>('luci.aw1000-vpn', 'egress', { name, iface })
