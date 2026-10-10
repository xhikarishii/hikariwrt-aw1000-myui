// The app's destinations: drives the navigation rail, the menu drawer, the
// phone bottom bar, search and the router. Names and order follow the design
// canvas. `luci` is the LuCI page that covers the same ground; until a page
// is built, its placeholder links there so nothing is out of reach.

import type { IconName } from '@/components/icons/registry'

export interface NavItem {
  name: string
  path: string
  title: string
  icon: IconName
  /** Shown in the phone bottom bar (the rest go under "More"). */
  primary?: boolean
  /** Roadmap phase that builds it (docs/ROADMAP.md). 0 = built. */
  phase: number
  luci: string
  /** rpcd object the page is built on; hidden when the router lacks it. */
  requires?: string
  /** Extra words search should match. */
  keywords?: string
}

export const NAV: NavItem[] = [
  { name: 'home', path: '/', title: 'Home', icon: 'home', primary: true, phase: 0, luci: 'admin/status/overview', keywords: 'dashboard overview status' },
  { name: 'internet', path: '/internet', title: 'Internet', icon: 'internet', phase: 0, luci: 'admin/network/multiwan', keywords: 'wan pppoe multi-wan failover load balance' },
  { name: 'monitoring', path: '/monitoring', title: 'Monitoring', icon: 'chart', phase: 0, luci: 'admin/monitoring/uptime', requires: 'luci.aw1000-monitor', keywords: 'uptime latency ping packet loss jitter outage quality traffic usage signal rsrp rsrq sinr rssi band cell 5g lte history storage' },
  { name: 'cellular', path: '/cellular', title: 'Cellular', icon: 'cellular', primary: true, phase: 0, luci: 'admin/modem/status', requires: 'luci.aw1000-modem', keywords: '5g lte modem signal sim' },
  { name: 'wifi', path: '/wifi', title: 'Wireless', icon: 'wifi', phase: 0, luci: 'admin/network/wireless', keywords: 'wi-fi wifi ssid password 5 ghz 2.4 ghz guest' },
  { name: 'clients', path: '/clients', title: 'Clients', icon: 'clients', primary: true, phase: 0, luci: 'admin/network/dhcp', keywords: 'devices dhcp leases' },
  { name: 'vpn', path: '/vpn', title: 'VPN', icon: 'vpn', phase: 0, luci: 'admin/vpn/wireguard', requires: 'luci.aw1000-vpn', keywords: 'wireguard tunnel' },
  { name: 'mesh', path: '/mesh', title: 'Mesh', icon: 'mesh', phase: 0, luci: 'admin/network/mesh', requires: 'luci.aw1000-mesh', keywords: '802.11s backhaul' },
  { name: 'storage', path: '/storage', title: 'Storage', icon: 'storage', phase: 0, luci: 'admin/system/storage', requires: 'luci.aw1000-storage', keywords: 'usb drive disk extroot' },
  { name: 'system', path: '/system', title: 'System', icon: 'system', phase: 0, luci: 'admin/system/system', keywords: 'firmware upgrade backup password reboot time' },
]

/** Full LuCI URL (absolute: this UI lives under /webui/). */
export function luciUrl(path = ''): string {
  return `/cgi-bin/luci/${path}`
}
