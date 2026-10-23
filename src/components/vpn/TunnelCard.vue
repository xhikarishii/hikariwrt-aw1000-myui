<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import M3Switch from '@/components/m3/M3Switch.vue'
import SegmentedButton from '@/components/m3/SegmentedButton.vue'
import * as vpn from '@/api/vpn'
import type { RouteMode, Tunnel, VpnNetworks } from '@/api/vpn'
import { useAction } from '@/composables/action'
import { useConfirm } from '@/composables/confirm'
import { useNotify } from '@/composables/notify'
import type { Client } from '@/utils/clients'
import { bytes, duration } from '@/utils/format'
import { uplinkLabel } from '@/utils/uplinks'
import { parseList } from '@/utils/validate'

// One WireGuard tunnel: on/off, whose traffic uses it (networks, devices by
// MAC, addresses), which uplink it rides, the peer's state, and removal.
// aw1000-vpn does the routing and firewall work (and the NSS flow flush)
// behind each call.
const props = defineProps<{
  tunnel: Tunnel
  nets: VpnNetworks | null
  /** Devices the router knows, to pick from. */
  clients: Client[]
  /** Network names from the Networks page, by network id. */
  netLabels: Record<string, string>
  /** Label of the other tunnel that routes everyone, if any: only one can. */
  everyoneOwner?: string | null
}>()
const emit = defineEmits<{ changed: [] }>()
const { busy, run } = useAction()
const { ask } = useConfirm()
const notify = useNotify()

const form = reactive({ mode: 'off' as RouteMode, nets: [] as string[], macs: [] as string[], addrs: '', killswitch: false, egress: 'auto' })
function reset(): void {
  const t = props.tunnel
  Object.assign(form, {
    mode: t.route_mode,
    nets: [...t.src_net],
    macs: [...(t.src_mac ?? [])],
    addrs: t.src_addr.join(', '),
    killswitch: t.killswitch,
    egress: t.egress || 'auto',
  })
}
// Reset from the saved values only when they change, not on every 10 s
// refresh (a new object each time), or unsaved edits would vanish.
watch(
  () => JSON.stringify([props.tunnel.route_mode, props.tunnel.src_net, props.tunnel.src_mac, props.tunnel.src_addr, props.tunnel.killswitch, props.tunnel.egress]),
  reset,
  { immediate: true },
)

const same = (a: string[], b: string[]) => a.slice().sort().join() === b.slice().sort().join()
const routeDirty = computed(() => {
  const t = props.tunnel
  return (
    form.mode !== t.route_mode ||
    form.killswitch !== t.killswitch ||
    (form.mode === 'selected' && (!same(form.nets, t.src_net) || !same(form.macs, t.src_mac ?? []) || parseList(form.addrs).join() !== t.src_addr.join()))
  )
})
const nothingPicked = computed(() => form.mode === 'selected' && !form.nets.length && !form.macs.length && !parseList(form.addrs).length)

const netLabel = (id: string) => (id === 'lan' ? 'Home' : (props.netLabels[id] ?? (id === 'guest' ? 'Guest' : id)))
// Every known device, plus any picked one the router no longer sees, so a
// saved choice never silently disappears from the list.
const deviceItems = computed(() => {
  const items = props.clients.map((c) => ({
    value: c.mac.toLowerCase(),
    title: c.name ?? c.mac,
    subtitle: [c.ip, netLabel(c.network?.id ?? 'lan'), c.online ? null : 'offline'].filter(Boolean).join(' · '),
  }))
  for (const m of form.macs) if (!items.some((i) => i.value === m)) items.push({ value: m, title: m.toUpperCase(), subtitle: 'not seen lately' })
  return items
})
const egressDirty = computed(() => form.egress !== (props.tunnel.egress || 'auto'))

const peer = computed(() => props.tunnel.peers[0] ?? null)
const ago = (ts: number) => (ts ? `${duration(Date.now() / 1000 - ts)} ago` : 'never')
// WireGuard re-handshakes every 2 minutes on a live link; 3 min without one
// means the other end isn't answering.
const healthy = computed(() => !!peer.value && peer.value.handshake > 0 && Date.now() / 1000 - peer.value.handshake < 180)
const statusLine = computed(() => {
  const t = props.tunnel
  if (!t.enabled) return 'Off'
  if (!t.up) return 'Starting…'
  if (!peer.value) return 'Up, no peer'
  return healthy.value ? `Connected · handshake ${ago(peer.value.handshake)}` : `No answer from the server · last handshake ${ago(peer.value.handshake)}`
})

