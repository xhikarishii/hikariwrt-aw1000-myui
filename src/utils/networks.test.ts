import { describe, expect, it } from 'vitest'
import type { UciSection } from '@/api/uci'
import {
  baseDevice,
  buildRemoveOps,
  buildSaveOps,
  freeId,
  homePortsAfter,
  movesPorts,
  parseModel,
  parseVlanDev,
  pickFreePrefix,
  preset,
  validate,
  type NetworkSpec,
  type Op,
  type Snapshot,
  type ValidateContext,
} from './networks'

// A uci section as rpcd returns it.
const sec = (name: string, type: string, values: Record<string, string | string[]> = {}): UciSection =>
  ({ '.name': name, '.type': type, '.anonymous': name.startsWith('cfg'), ...values }) as UciSection
const conf = (...s: UciSection[]) => Object.fromEntries(s.map((x) => [x['.name'], x]))

// The live router's shape: br-lan anonymous with a plain-string ports
// option, the guest network api/guest.ts made, two radios.
function routerSnapshot(): Snapshot {
  return {
    network: conf(
      sec('lan', 'interface', { device: 'br-lan', proto: 'static', ipaddr: '192.168.88.1', netmask: '255.255.255.0' }),
      sec('cfg030f15', 'device', { name: 'br-lan', type: 'bridge', ports: 'lan1 lan2 lan3 lan4' }),
      sec('wan', 'interface', { device: 'wan', proto: 'pppoe' }),
      sec('hikari_guest_dev', 'device', { name: 'br-guest', type: 'bridge', bridge_empty: '1' }),
      sec('guest', 'interface', { proto: 'static', device: 'br-guest', ipaddr: '192.168.89.1', netmask: '255.255.255.0' }),
    ),
    dhcp: conf(sec('lan', 'dhcp', { interface: 'lan' }), sec('guest', 'dhcp', { interface: 'guest', start: '100', limit: '150', leasetime: '2h' })),
    firewall: conf(
      sec('cfg01', 'zone', { name: 'lan', network: ['lan'], input: 'ACCEPT', forward: 'ACCEPT' }),
      sec('cfg02', 'zone', { name: 'wan', network: ['wan', 'wan6'], input: 'REJECT', masq: '1' }),
      sec('cfg03', 'forwarding', { src: 'lan', dest: 'wan' }),
      sec('hikari_guest', 'zone', { name: 'guest', network: ['guest'], input: 'REJECT', output: 'ACCEPT', forward: 'REJECT' }),
      sec('hikari_guest_wan', 'forwarding', { src: 'guest', dest: 'wan' }),
      sec('hikari_guest_dhcp', 'rule', { name: 'Guest-DHCP', src: 'guest', proto: 'udp', dest_port: '67-68', target: 'ACCEPT', family: 'ipv4' }),
      sec('hikari_guest_dns', 'rule', { name: 'Guest-DNS', src: 'guest', proto: ['tcp', 'udp'], dest_port: '53', target: 'ACCEPT' }),
    ),
    wireless: conf(
      sec('radio0', 'wifi-device', { band: '2g' }),
      sec('radio1', 'wifi-device', { band: '5g' }),
      sec('default_radio0', 'wifi-iface', { device: 'radio0', mode: 'ap', network: 'lan', ssid: 'Home', encryption: 'sae-mixed', key: 'k' }),
      sec('hikari_guest_radio0', 'wifi-iface', { device: 'radio0', mode: 'ap', network: 'guest', ssid: 'Guests', encryption: 'sae-mixed', key: 'guestpass', isolate: '1' }),
    ),
    hikariui: conf(sec('setup', 'setup', { done: '1' })),
  }
}

const ctx = (over: Partial<ValidateContext> = {}): ValidateContext => ({
  takenIds: new Set(['lan', 'wan', 'wan6', 'guest']),
  usedPrefixes: new Set(['192.168.88', '192.168.89']),
  usedVids: new Set(),
  apsPerRadio: { radio0: 2, radio1: 0 },
  isNew: true,
  ...over,
})

const iotPreset = () =>
  preset('iot', 'iot', {
    hostname: 'HikariWrt',
    radios: [
      { name: 'radio0', band: '2g' },
      { name: 'radio1', band: '5g' },
    ],
    prefix: '192.168.90',
    password: 'longpassword',
  })

const find = (ops: Op[], config: string, section: string) => ops.filter((o) => o.config === config && o.section === section)

describe('device names', () => {
  it('splits 802.1Q sub-interfaces', () => {
    expect(parseVlanDev('lan3.30')).toEqual({ port: 'lan3', vid: 30 })
    expect(parseVlanDev('wan')).toEqual({ port: 'wan', vid: null })
    expect(baseDevice('wan.832')).toBe('wan')
    expect(baseDevice('@wan')).toBe('@wan')
  })
})

