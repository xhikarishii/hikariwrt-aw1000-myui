<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import PageHeader from '@/components/PageHeader.vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import ClientSheet from '@/components/clients/ClientSheet.vue'
import { clientStats, loadClients } from '@/api/clients'
import { usePoll } from '@/composables/poll'
import type { Client } from '@/utils/clients'
import { signalWord } from '@/utils/clients'
import { signed } from '@/utils/format'
import { rate } from '@/utils/series'

// Clients: every device the router knows, Wi-Fi ones live (signal), and
// what each is moving now. The list is polled every 10 s (leases, hints,
// assoclists, uci); the traffic every 5 s from aw1000-monitor's clients
// collector, when it's installed. The open device lives in the URL (?mac=)
// so search can link to it.
const route = useRoute()
const router = useRouter()
const { xs } = useDisplay()
const list = usePoll(loadClients, 10000)
const stats = usePoll(() => clientStats().catch(() => null), 5000)
const trafficOf = (c: Client) => stats.data.value?.clients[c.mac] ?? null

type Filter = 'all' | 'wifi' | 'wired' | 'guest' | 'blocked'
const filter = ref<Filter>('all')
const query = ref('')
const BAND: Record<string, string> = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz' }

const clients = computed(() => list.data.value ?? [])
const counts = computed(() => ({
  all: clients.value.length,
  wifi: clients.value.filter((c) => c.link === 'wifi').length,
  wired: clients.value.filter((c) => c.link === 'wired').length,
  guest: clients.value.filter((c) => c.guest).length,
  blocked: clients.value.filter((c) => c.blocked).length,
}))
const FILTERS = computed(() =>
  (
    [
      ['all', 'All'],
      ['wifi', 'Wi-Fi'],
      ['wired', 'Wired'],
      ['guest', 'Guests'],
      ['blocked', 'Blocked'],
    ] as [Filter, string][]
  ).filter(([f]) => f === 'all' || counts.value[f] > 0),
)
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return clients.value.filter((c) => {
    if (filter.value === 'wifi' && c.link !== 'wifi') return false
    if (filter.value === 'wired' && c.link !== 'wired') return false
    if (filter.value === 'guest' && !c.guest) return false
    if (filter.value === 'blocked' && !c.blocked) return false
    return !q || `${c.name ?? ''} ${c.ip ?? ''} ${c.mac}`.toLowerCase().includes(q)
  })
})

function line(c: Client): string {
  const parts = [c.ip ?? 'no address']
  if (c.link === 'wifi') parts.push(`${c.guest ? 'Guest · ' : ''}${BAND[c.band ?? ''] ?? 'Wi-Fi'}`, `${signalWord(c.signal)} ${signed(c.signal)} dBm`)
  else if (c.link === 'wired') parts.push(c.guest ? 'Guest' : 'Wired')
  return parts.join(' · ')
}

const openMac = computed(() => (typeof route.query.mac === 'string' ? route.query.mac.toUpperCase() : null))
const open = computed(() => clients.value.find((c) => c.mac === openMac.value) ?? null)
const sheet = computed({
  get: () => !!open.value,
  set: (v) => {
    if (!v) router.replace({ query: {} })
  },
})
const pick = (c: Client) => router.replace({ query: { mac: c.mac } })
</script>

