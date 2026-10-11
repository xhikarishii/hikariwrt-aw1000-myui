<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import M3Switch from '@/components/m3/M3Switch.vue'
import DailyBars from '@/components/m3/DailyBars.vue'
import LineChart, { type ChartSeries } from '@/components/monitor/LineChart.vue'
import { clientHistory, disconnectWifi, saveHost, setBlocked } from '@/api/clients'
import type { Client } from '@/utils/clients'
import { leaseLeft, rate as linkRate, signalWord } from '@/utils/clients'
import { useAction } from '@/composables/action'
import { useConfirm } from '@/composables/confirm'
import { usePoll } from '@/composables/poll'
import { bytes, duration, signed } from '@/utils/format'
import { rate, rateAxis } from '@/utils/series'
import { ipError } from '@/utils/validate'
import { lookupVendor, type Vendor } from '@/utils/vendor'

// One device: its traffic now and what it has used, how it is connected,
// who made it, and what you can do - give it a static IP, block its
// internet, drop it from Wi-Fi. The traffic comes from aw1000-monitor's
// clients collector (every few seconds, from the connection tracking
// table); the rest from the list the page already polls. The form keeps
// your edits while that list refreshes; it resets only for another device.
const props = defineProps<{ client: Client }>()
const emit = defineEmits<{ changed: [] }>()
const { busy, run } = useAction()
const { ask } = useConfirm()

const BAND: Record<string, string> = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz' }
const form = reactive({ name: '', reserve: false, ip: '' })
const vendor = ref<Vendor | null>(null)

// ---- traffic ----
const history = usePoll(() => clientHistory(props.client.mac), 5000)
const h = computed(() => (history.data.value?.mac === props.client.mac ? history.data.value : null))

watch(
  () => props.client.mac,
  async (mac, old) => {
    const c = props.client
    Object.assign(form, { name: c.host?.name ?? '', reserve: c.reserved, ip: c.host?.ip || c.ip || '' })
    vendor.value = null
    if (old) history.refresh()
    const v = await lookupVendor(mac)
    if (mac === props.client.mac) vendor.value = v
  },
  { immediate: true },
)
const ipErr = computed(() => (form.reserve ? ipError(form.ip) : null))
const dirty = computed(() => {
  const c = props.client
  return form.name !== (c.host?.name ?? '') || form.reserve !== c.reserved || (form.reserve && form.ip !== (c.host?.ip ?? ''))
})

const connection = computed(() => {
  const c = props.client
  if (c.link === 'wifi') return `${c.guest ? 'Guest ' : ''}Wi-Fi ${BAND[c.band ?? ''] ?? ''}`.trim()
  if (c.link === 'wired') return c.guest ? 'Guest network' : 'Wired or mesh'
  return 'Not seen recently'
})
const vendorText = computed(() => {
  const v = vendor.value
  if (!v) return null
  return v.kind === 'vendor' ? v.name : v.kind === 'private' ? 'Private address (no maker)' : 'Maker not listed'
})

const now = computed(() => {
  const x = h.value
  if (!x?.ts.length) return null
  return { down: x.down[x.down.length - 1] ?? 0, up: x.up[x.up.length - 1] ?? 0 }
})
const chart = computed(() => {
  const x = h.value
  const last = x?.ts[x.ts.length - 1] ?? Math.floor(Date.now() / 1000)
  return { ts: x?.ts ?? [], step: x?.interval ?? 5, from: last - 600, to: last }
})
const series = computed<ChartSeries[]>(() => {
  const x = h.value
  if (!x) return []
  return [
    { label: 'Download', color: 'rgb(var(--v-theme-primary))', values: x.down, area: true },
    { label: 'Upload', color: 'rgb(var(--v-theme-tertiary))', values: x.up },
  ]
})
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const usage = computed(() => {
  const days = h.value?.days ?? []
  const today = todayIso()
  const t = days.find((d) => d.date === today)
  const month = days.filter((d) => d.date.slice(0, 7) === today.slice(0, 7))
  return {
    today: t ? { down: t.down, up: t.up } : { down: 0, up: 0 },
    month: month.reduce((a, d) => ({ down: a.down + d.down, up: a.up + d.up }), { down: 0, up: 0 }),
  }
})
const lastDays = computed(() => (h.value?.days ?? []).slice(-30).map((d) => ({ date: d.date, rx: d.down, tx: d.up })))

// ---- actions ----
async function save(): Promise<void> {
  const done = form.reserve ? 'Saved; the device gets this address when it next renews its lease' : 'Saved'
  if (await run('save', () => saveHost(props.client, form.name.trim(), form.reserve ? form.ip.trim() : null), done)) emit('changed')
}