describe('parseModel', () => {
  it('reads Home ports from a plain-string option and the legacy guest network', () => {
    const m = parseModel(routerSnapshot())
    expect(m.home.ports).toEqual(['lan1', 'lan2', 'lan3', 'lan4'])
    expect(m.home.section).toBe('cfg030f15')
    expect(m.networks).toHaveLength(1)
    const g = m.networks[0]!
    expect(g).toMatchObject({ id: 'guest', legacy: true, kind: 'guest', prefix: '192.168.89' })
    expect(g.wifi).toMatchObject({ enabled: true, ssid: 'Guests', radios: ['radio0'], isolate: true })
    expect(g.access).toEqual({ internet: true, router: false, toHome: false, fromHome: false })
    expect(m.foreign).toEqual([])
  })

  it('round-trips: saving a network unchanged changes nothing', () => {
    const s = routerSnapshot()
    const m = parseModel(s)
    const ops = buildSaveOps(s, m, m.networks[0]!)
    // only the metadata section is new (the legacy guest network had none)
    expect(ops).toEqual([{ op: 'add', config: 'hikariui', section: 'net_guest', type: 'network', values: { label: 'Guest', kind: 'guest' } }])
  })

  it('reads tagged and untagged ports of a network made here', () => {
    const s = routerSnapshot()
    s.network.cfg030f15!.ports = 'lan1 lan2'
    Object.assign(s.network, conf(
      sec('hikari_net_iot_dev', 'device', { name: 'br-iot', type: 'bridge', bridge_empty: '1', ports: ['lan3', 'lan1.30'] }),
      sec('iot', 'interface', { proto: 'static', device: 'br-iot', ipaddr: '192.168.90.1' }),
    ))
    s.hikariui.net_iot = sec('net_iot', 'network', { label: 'Smart home', kind: 'iot', vid: '30', iot_compat: '1' })
    const m = parseModel(s)
    const iot = m.networks.find((n) => n.id === 'iot')!
    expect(iot.ports).toEqual({ lan1: 'tagged', lan2: 'off', lan3: 'untagged', lan4: 'off' })
    expect(iot.vid).toBe(30)
    expect(iot.iot.compat).toBe(true)
    expect(m.home.ports).toEqual(['lan1', 'lan2'])
  })

  it('lists bridges made elsewhere as foreign', () => {
    const s = routerSnapshot()
    s.network.cfgabc = sec('cfgabc', 'device', { name: 'br-cams', type: 'bridge', ports: ['lan4'] })
    expect(parseModel(s).foreign).toEqual([{ name: 'br-cams', ports: ['lan4'] }])
  })
})

describe('presets', () => {
  it('makes IoT 2.4 GHz, WPA2 and reachable from Home only', () => {
    const p = iotPreset()
    expect(p.wifi.radios).toEqual(['radio0'])
    expect(p.wifi.encryption).toBe('psk2')
    expect(p.access).toEqual({ internet: true, router: false, toHome: false, fromHome: true })
    expect(p.iot).toEqual({ compat: true, keepAwake: true, longLeases: true, ntp: true })
  })

  it('isolates guests, trusts trusted', () => {
    const c = { hostname: 'R', radios: [{ name: 'radio0', band: '2g' }], prefix: '192.168.91', password: 'p' }
    expect(preset('guest', 'guest', c).wifi.isolate).toBe(true)
    expect(preset('trusted', 'home2', c).access).toEqual({ internet: true, router: true, toHome: true, fromHome: true })
  })

  it('picks free ids and subnets', () => {
    expect(freeId('iot', new Set())).toBe('iot')
    expect(freeId('iot', new Set(['iot']))).toBe('iot2')
    expect(freeId('guest', new Set())).toBe('guest2')
    expect(freeId('custom', new Set())).toBe('net')
    expect(pickFreePrefix(['192.168.89', '192.168.90'])).toBe('192.168.91')
  })
})

