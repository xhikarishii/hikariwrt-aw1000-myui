<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import NetworkDialog from '@/components/networks/NetworkDialog.vue'
import PortDialog from '@/components/networks/PortDialog.vue'
import { loadNetworks, removeNetwork, type NetworksData } from '@/api/networks'
import { useAction } from '@/composables/action'
import { useConfirm } from '@/composables/confirm'
import { HOME_VID, KIND_INFO, LAN_PORTS, movesPorts, type LanPort, type NetworkSpec } from '@/utils/networks'

// Networks: Home (untagged VLAN 1) plus the networks made here (guests,
// smart home, ...), each a VLAN with its own subnet, firewall zone and
// Wi-Fi, carried on LAN ports untagged or as 802.1Q tags - the layout this
// router's NSS forwards in hardware. The ports card shows what each port
// carries and opens its VLAN settings. Loaded on open and after each change
// (not polled: a refresh would close a dialog mid-edit).
const data = ref<NetworksData | null>(null)
const error = ref('')
const dialog = ref(false)
const editing = ref<NetworkSpec | null>(null)
const portDialog = ref(false)
const portEditing = ref<LanPort | null>(null)
function editPort(p: LanPort): void {
  portEditing.value = p
  portDialog.value = true
}
const { busy, run } = useAction()
const { ask } = useConfirm()