<template>
  <PageHeader :overline="list.data.value ? `${counts.all} devices · ${counts.wifi} on Wi-Fi` : 'Devices on your network'" title="Clients" />

  <v-alert v-if="list.error.value" type="error" variant="tonal" rounded="xl">
    {{ list.error.value instanceof Error ? list.error.value.message : list.error.value }}
  </v-alert>

  <div class="d-flex flex-wrap align-center ga-3">
    <div class="d-flex flex-wrap ga-2" role="group" aria-label="Show">
      <button
        v-for="[f, label] in FILTERS"
        :key="f"
        type="button"
        class="hk-filter"
        :class="{ 'is-on': filter === f }"
        :aria-pressed="filter === f ? 'true' : 'false'"
        @click="filter = f"
      >
        <HkIcon v-if="filter === f" name="check" :size="16" :stroke="2.6" />{{ label }} <span class="hk-count">{{ counts[f] }}</span>
      </button>
    </div>
    <v-spacer />
    <label class="hk-find">
      <HkIcon name="search" class="text-muted" :size="20" />
      <input v-model="query" type="search" placeholder="Find a device" aria-label="Find a device" />
    </label>
  </div>

  <section class="hk-card hk-devs" aria-label="Devices">
    <button v-for="c in shown" :key="c.mac" type="button" class="hk-dev" :class="{ 'is-open': c.mac === openMac }" @click="pick(c)">
      <span class="hk-dev-icon" :class="{ on: c.online, blocked: c.blocked }">
        <HkIcon :name="c.guest ? 'guest' : c.link === 'wifi' ? 'wifi' : 'ethernet'" />
      </span>
      <span class="hk-dev__text">
        <span class="hk-dev__name">{{ c.name ?? 'Unknown device' }}</span>
        <span class="hk-dev__line">{{ line(c) }}</span>
      </span>
      <span v-if="!xs && trafficOf(c) && trafficOf(c)!.down + trafficOf(c)!.up > 0" class="hk-dev__rate hk-num">
        ↓ {{ rate(trafficOf(c)!.down) }} · ↑ {{ rate(trafficOf(c)!.up) }}
      </span>
      <span v-if="c.blocked" class="hk-chip hk-chip--error">Blocked</span>
      <span v-else-if="c.reserved && !xs" class="hk-chip hk-chip--outline">Reserved</span>
      <HkIcon name="arrowRight" :size="18" class="text-muted" />
    </button>
    <p v-if="list.data.value && !shown.length" class="text-muted text-center py-6">No devices match.</p>
    <v-skeleton-loader v-if="!list.data.value && !list.error.value" type="list-item-avatar-two-line@5" bg-color="transparent" />
  </section>

  <!-- disable-route-watcher: a temporary drawer closes on every route change,
       and opening one is a route change (?mac=) - it would shut at once. -->
  <v-navigation-drawer v-if="!xs" v-model="sheet" location="right" temporary disable-route-watcher width="440" color="surface-container-low">
    <ClientSheet v-if="open" :client="open" @changed="list.refresh()" />
  </v-navigation-drawer>
  <v-bottom-sheet v-else v-model="sheet" inset>
    <v-card color="surface-container-low" rounded="t-xl" style="max-height: 88dvh; overflow-y: auto">
      <ClientSheet v-if="open" :client="open" @changed="list.refresh()" />
    </v-card>
  </v-bottom-sheet>
</template>

<style scoped>
.hk-filter {
  height: 32px;
  padding: 0 12px;
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
.hk-count {
  font-weight: 500;
  opacity: 0.75;
}
.hk-find {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  width: min(320px, 100%);
  padding: 0 16px;
  border-radius: 22px;
  background: rgb(var(--v-theme-surface-container-high));
}
.hk-find input {
  flex-grow: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font: inherit;
  font-size: 15px;
  color: rgb(var(--v-theme-on-surface));
}
.hk-devs {
  padding: 8px;
  gap: 0;
}
.hk-dev {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 10px 16px 10px 10px;
  border: 0;
  border-radius: 20px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.hk-dev:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.hk-dev.is-open {
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}
.hk-dev:focus-visible {
  outline: 3px solid rgb(var(--v-theme-secondary));
  outline-offset: -3px;
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
.hk-dev__text {
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hk-dev__name {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hk-dev__line {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-muted));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.is-open .hk-dev__line {
  color: inherit;
  opacity: 0.8;
}
.hk-dev__rate {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-muted));
  white-space: nowrap;
}
</style>