describe('validate', () => {
  it('accepts the IoT preset', () => {
    const s = routerSnapshot()
    expect(validate(iotPreset(), parseModel(s), ctx())).toEqual({})
  })

  it('refuses taken or malformed ids, ranges and VLAN IDs', () => {
    const m = parseModel(routerSnapshot())
    const p: NetworkSpec = { ...iotPreset(), id: 'lan', prefix: '192.168.89', vid: 1, ports: { lan1: 'off', lan2: 'off', lan3: 'tagged', lan4: 'off' } }
    const e = validate(p, m, ctx())
    expect(e.id).toBeTruthy()
    expect(e.prefix).toMatch(/Another network/)
    expect(e.vid).toMatch(/2 to 4094/)
    expect(validate({ ...p, id: '9x', prefix: '8.8.8' }, m, ctx()).prefix).toMatch(/private/)
    expect(validate({ ...p, id: 'cams', prefix: '192.168.95', vid: 40 }, m, ctx({ usedVids: new Set([40]) })).vid).toMatch(/Another network/)
  })

  it('keeps at least one port on Home', () => {
    const m = parseModel(routerSnapshot())
    const all: NetworkSpec = { ...iotPreset(), ports: { lan1: 'untagged', lan2: 'untagged', lan3: 'untagged', lan4: 'untagged' } }
    expect(validate(all, m, ctx()).ports).toMatch(/Home/)
    // tagged on every port is fine: the ports stay on Home untagged too
    const tagged: NetworkSpec = { ...iotPreset(), vid: 30, ports: { lan1: 'tagged', lan2: 'tagged', lan3: 'tagged', lan4: 'tagged' } }
    expect(validate(tagged, m, ctx()).ports).toBeUndefined()
  })

  it('needs Wi-Fi details only with Wi-Fi on, and room on the band', () => {
    const m = parseModel(routerSnapshot())
    const p = iotPreset()
    expect(validate({ ...p, wifi: { ...p.wifi, ssid: '' } }, m, ctx()).ssid).toBeTruthy()
    expect(validate({ ...p, wifi: { ...p.wifi, enabled: false, ssid: '' } }, m, ctx()).ssid).toBeUndefined()
    expect(validate(p, m, ctx({ apsPerRadio: { radio0: 4 } })).radios).toMatch(/four/)
  })

  it('won’t take a port another tool bridged', () => {
    const s = routerSnapshot()
    s.network.cfgabc = sec('cfgabc', 'device', { name: 'br-cams', type: 'bridge', ports: ['lan4'] })
    s.network.cfg030f15!.ports = 'lan1 lan2 lan3'
    const p: NetworkSpec = { ...iotPreset(), ports: { lan1: 'off', lan2: 'off', lan3: 'off', lan4: 'untagged' } }
    expect(validate(p, parseModel(s), ctx()).ports).toMatch(/br-cams/)
  })
})