const reply = (r: { ok: boolean; warning?: string }) => {
  if (r.ok && r.warning) notify.show(r.warning, 6000)
  return r
}

async function toggle(on: boolean): Promise<void> {
  if (await run('enable', async () => reply(await vpn.enable(props.tunnel.name, on)), `${props.tunnel.label} ${on ? 'on' : 'off'}`)) emit('changed')
}

async function saveRoute(): Promise<void> {
  if (form.mode === 'all') {
    const ok = await ask({
      title: 'Send everything through this tunnel?',
      text: 'All devices on your networks reach the internet through the VPN server. If the tunnel drops, their traffic goes out normally unless the kill switch is on.',
      confirm: 'Route everything',
    })
    if (!ok) return
  }
  const t = props.tunnel
  if (await run('route', async () => reply(await vpn.route(t.name, form.mode, form.nets, parseList(form.addrs), form.killswitch, form.macs)), 'Routing saved')) emit('changed')
}

async function saveEgress(): Promise<void> {
  if (await run('egress', async () => reply(await vpn.egress(props.tunnel.name, form.egress)), 'Uplink saved')) emit('changed')
}

async function removeIt(): Promise<void> {
  const ok = await ask({
    title: `Delete ${props.tunnel.label}?`,
    text: 'The tunnel, its keys and its routing are removed from the router. Keep the provider’s config file if you want it back later.',
    confirm: 'Delete',
    destructive: true,
  })
  if (ok && (await run('remove', async () => reply(await vpn.remove(props.tunnel.name)), 'Tunnel deleted'))) emit('changed')
}
</script>

