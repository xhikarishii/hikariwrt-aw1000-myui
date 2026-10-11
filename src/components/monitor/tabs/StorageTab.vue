<script setup lang="ts">
import { computed } from 'vue'
import * as monitor from '@/api/monitor'
import { useAction } from '@/composables/action'
import { usePoll } from '@/composables/poll'
import { luciUrl } from '@/nav'
import { bucketTime } from '@/utils/series'

// Monitoring -> Storage: one setting for every monitor's history - Uptime,
// Sites, Signal and the Clients page's traffic - as LuCI's Monitoring ->
// Storage shows it: where it is kept, how often it is saved, for how long,
// and what each running monitor has saved. Changing that is done there (the
// Change button); saving now is an action, so it's here too.
const { busy, run } = useAction()
const st = usePoll(() => monitor.storage(), 30000)

const EVERY: Record<number, string> = { 1800: '30 minutes', 3600: 'hour', 21600: '6 hours', 43200: '12 hours', 86400: 'day', 604800: '7 days' }
const KIND = { flash: 'the router’s internal flash', usb: 'router storage on USB', drive: 'a drive' } as const
const WHAT: Record<string, string> = {
  uptime: 'Latency, loss, traffic and outages for each WAN',
  sites: 'How fast each site answered, and the restarts and reboots',
  signal: 'The 5G modem’s readings, bands and cell changes',
  clients: 'Each device’s internet traffic, per day',
}
const keep = (d: number) => (d === 730 ? '2 years' : d === 365 ? '1 year' : `${d} days`)
const size = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} kB`)

const s = computed(() => (st.data.value?.ok ? st.data.value : null))
const p = computed(() => s.value?.persist ?? null)
const total = computed(() => (s.value?.histories ?? []).reduce((a, h) => a + (h.kb || 0), 0))
const failing = computed(() => (s.value?.histories ?? []).some((h) => h.error))

async function saveNow(): Promise<void> {
  if (await run('flush', monitor.flush, 'Every history saved')) await st.refresh()
}
</script>

<template>
  <div class="hk-mon">
    <v-alert v-if="st.error.value" type="error" variant="tonal" rounded="xl">
      {{ st.error.value instanceof Error ? st.error.value.message : st.error.value }}
    </v-alert>

    <section v-if="s && p" class="hk-card" aria-label="Monitoring history" style="gap: 14px">
      <div class="d-flex align-center ga-3">
        <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
          <h2 class="hk-h2">Monitoring history</h2>
          <span class="hk-label">One setting for every monitor</span>
        </div>
        <span class="hk-chip" :class="p.enabled ? (failing ? 'hk-state--degraded' : 'hk-state--up') : 'hk-state--off'">
          {{ p.enabled ? (failing ? 'Not saving' : 'On storage') : 'RAM only' }}
        </span>
      </div>

      <div class="hk-group">
        <template v-if="p.enabled">
          <div class="hk-st-row">
            <span class="hk-label">Kept in</span>
            <span>{{ p.path ?? `${p.target} (not mounted)` }}<template v-if="p.kind"> · {{ KIND[p.kind] }}</template></span>
          </div>
          <div class="hk-st-row">
            <span class="hk-label">Saved</span>
            <span>Every {{ EVERY[p.flush_interval ?? 1800] ?? `${Math.round((p.flush_interval ?? 1800) / 60)} minutes` }}, and on every reboot or shutdown</span>
          </div>
          <div class="hk-st-row">
            <span class="hk-label">Kept for</span>
            <span>{{ keep(p.days) }}<template v-if="p.path"> · {{ size(total) }} in all</template></span>
          </div>
        </template>
        <div v-else class="hk-st-row">
          <span class="hk-label">Kept in</span>
          <span>RAM only, for {{ s.retain_days }} days: forgotten on reboot</span>
        </div>
      </div>

      <v-alert v-if="p.enabled && p.kind === 'flash'" type="warning" variant="tonal" rounded="lg" density="compact">
        This writes to the router’s internal flash, which wears with writes. Saves only add the new rows, but saving once a day is kinder, and a USB drive avoids
        it altogether.
      </v-alert>

      <div>
        <div class="hk-label mb-2">What is kept</div>
        <div class="hk-group">
          <div v-for="h in s.histories" :key="h.id" class="hk-st-hist">
            <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
              <span style="font-size: 14px; font-weight: 600">{{ h.name }}</span>
              <span class="hk-label">{{ WHAT[h.id] }}</span>
            </div>
            <div class="d-flex flex-column align-end" style="flex: none">
              <span v-if="!p.enabled" class="hk-label">In RAM</span>
              <span v-else-if="h.error" class="text-error" style="font-size: 13px">Not saved: {{ h.error }}</span>
              <span v-else class="hk-label">{{ h.last_flush ? `Saved ${bucketTime(h.last_flush)}` : 'Not saved yet' }}</span>
              <span v-if="p.enabled && p.path" class="hk-label">{{ size(h.kb) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="d-flex flex-wrap justify-end ga-2">
        <v-btn v-if="p.enabled" variant="text" color="primary" height="40" :loading="busy.flush" @click="saveNow">Save now</v-btn>
        <v-btn :href="luciUrl('admin/monitoring/storage')" variant="flat" color="secondary-container" height="40">Change</v-btn>
      </div>
    </section>
    <section v-else-if="!st.error.value" class="hk-card"><v-skeleton-loader type="heading, text@4" bg-color="transparent" /></section>
  </div>
</template>

<style scoped>
.hk-st-row {
  display: flex;
  align-items: baseline;
  gap: 16px;
  padding: 10px 16px;
  background: rgb(var(--v-theme-surface-container-lowest));
  font-size: 14px;
}
.hk-st-row > .hk-label {
  flex: 0 0 90px;
}
.hk-st-row > span:last-child {
  min-width: 0;
  overflow-wrap: anywhere;
}
.hk-st-hist {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: rgb(var(--v-theme-surface-container-lowest));
}
</style>