async function load(): Promise<void> {
  try {
    data.value = await loadNetworks()
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
onMounted(load)
// The firewall and Wi-Fi take a moment to come back with the new layout.
const afterChange = () => setTimeout(load, 3000)

const model = computed(() => data.value?.model ?? null)
const networks = computed(() => model.value?.networks ?? [])
const devices = computed(() => Object.values(data.value?.clients ?? {}).reduce((a, b) => a + b, 0))
const nDevices = (n: number) => `${n} ${n === 1 ? 'device' : 'devices'}`

const COLORS = ['rgb(var(--v-theme-tertiary))', 'rgb(var(--v-theme-secondary))', 'rgb(var(--v-theme-info))', 'rgb(var(--v-theme-success))', 'rgb(var(--v-theme-warning))']
const HOME = 'rgb(var(--v-theme-primary))'
const colorOf = (id: string) => (id === 'lan' ? HOME : COLORS[Math.max(0, networks.value.findIndex((n) => n.id === id)) % COLORS.length]!)
const ICON = { guest: 'guest', iot: 'iot', trusted: 'shield', custom: 'networks' } as const
const BAND: Record<string, string> = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz' }
const bandsOf = (radios: string[]) => radios.map((r) => BAND[data.value?.radios.find((x) => x.name === r)?.band ?? ''] ?? r).join(' + ')

// What each port carries: its untagged network, and the VLANs tagged on it.
const ports = computed(() =>
  LAN_PORTS.map((p) => {
    const m = model.value
    const owner = m?.networks.find((n) => n.ports[p] === 'untagged')
    const foreign = m?.foreign.find((b) => b.ports.includes(p))
    const untagged = owner
      ? { id: owner.id, label: owner.label }
      : foreign
        ? { id: '', label: foreign.name }
        : m?.home.ports.includes(p)
          ? { id: 'lan', label: 'Home' }
          : null
    const tagged = (m?.networks ?? []).filter((n) => n.ports[p] === 'tagged').map((n) => ({ id: n.id, label: n.label, vid: n.vid }))
    return { port: p, untagged, tagged, trunk: !!m?.portMeta[p].trunk, foreign: !!foreign }
  }),
)

const homeWifi = computed(() =>
  Object.values(data.value?.snapshot.wireless ?? {}).filter((w) => w['.type'] === 'wifi-iface' && w.mode === 'ap' && w.network === 'lan' && w.disabled !== '1'),
)
const homeSsids = computed(() => [...new Set(homeWifi.value.map((w) => String(w.ssid ?? '')))].join(', '))

function portsLine(n: NetworkSpec): string {
  const u = LAN_PORTS.filter((p) => n.ports[p] === 'untagged').map((p: LanPort) => `LAN ${p.slice(3)}`)
  const t = LAN_PORTS.filter((p) => n.ports[p] === 'tagged').map((p: LanPort) => `LAN ${p.slice(3)}`)
  const parts = []
  if (u.length) parts.push(u.join(', '))
  if (t.length) parts.push(`tagged on ${t.join(', ')}`)
  return parts.join(' · ') || 'No wired ports'
}

function add(): void {
  editing.value = null
  dialog.value = true
}
function edit(n: NetworkSpec): void {
  editing.value = n
  dialog.value = true
}
async function remove(n: NetworkSpec): Promise<void> {
  const d = data.value
  if (!d) return
  const moves = movesPorts(d.model, null, n.id)
  const ok = await ask({
    title: `Remove ${n.label}?`,
    text:
      `Its Wi-Fi, addresses and firewall rules go; devices on it drop off.` +
      (moves ? ' Its ports go back to Home.' : '') +
      '\n\nIf the router can’t hear back from you in time, it undoes the removal.',
    confirm: 'Remove',
    destructive: true,
  })
  if (!ok) return
  if (await run(`rm-${n.id}`, () => removeNetwork(d, n.id), `${n.label} removed`)) afterChange()
}
</script>

<template>
  <PageHeader :overline="data ? `${networks.length + 1} networks · ${nDevices(devices)}` : 'Separate networks for guests and devices'" title="Networks">
    <template #actions>
      <v-btn v-if="data" variant="flat" color="primary" height="48" rounded="pill" @click="add"><HkIcon name="networks" :size="18" class="mr-2" />Add network</v-btn>
    </template>
  </PageHeader>

  <v-alert v-if="error" type="error" variant="tonal" rounded="xl">{{ error }}</v-alert>

  <template v-if="data && model">
    <!-- What each port carries -->
    <section class="hk-card" aria-label="Ports">
      <div class="d-flex align-center ga-3">
        <h2 class="hk-h2 flex-grow-1">Ports</h2>
        <span class="hk-label">Untagged network · tagged VLANs · tap a port to change it</span>
      </div>
      <div class="hk-ports">
        <button
          v-for="p in ports"
          :key="p.port"
          type="button"
          class="hk-port hk-port--btn"
          :disabled="p.foreign"
          :aria-label="`LAN ${p.port.slice(3)} VLAN settings`"
          @click="editPort(p.port)"
        >
          <span class="hk-port__name">LAN {{ p.port.slice(3) }}<span v-if="p.trunk" class="hk-port__trunk">Trunk</span></span>
          <span v-if="p.untagged" class="hk-port__net"><span class="hk-dot" :style="{ background: p.untagged.id ? colorOf(p.untagged.id) : 'rgb(var(--v-theme-outline))' }" />{{ p.untagged.label }}</span>
          <span v-else class="hk-port__net text-muted">No untagged network</span>
          <span v-for="t in p.tagged" :key="t.id" class="hk-port__vlan"><span class="hk-dot" :style="{ background: colorOf(t.id) }" />VLAN {{ t.vid }} · {{ t.label }}</span>
        </button>
        <div class="hk-port hk-port--wan">
          <span class="hk-port__name">WAN</span>
          <span class="hk-port__net"><HkIcon name="internet" :size="16" />Internet</span>
        </div>
      </div>
    </section>

    <div class="hk-grid-3 hk-nets">
      <!-- Home -->
      <section class="hk-card hk-net" aria-label="Home">
        <div class="d-flex align-center ga-3">
          <span class="hk-net__icon" :style="{ background: HOME }"><HkIcon name="home" /></span>
          <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
            <h2 class="hk-h2">Home</h2>
            <span class="hk-label">Your main network · {{ model.home.prefix }}.0/24</span>
          </div>
          <span class="hk-chip hk-chip--tonal">{{ nDevices(data.clients.lan ?? 0) }}</span>
        </div>
        <div class="hk-net__facts">
          <span><HkIcon name="networks" :size="16" />VLAN {{ HOME_VID }} · untagged</span>
          <span><HkIcon name="wifi" :size="16" />{{ homeSsids || 'No Wi-Fi' }}</span>
          <span><HkIcon name="ethernet" :size="16" />{{ model.home.ports.map((p) => `LAN ${p.slice(3)}`).join(', ') || 'No wired ports' }}</span>
          <span><HkIcon name="internet" :size="16" />Internet, the router and every network it may reach</span>
        </div>
        <div class="d-flex justify-end">
          <v-btn to="/wifi" variant="text" height="40">Wi-Fi settings</v-btn>
        </div>
      </section>

      <section v-for="n in networks" :key="n.id" class="hk-card hk-net" :aria-label="n.label">
        <div class="d-flex align-center ga-3">
          <span class="hk-net__icon" :style="{ background: colorOf(n.id) }"><HkIcon :name="ICON[n.kind]" /></span>
          <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
            <h2 class="hk-h2">{{ n.label }}</h2>
            <span class="hk-label">{{ KIND_INFO[n.kind].title }} · {{ n.prefix }}.0/24</span>
          </div>
          <span class="hk-chip hk-chip--tonal">{{ nDevices(data.clients[n.id] ?? 0) }}</span>
        </div>
        <div class="hk-net__facts">
          <span><HkIcon name="networks" :size="16" />{{ n.vid != null ? `VLAN ${n.vid}` : 'VLAN not set yet: edit to give it one' }}</span>
          <span><HkIcon name="wifi" :size="16" />{{ n.wifi.enabled ? `${n.wifi.ssid} · ${bandsOf(n.wifi.radios)}` : 'No Wi-Fi' }}</span>
          <span><HkIcon name="ethernet" :size="16" />{{ portsLine(n) }}</span>
        </div>
        <div class="d-flex flex-wrap ga-2">
          <span class="hk-chip" :class="n.access.internet ? 'hk-chip--tonal' : 'hk-chip--outline'">{{ n.access.internet ? 'Internet' : 'No internet' }}</span>
          <span v-if="n.access.fromHome" class="hk-chip hk-chip--tonal">Home can reach it</span>
          <span v-if="n.access.toHome" class="hk-chip hk-chip--tonal">Reaches Home</span>
          <span v-if="n.access.router" class="hk-chip hk-chip--tonal">Router settings</span>
          <span v-if="n.wifi.enabled && n.wifi.isolate" class="hk-chip hk-chip--outline">Devices kept apart</span>
          <span v-if="n.kind === 'iot' && (n.iot.compat || n.iot.keepAwake || n.iot.longLeases || n.iot.ntp)" class="hk-chip hk-chip--filled">Tuned for IoT</span>
        </div>
        <div class="d-flex justify-end ga-2">
          <v-btn variant="text" color="error" height="40" :loading="busy[`rm-${n.id}`]" @click="remove(n)">Remove</v-btn>
          <v-btn variant="flat" color="secondary-container" height="40" @click="edit(n)">Edit</v-btn>
        </div>
      </section>

      <button type="button" class="hk-card hk-net hk-net--add" @click="add">
        <HkIcon name="networks" :size="28" />
        <span style="font-size: 15px; font-weight: 600">Add a network</span>
        <span class="hk-label">For guests, smart-home devices, or anything you want kept apart</span>
      </button>
    </div>

    <section class="hk-card" aria-label="Good to know" style="gap: 8px">
      <h2 class="hk-h2">Good to know</h2>
      <ul class="hk-notes">
        <li>Every network is a VLAN; Home is VLAN 1, untagged. It all runs in the router’s network hardware, so separate networks cost no speed.</li>
        <li>A port carries one network untagged and any others tagged. Make a port a trunk to carry every network to a managed switch or access point, and set the same VLAN IDs there.</li>
        <li>Mesh satellites carry Home only. Extra networks reach devices on this router’s ports and Wi-Fi.</li>
        <li>Blocking access affects new connections; ones already open keep going until they end.</li>
      </ul>
    </section>
  </template>
  <div v-else-if="!error" class="hk-grid-3">
    <v-skeleton-loader v-for="i in 3" :key="i" type="heading, text@4" class="hk-card" />
  </div>

  <NetworkDialog v-if="data" v-model="dialog" :data="data" :edit="editing" @saved="afterChange" />
  <PortDialog v-if="data" v-model="portDialog" :data="data" :port="portEditing" @saved="afterChange" />
</template>

<style scoped>
.hk-ports {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}
.hk-port {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface-container-lowest));
  min-width: 0;
}
.hk-port--btn {
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.hk-port--btn:hover:not(:disabled) {
  background: rgb(var(--v-theme-secondary-container), 0.5);
}
.hk-port--btn:focus-visible {
  outline: 3px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}
.hk-port--btn:disabled {
  cursor: default;
}
.hk-port__trunk {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  background: rgb(var(--v-theme-tertiary-container));
  color: rgb(var(--v-theme-on-tertiary-container));
}
.hk-port--wan {
  background: rgb(var(--v-theme-surface-container-low));
}
.hk-port__name {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-muted));
}
.hk-port__net,
.hk-port__vlan {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  min-width: 0;
}
.hk-port__vlan {
  font-size: 12px;
  font-weight: 500;
}
.hk-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.hk-nets {
  align-items: start;
}
.hk-net {
  gap: 14px;
}
.hk-net__icon {
  width: 44px;
  height: 44px;
  border-radius: 22px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  color: rgb(var(--v-theme-surface));
}
.hk-net__facts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
}
.hk-net__facts > span {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.hk-net--add {
  align-items: center;
  justify-content: center;
  text-align: center;
  min-height: 180px;
  border: 2px dashed rgb(var(--v-theme-outline-variant));
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.hk-net--add:focus-visible {
  outline: 3px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}
.hk-notes {
  margin: 0;
  padding-left: 20px;
  font-size: 14px;
  line-height: 1.6;
  color: rgb(var(--v-theme-on-surface-muted));
}
</style>