<template>
  <section class="hk-card" :aria-label="`Tunnel ${tunnel.label}`" style="gap: 14px">
    <div class="d-flex align-center ga-3">
      <span class="hk-tun-icon" :class="{ on: tunnel.enabled && tunnel.up && healthy, warn: tunnel.enabled && !healthy }"><HkIcon name="shield" /></span>
      <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
        <h2 class="hk-h2">{{ tunnel.label }}</h2>
        <span class="text-muted" style="font-size: 13px">{{ statusLine }}</span>
      </div>
      <M3Switch :model-value="tunnel.enabled" :label="`Tunnel ${tunnel.label}`" :busy="busy.enable" @update:model-value="toggle" />
    </div>

    <dl class="hk-group hk-kv">
      <div><dt>Server</dt><dd>{{ peer?.endpoint || '—' }}</dd></div>
      <div><dt>Tunnel address</dt><dd>{{ tunnel.addresses.join(', ') || '—' }}</dd></div>
      <div v-if="peer"><dt>Traffic</dt><dd>↓ {{ bytes(peer.rx) }} · ↑ {{ bytes(peer.tx) }}</dd></div>
    </dl>

    <div>
      <div class="hk-label mb-2">Who uses this tunnel</div>
      <SegmentedButton
        v-model="form.mode"
        label="Who uses this tunnel"
        :options="[
          { value: 'off', label: 'Nobody' },
          { value: 'selected', label: 'Selected' },
          { value: 'all', label: 'Everyone', disabled: !!everyoneOwner, title: everyoneOwner ? `${everyoneOwner} already routes everyone` : undefined },
        ]"
      />
      <p class="hk-label mt-2" style="margin: 0">
        <template v-if="form.mode === 'off'">The tunnel is up but no traffic is sent through it.</template>
        <template v-else-if="form.mode === 'all'">Every device on your networks goes through the VPN.</template>
        <template v-else>Only the networks and devices you pick go through the VPN. Everything else, and traffic between your own networks, goes the usual way.</template>
      </p>
      <p v-if="everyoneOwner" class="hk-label mt-1" style="margin: 0">
        Everyone already goes through {{ everyoneOwner }}, and only one tunnel can route everyone. Devices or networks you pick here use this tunnel instead.
      </p>
    </div>

    <template v-if="form.mode === 'selected'">
      <div class="hk-label">Networks</div>
      <div class="d-flex flex-wrap ga-2" role="group" aria-label="Networks">
        <button
          v-for="n in nets?.networks ?? []"
          :key="n.name"
          type="button"
          class="hk-filter"
          :class="{ 'is-on': form.nets.includes(n.name) }"
          :aria-pressed="form.nets.includes(n.name) ? 'true' : 'false'"
          @click="form.nets = form.nets.includes(n.name) ? form.nets.filter((x) => x !== n.name) : [...form.nets, n.name]"
        >
          <HkIcon v-if="form.nets.includes(n.name)" name="check" :size="16" :stroke="2.6" />{{ netLabel(n.name) }}
        </button>
      </div>
      <v-autocomplete
        v-model="form.macs"
        :items="deviceItems"
        item-props
        :filter-keys="['title', 'raw.subtitle', 'raw.value']"
        label="Devices"
        placeholder="Pick devices"
        hint="Chosen by the device, so it stays in the VPN when its address changes"
        persistent-hint
        multiple
        chips
        closable-chips
        clear-on-select
        auto-select-first
      />
      <v-text-field
        v-model="form.addrs"
        label="Addresses or ranges"
        placeholder="192.168.88.214, 192.168.89.0/24"
        hint="For devices with a fixed address, or part of a network"
        persistent-hint
      />
      <p v-if="nothingPicked" class="text-error" style="font-size: 13px; margin: 0">Pick a network, a device or an address.</p>
    </template>

    <div v-if="form.mode !== 'off'" class="d-flex align-center ga-3">
      <div class="d-flex flex-column flex-grow-1">
        <span style="font-size: 14px">Kill switch</span>
        <span class="hk-label">If the tunnel drops, block that traffic instead of letting it out unprotected</span>
      </div>
      <M3Switch v-model="form.killswitch" label="Kill switch" />
    </div>

    <div class="d-flex justify-end ga-2">
      <v-btn variant="text" color="primary" height="40" :disabled="!routeDirty" @click="reset">Undo changes</v-btn>
      <v-btn variant="flat" color="primary" height="40" :disabled="!routeDirty || nothingPicked" :loading="busy.route" @click="saveRoute">Save routing</v-btn>
    </div>

    <div class="d-flex align-center ga-3">
      <v-select
        v-model="form.egress"
        :items="[{ value: 'auto', title: 'Follow multi-WAN (recommended)' }, ...(nets?.uplinks ?? []).map((u) => ({ value: u.name, title: `Only ${uplinkLabel(u.name)}` }))]"
        label="Reach the server over"
        hide-details
        class="flex-grow-1"
      />
      <v-btn v-if="egressDirty" variant="flat" color="primary" height="40" :loading="busy.egress" @click="saveEgress">Save</v-btn>
    </div>

    <div class="d-flex">
      <v-btn variant="text" color="error" height="40" class="ml-n3" :loading="busy.remove" @click="removeIt">Delete tunnel</v-btn>
    </div>
  </section>
</template>

<style scoped>
.hk-tun-icon {
  width: 48px;
  height: 48px;
  border-radius: 24px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: rgb(var(--v-theme-surface-container-highest));
  color: rgb(var(--v-theme-on-surface-muted));
}
.hk-tun-icon.on {
  background: rgb(var(--v-theme-primary-container));
  color: rgb(var(--v-theme-on-primary-container));
}
.hk-tun-icon.warn {
  background: rgb(var(--v-theme-error-container));
  color: rgb(var(--v-theme-on-error-container));
}
.hk-kv {
  margin: 0;
  font-size: 14px;
}
.hk-kv > div {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  padding: 6px 14px;
  background: rgb(var(--v-theme-surface-container-lowest));
}
.hk-kv dt {
  flex-grow: 1;
  color: rgb(var(--v-theme-on-surface-muted));
}
.hk-kv dd {
  margin: 0;
  font-size: 13px;
  text-align: right;
  overflow-wrap: anywhere;
}
.hk-filter {
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid rgb(var(--v-theme-outline));
  background: transparent;
  color: rgb(var(--v-theme-on-surface-muted));
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.hk-filter.is-on {
  padding-left: 8px;
  border-color: rgb(var(--v-theme-secondary-container));
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}
</style>