async function block(v: boolean): Promise<void> {
  const name = props.client.name ?? 'this device'
  if (v) {
    const ok = await ask({
      title: `Block internet for ${name}?`,
      text: 'It stays on your network and can still reach your other devices, but not the internet. New connections stop at once; ones already open may carry on for a minute or two.',
      confirm: 'Block',
      destructive: true,
    })
    if (!ok) return
  }
  if (await run('block', () => setBlocked(props.client, v), v ? `${name} is blocked` : `${name} can use the internet again`)) emit('changed')
}

async function kick(): Promise<void> {
  const ok = await ask({
    title: 'Disconnect from Wi-Fi?',
    text: 'The device is dropped from Wi-Fi. It can rejoin right away if it still has the password; block it or change the password to keep it off.',
    confirm: 'Disconnect',
  })
  if (ok && (await run('kick', () => disconnectWifi(props.client), 'Disconnected'))) emit('changed')
}
</script>

<template>
  <div class="hk-sheet">
    <div class="d-flex align-center ga-4">
      <span class="hk-dev-icon big" :class="{ on: client.online, blocked: client.blocked }">
        <HkIcon :name="client.guest ? 'guest' : client.link === 'wifi' ? 'wifi' : 'ethernet'" :size="28" />
      </span>
      <div class="d-flex flex-column" style="min-width: 0">
        <span class="hk-h2" style="font-size: 22px; overflow-wrap: anywhere">{{ client.name ?? 'Unknown device' }}</span>
        <span class="text-muted" style="font-size: 14px">
          <template v-if="vendor?.kind === 'vendor'">{{ vendorText }} · </template>{{ connection }}<template v-if="client.online"> · connected</template>
        </span>
      </div>
    </div>

    <div v-if="client.blocked || client.reserved || client.randomMac" class="d-flex flex-wrap ga-2">
      <span v-if="client.blocked" class="hk-chip hk-chip--error">Internet blocked</span>
      <span v-if="client.reserved" class="hk-chip hk-chip--tonal"><HkIcon name="check" :size="14" />Static IP</span>
      <span v-if="client.randomMac" class="hk-chip hk-chip--outline" title="Phones use a different made-up address on each network">Private address</span>
    </div>

    <!-- Traffic now -->
    <section class="hk-box" aria-label="Traffic now">
      <div class="d-flex align-baseline flex-wrap ga-3">
        <span class="hk-label flex-grow-1">Traffic now</span>
        <span class="hk-now"><span class="dn">↓ {{ now ? rate(now.down) : '—' }}</span><span class="up">↑ {{ now ? rate(now.up) : '—' }}</span></span>
      </div>
      <LineChart v-if="h" v-bind="chart" :series="series" :height="140" :fmt-y="rateAxis" :fmt-val="rate" label="Traffic over the last ten minutes" empty="No traffic yet" />
      <span v-else-if="history.error.value" class="hk-label">
        Traffic isn’t available: {{ history.error.value instanceof Error ? history.error.value.message : history.error.value }}
      </span>
      <v-skeleton-loader v-else type="image" height="140" bg-color="transparent" />
      <span class="hk-label">Its internet traffic over the last ten minutes, every {{ h?.interval ?? 5 }} s.</span>
    </section>

    <!-- What it has used -->
    <section class="hk-box" aria-label="Data used">
      <span class="hk-label">Data used</span>
      <div class="hk-usage">
        <div class="hk-tile">
          <span class="hk-label">Today</span>
          <span class="hk-usage__v">{{ bytes(usage.today.down + usage.today.up) }}</span>
          <span class="hk-label hk-split"><span>↓ {{ bytes(usage.today.down) }}</span><span>↑ {{ bytes(usage.today.up) }}</span></span>
        </div>
        <div class="hk-tile">
          <span class="hk-label">This month</span>
          <span class="hk-usage__v">{{ bytes(usage.month.down + usage.month.up) }}</span>
          <span class="hk-label hk-split"><span>↓ {{ bytes(usage.month.down) }}</span><span>↑ {{ bytes(usage.month.up) }}</span></span>
        </div>
        <div v-if="client.link === 'wifi' && client.online" class="hk-tile">
          <span class="hk-label">Since joining</span>
          <!-- the access point's counters: what it sent is the device's download -->
          <span class="hk-usage__v">{{ bytes((client.txBytes ?? 0) + (client.rxBytes ?? 0)) }}</span>
          <span class="hk-label hk-split"><span>↓ {{ bytes(client.txBytes) }}</span><span>↑ {{ bytes(client.rxBytes) }}</span></span>
        </div>
      </div>
      <DailyBars v-if="lastDays.length > 1" :days="lastDays" :height="70" />
    </section>

    <!-- How it is connected -->
    <dl class="hk-group hk-facts">
      <div><dt>IP address</dt><dd>{{ client.ip ?? '—' }}</dd></div>
      <div>
        <dt>Address from</dt>
        <dd>
          <template v-if="client.reserved">Static IP (DHCP reservation)</template>
          <template v-else-if="client.lease != null">DHCP · lease {{ client.lease < 0 ? 'never expires' : `renews in ${leaseLeft(client.lease)}` }}</template>
          <template v-else>No DHCP lease (set on the device, or not seen)</template>
        </dd>
      </div>
      <div><dt>MAC address</dt><dd>{{ client.mac }}</dd></div>
      <div><dt>Maker</dt><dd>{{ vendorText ?? '…' }}</dd></div>
      <template v-if="client.link === 'wifi'">
        <div><dt>Signal</dt><dd>{{ signalWord(client.signal) }} · {{ signed(client.signal) }} dBm</dd></div>
        <div><dt>Link speed</dt><dd>↓ {{ linkRate(client.txRate) }} · ↑ {{ linkRate(client.rxRate) }}</dd></div>
        <div><dt>Connected for</dt><dd>{{ duration(client.connected) }}</dd></div>
      </template>
    </dl>

    <!-- Static IP and name -->
    <div class="d-flex flex-column ga-3">
      <v-text-field v-model="form.name" label="Name" :placeholder="client.name ?? 'Give it a name'" persistent-placeholder hide-details />
      <div class="d-flex align-center ga-3">
        <div class="d-flex flex-column flex-grow-1">
          <span style="font-size: 14px">Static IP</span>
          <span class="hk-label">Always give it the same address (a DHCP reservation), for port forwards and servers</span>
        </div>
        <M3Switch v-model="form.reserve" label="Static IP" />
      </div>
      <v-text-field v-if="form.reserve" v-model="form.ip" label="IP address" hide-details="auto" :error-messages="ipErr || undefined" />
      <div class="d-flex justify-end">
        <v-btn variant="flat" color="primary" height="40" :disabled="!dirty || !!ipErr" :loading="busy.save" @click="save">Save</v-btn>
      </div>
    </div>

    <v-divider />

    <div class="d-flex align-center ga-3">
      <div class="d-flex flex-column flex-grow-1">
        <span style="font-size: 14px">Block internet</span>
        <span class="hk-label">Keeps local access, stops internet</span>
      </div>
      <M3Switch :model-value="client.blocked" label="Block internet" :busy="busy.block" @update:model-value="block" />
    </div>
    <v-btn v-if="client.link === 'wifi' && client.online" variant="outlined" color="primary" height="40" :loading="busy.kick" style="border-color: rgb(var(--v-theme-outline))" @click="kick">
      Disconnect from Wi-Fi
    </v-btn>
  </div>
