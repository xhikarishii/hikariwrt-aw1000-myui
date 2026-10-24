// Networks: read the router into a model (utils/networks.ts), and save or
// remove one network as a single staged change applied with rollback - the
// firewall, Wi-Fi and possibly the ports a browser is plugged into restart,
// and if that cuts this browser off, rpcd puts everything back by itself.

import { call, UbusError } from './ubus'
import * as uci from './uci'
import {
  buildPortOps,
  buildRemoveOps,
  buildSaveOps,
  movesPorts,
  names,
  parseModel,
  prefixOf,
  suggestedVids,
  type LanPort,
  type Model,
  type NetworkSpec,
  type Op,
  type PortProfile,
  type Snapshot,
  type ValidateContext,
} from '@/utils/networks'

export interface NetworksData {
  snapshot: Snapshot
  model: Model
  radios: { name: string; band: string; disabled: boolean }[]
  /** /24 prefixes of every address the router has (LAN, WANs, VPNs, networks) */
  prefixes: string[]
  /** netifd interface and firewall zone names in use */
  ids: string[]
  /** devices with a DHCP lease, per network id */
  clients: Record<string, number>
  /** the router already answers NTP */
  ntpServer: boolean
}

const CONFIGS = ['network', 'dhcp', 'firewall', 'wireless', 'hikariui', 'system'] as const

export async function loadNetworks(): Promise<NetworksData> {
  const [network, dhcp, firewall, wireless, hikariui, ntp, dump, leases] = await Promise.all([
    uci.getConfig('network'),
    uci.getConfig('dhcp'),
    uci.getConfig('firewall'),
    uci.getConfig('wireless'),
    uci.getConfig('hikariui').catch(() => ({})),
    uci.getSection('system', 'ntp').catch(() => null),
    call<{ interface: { interface: string; 'ipv4-address'?: { address: string }[] }[] }>('network.interface', 'dump'),
    call<{ dhcp_leases?: { ipaddr?: string }[] }>('luci-rpc', 'getDHCPLeases').catch(() => ({ dhcp_leases: [] })),
  ])
  const snapshot: Snapshot = { network, dhcp, firewall, wireless, hikariui }
  const model = parseModel(snapshot)
  const radios = Object.values(wireless)
    .filter((s) => s['.type'] === 'wifi-device')
    .map((s) => ({ name: s['.name'], band: String(s.band ?? ''), disabled: s.disabled === '1' }))
  const prefixes = new Set<string>()
  for (const i of dump.interface) for (const a of i['ipv4-address'] ?? []) prefixes.add(prefixOf(a.address)!)
  for (const s of Object.values(network)) if (s['.type'] === 'interface' && s.ipaddr) prefixes.add(prefixOf(s.ipaddr)!)
  const ids = new Set<string>([...Object.values(network).filter((s) => s['.type'] === 'interface').map((s) => s['.name'])])
  for (const z of Object.values(firewall)) if (z['.type'] === 'zone' && z.name) ids.add(String(z.name))
  const clients: Record<string, number> = {}
  for (const n of [{ id: 'lan', prefix: model.home.prefix }, ...model.networks]) {
    if (!n.prefix) continue
    clients[n.id] = (leases.dhcp_leases ?? []).filter((l) => l.ipaddr?.startsWith(`${n.prefix}.`)).length
  }
  return { snapshot, model, radios, prefixes: [...prefixes].filter(Boolean), ids: [...ids], clients, ntpServer: ntp?.enable_server === '1' }
}

/** What validate() needs, with this network's own names, range and APs left out. */
export function contextFor(d: NetworksData, spec: NetworkSpec, isNew: boolean): ValidateContext {
  const own = d.model.networks.find((n) => n.id === spec.id)
  const ownPrefix = own?.prefix
  const n = names(spec.id, spec.legacy)
  const sugg = suggestedVids(d.model)
  const apsPerRadio: Record<string, number> = {}
  for (const w of Object.values(d.snapshot.wireless))
    if (w['.type'] === 'wifi-iface' && w.mode === 'ap' && w.network !== spec.id) apsPerRadio[String(w.device)] = (apsPerRadio[String(w.device)] ?? 0) + 1
  return {
    takenIds: new Set(d.ids.filter((x) => x !== spec.id && x !== n.zoneName)),
    usedPrefixes: new Set(d.prefixes.filter((p) => p !== ownPrefix)),
    // other networks' IDs, and the ones networks made before IDs existed will get
    usedVids: new Set(
      d.model.networks.filter((x) => x.id !== spec.id).flatMap((x) => (x.vid != null ? [x.vid] : x.id in sugg ? [sugg[x.id]!] : [])),
    ),
    apsPerRadio,
    isNew,
  }
}

async function stage(ops: Op[]): Promise<void> {
  for (const o of ops) {
    if (o.op === 'add') await call('uci', 'add', { config: o.config, type: o.type, name: o.section, values: o.values })
    else if (o.op === 'set') await uci.set(o.config, o.section, o.values)
    else if (o.op === 'unset') await uci.del(o.config, o.section, o.options)
    else
      await call('uci', 'delete', { config: o.config, section: o.section }).catch((e: unknown) => {
        if (!(e instanceof UbusError && e.code === 4)) throw e
      })
  }
}

async function revertAll(): Promise<void> {
  for (const c of CONFIGS) await uci.revert(c).catch(() => undefined)
}

/**
 * Stage and apply. Refuses to start while anything else is staged in this
 * session (another tab, a half-finished LuCI edit): the apply would carry it
 * along. Ports moving can cut off a wired browser: more time to come back.
 */
async function run(ops: Op[], portMove: boolean): Promise<void> {
  const pending = await uci.changes()
  if (Object.keys(pending).length) throw new Error(`Unsaved changes are waiting in ${Object.keys(pending).join(', ')}. Save or discard them first.`)
  if (!ops.length) return
  try {
    await stage(ops)
  } catch (e) {
    await revertAll()
    throw e
  }
  await uci.applyWithRollback(portMove ? 90 : 60)
}

export async function saveNetwork(d: NetworksData, spec: NetworkSpec): Promise<void> {
  const ntpServer = spec.kind === 'iot' && spec.iot.ntp && !d.ntpServer
  await run(buildSaveOps(d.snapshot, d.model, spec, { ntpServer }), movesPorts(d.model, spec))
}

/** Change what one LAN port carries: its untagged network, tagged networks, trunk. */
export async function savePort(d: NetworksData, port: LanPort, profile: PortProfile): Promise<void> {
  await run(buildPortOps(d.snapshot, d.model, port, profile, suggestedVids(d.model)), true)
}

export async function removeNetwork(d: NetworksData, id: string): Promise<void> {
  await run(buildRemoveOps(d.snapshot, d.model, id), movesPorts(d.model, null, id))
}

/** Dry run for development: stage, list what would change, revert. */
export async function previewNetwork(d: NetworksData, spec: NetworkSpec): Promise<Record<string, string[][]>> {
  const ops = buildSaveOps(d.snapshot, d.model, spec, { ntpServer: spec.kind === 'iot' && spec.iot.ntp && !d.ntpServer })
  try {
    await stage(ops)
    return await uci.changes()
  } finally {
    await revertAll()
  }
}
