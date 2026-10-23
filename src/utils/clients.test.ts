import { describe, expect, it } from 'vitest'
import { blockSection, isRandomMac, mergeClients, rate, signalWord } from './clients'

describe('mergeClients', () => {
  const base = {
    leases: [{ hostname: 'Robin-s-S24-Ultra', macaddr: '32:99:bf:e9:92:c7', ipaddr: '192.168.88.214' }],
    hints: {
      '32:99:BF:E9:92:C7': { name: 'Robin-s-S24-Ultra.lan', ipaddrs: ['192.168.88.214'] },
      '00:C3:F4:0F:59:B9': { name: 'Samsung.lan', ipaddrs: ['192.168.88.116'] },
      '00:11:46:E9:C5:9D': { ipaddrs: [] },
    },
    hosts: [{ section: 'cfg1', name: 'Living room TV', mac: ['00:C3:F4:0F:59:B9'], ip: '192.168.88.50' }],
    aps: [
      {
        ifname: 'phy0-ap0', band: '5g', guest: false,
        results: [{ mac: '32:99:BF:E9:92:C7', signal: -51, connected_time: 60, rx: { rate: 64900, bytes: 10 }, tx: { rate: 6000, bytes: 5 } }],
      },
    ],
    blocked: new Set(['00:C3:F4:0F:59:B9']),
    guestPrefix: null,
    localPrefixes: ['192.168.88'],
  }

  it('merges by MAC and ranks online Wi-Fi first', () => {
    const c = mergeClients(base)
    expect(c.map((x) => x.mac)).toEqual(['32:99:BF:E9:92:C7', '00:C3:F4:0F:59:B9'])
    expect(c[0]).toMatchObject({ name: 'Robin-s-S24-Ultra', link: 'wifi', band: '5g', online: true, signal: -51, randomMac: true })
  })

  it('prefers your name and marks reserved and blocked', () => {
    const tv = mergeClients(base)[1]!
    expect(tv).toMatchObject({ name: 'Living room TV', link: 'wired', reserved: true, blocked: true, ip: '192.168.88.116' })
  })

  it('drops neighbours with neither an IPv4 address nor a name', () => {
    expect(mergeClients(base).some((c) => c.mac === '00:11:46:E9:C5:9D')).toBe(false)
  })

  it('ignores WAN-side neighbours from the hints', () => {
    const c = mergeClients({ ...base, hints: { ...base.hints, 'AA:BB:CC:00:11:22': { ipaddrs: ['100.81.139.146'] } } })
    expect(c.some((x) => x.mac === 'AA:BB:CC:00:11:22')).toBe(false)
  })

  it('leaves the router itself out', () => {
    const c = mergeClients({ ...base, hints: { ...base.hints, 'AA:BB:CC:00:00:01': { name: 'HikariWrt.lan', ipaddrs: ['192.168.88.1'] } }, selfIps: ['192.168.88.1'] })
    expect(c.some((x) => x.name === 'HikariWrt')).toBe(false)
  })

  it('flags guests by subnet', () => {
    const c = mergeClients({ ...base, guestPrefix: '192.168.88' })
    expect(c.every((x) => x.guest)).toBe(true)
  })
})

it('helpers', () => {
  expect(isRandomMac('32:99:BF:E9:92:C7')).toBe(true)
  expect(isRandomMac('00:C3:F4:0F:59:B9')).toBe(false)
  expect(rate(64900)).toBe('64.9 Mbit/s')
  expect(rate(866700)).toBe('867 Mbit/s')
  expect(signalWord(-51)).toBe('Excellent')
  expect(signalWord(-80)).toBe('Weak')
  expect(blockSection('00:C3:F4:0F:59:B9')).toBe('hikari_block_00c3f40f59b9')
})

describe('mergeClients with other networks', () => {
  const nets = [
    { id: 'iot', label: 'Smart home', prefix: '192.168.90', zone: 'iot', guest: false },
    { id: 'guest2', label: 'Visitors', prefix: '192.168.91', zone: 'guest2', guest: true },
  ]
  it('keeps devices of every network, labelled with it', () => {
    const out = mergeClients({
      hints: {},
      hosts: [],
      aps: [],
      blocked: new Set<string>(),
      guestPrefix: null,
      leases: [
        { macaddr: 'aa:bb:cc:00:00:01', ipaddr: '192.168.90.120', hostname: 'plug' },
        { macaddr: 'aa:bb:cc:00:00:02', ipaddr: '192.168.91.130', hostname: 'visitor' },
        { macaddr: 'aa:bb:cc:00:00:03', ipaddr: '192.168.88.140', hostname: 'laptop' },
      ],
      localPrefixes: ['192.168.88', '192.168.90', '192.168.91'],
      nets,
    })
    const by = (n: string) => out.find((c) => c.name === n)!
    expect(by('plug').network?.label).toBe('Smart home')
    expect(by('plug').guest).toBe(false)
    expect(by('visitor').network?.zone).toBe('guest2')
    expect(by('visitor').guest).toBe(true)
    expect(by('laptop').network).toBeNull()
  })
})