</template>

<style scoped>
.hk-sheet {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 24px;
}
.hk-dev-icon {
  width: 44px;
  height: 44px;
  border-radius: 22px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: rgb(var(--v-theme-surface-container-highest));
  color: rgb(var(--v-theme-on-surface-muted));
}
.hk-dev-icon.on {
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}
.hk-dev-icon.blocked {
  background: rgb(var(--v-theme-error-container));
  color: rgb(var(--v-theme-on-error-container));
}
.hk-dev-icon.big {
  width: 64px;
  height: 64px;
  border-radius: 32px;
}
.hk-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 20px;
  background: rgb(var(--v-theme-surface-container-lowest));
}
.hk-now {
  display: flex;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.hk-now .dn {
  color: rgb(var(--v-theme-primary));
}
.hk-now .up {
  color: rgb(var(--v-theme-tertiary));
}
.hk-usage {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 8px;
}
.hk-usage .hk-tile {
  background: rgb(var(--v-theme-surface-container));
}
.hk-split {
  display: flex;
  flex-wrap: wrap;
  gap: 0 8px;
}
.hk-split > span {
  white-space: nowrap;
}
.hk-usage__v {
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.hk-facts {
  margin: 0;
  font-size: 14px;
}
.hk-facts > div {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  padding: 6px 14px;
  background: rgb(var(--v-theme-surface-container-lowest));
}
.hk-facts dt {
  flex-grow: 1;
  color: rgb(var(--v-theme-on-surface-muted));
}
.hk-facts dd {
  margin: 0;
  font-size: 13px;
  text-align: right;
  overflow-wrap: anywhere;
}
</style>