describe('buildSaveOps', () => {
  it('creates every section of a new IoT network', () => {
    const s = routerSnapshot()
    const p: NetworkSpec = { ...iotPreset(), vid: 30, ports: { lan1: 'off', lan2: 'off', lan3: 'untagged', lan4: 'tagged' } }
    const ops = buildSaveOps(s, parseModel(s), p, { ntpServer: true })
    const added = ops.filter((o) => o.op === 'add').map((o) => `${o.config}/${o.section}`)
    expect(added).toEqual([
      'network/hikari_net_iot_dev',
      'network/iot',
      'dhcp/iot',
      'firewall/hikari_net_iot',
      'firewall/hikari_net_iot_dhcp',
      'firewall/hikari_net_iot_dns',
      'firewall/hikari_net_iot_ntp',
      'firewall/hikari_fwd_iot__wan',
      'firewall/hikari_fwd_lan__iot',
      'wireless/hikari_net_iot_radio0',
      'hikariui/net_iot',
    ])
    expect(find(ops, 'network', 'hikari_net_iot_dev')[0]).toMatchObject({ values: { name: 'br-iot', type: 'bridge', ports: ['lan3', 'lan4.30'] } })
    // lan3 leaves Home; lan4 stays (it is only tagged into IoT)
    expect(find(ops, 'network', 'cfg030f15')[0]).toEqual({ op: 'set', config: 'network', section: 'cfg030f15', values: { ports: ['lan1', 'lan2', 'lan4'] } })
    expect(find(ops, 'wireless', 'hikari_net_iot_radio0')[0]).toMatchObject({
      values: { encryption: 'psk2', ieee80211w: '0', ieee80211r: '0', disassoc_low_ack: '0', max_inactivity: '3600', isolate: '0' },
    })
    expect(find(ops, 'dhcp', 'iot')[0]).toMatchObject({ values: { leasetime: '24h' } })
    expect(find(ops, 'system', 'ntp')[0]).toEqual({ op: 'set', config: 'system', section: 'ntp', values: { enable_server: '1' } })
  })

  it('edits in place: changed options set, dropped options and sections removed', () => {
    const s = routerSnapshot()
    const m = parseModel(s)
    const g = { ...m.networks[0]!, access: { ...m.networks[0]!.access, router: true }, wifi: { ...m.networks[0]!.wifi, ssid: 'Visitors', radios: ['radio1'] } }
    const ops = buildSaveOps(s, m, g)
    expect(find(ops, 'firewall', 'hikari_guest')).toEqual([{ op: 'set', config: 'firewall', section: 'hikari_guest', values: { input: 'ACCEPT' } }])
    // router reachable: the DHCP/DNS rules are no longer needed
    expect(find(ops, 'firewall', 'hikari_guest_dhcp')).toEqual([{ op: 'delete', config: 'firewall', section: 'hikari_guest_dhcp' }])
    expect(find(ops, 'firewall', 'hikari_guest_dns')).toEqual([{ op: 'delete', config: 'firewall', section: 'hikari_guest_dns' }])
    // the 2.4 GHz AP goes, a 5 GHz one comes
    expect(find(ops, 'wireless', 'hikari_guest_radio0')).toEqual([{ op: 'delete', config: 'wireless', section: 'hikari_guest_radio0' }])
    expect(find(ops, 'wireless', 'hikari_guest_radio1')[0]).toMatchObject({ op: 'add', values: { ssid: 'Visitors', device: 'radio1' } })
  })

  it('turning IoT tuning off removes its options', () => {
    const s = routerSnapshot()
    const first = buildSaveOps(s, parseModel(s), iotPreset())
    // apply the adds to a copy of the snapshot, as the router would
    for (const o of first) if (o.op === 'add') (s as unknown as Record<string, Record<string, UciSection>>)[o.config]![o.section] = sec(o.section, o.type, o.values)
    const m = parseModel(s)
    const iot = m.networks.find((n) => n.id === 'iot')!
    expect(iot.iot.keepAwake).toBe(true)
    const ops = buildSaveOps(s, m, { ...iot, iot: { ...iot.iot, keepAwake: false } })
    expect(find(ops, 'wireless', 'hikari_net_iot_radio0')).toEqual([{ op: 'unset', config: 'wireless', section: 'hikari_net_iot_radio0', options: ['disassoc_low_ack', 'max_inactivity'] }])
    expect(find(ops, 'hikariui', 'net_iot')).toEqual([{ op: 'unset', config: 'hikariui', section: 'net_iot', options: ['iot_keepawake'] }])
  })

  it('takes an untagged port from another network', () => {
    const s = routerSnapshot()
    s.network.cfg030f15!.ports = 'lan1 lan2 lan3'
    s.network.hikari_guest_dev!.ports = ['lan4']
    const m = parseModel(s)
    const p: NetworkSpec = { ...iotPreset(), ports: { lan1: 'off', lan2: 'off', lan3: 'off', lan4: 'untagged' } }
    const ops = buildSaveOps(s, m, p)
    expect(find(ops, 'network', 'hikari_guest_dev')).toEqual([{ op: 'set', config: 'network', section: 'hikari_guest_dev', values: { ports: [] } }])
    expect(find(ops, 'network', 'cfg030f15')).toEqual([])
  })

  it('never writes bridge VLAN filtering', () => {
    const s = routerSnapshot()
    const ops = buildSaveOps(s, parseModel(s), { ...iotPreset(), vid: 30, ports: { lan1: 'tagged', lan2: 'tagged', lan3: 'untagged', lan4: 'off' } })
    const text = JSON.stringify(ops)
    expect(text).not.toMatch(/vlan_filtering|bridge-vlan|lan\d:[ut]/)
  })
})

describe('buildRemoveOps', () => {
  it('removes everything a network owns and gives its ports back to Home', () => {
    const s = routerSnapshot()
    s.network.cfg030f15!.ports = 'lan1 lan2 lan3'
    s.network.hikari_guest_dev!.ports = ['lan4']
    const ops = buildRemoveOps(s, parseModel(s), 'guest')
    const deleted = ops.filter((o) => o.op === 'delete').map((o) => `${o.config}/${o.section}`)
    expect(deleted.sort()).toEqual(
      [
        'network/hikari_guest_dev',
        'network/guest',
        'dhcp/guest',
        'firewall/hikari_guest',
        'firewall/hikari_guest_dhcp',
        'firewall/hikari_guest_dns',
        'firewall/hikari_guest_wan',
        'wireless/hikari_guest_radio0',
      ].sort(),
    )
    expect(find(ops, 'network', 'cfg030f15')[0]).toMatchObject({ values: { ports: ['lan1', 'lan2', 'lan3', 'lan4'] } })
  })
})

describe('port moves', () => {
  it('knows when a change moves ports', () => {
    const s = routerSnapshot()
    const m = parseModel(s)
    const g = m.networks[0]!
    expect(movesPorts(m, g)).toBe(false)
    expect(movesPorts(m, { ...g, ports: { ...g.ports, lan4: 'untagged' } })).toBe(true)
    expect(homePortsAfter(m, { ...g, ports: { ...g.ports, lan4: 'untagged' } })).toEqual(['lan1', 'lan2', 'lan3'])
  })
})
