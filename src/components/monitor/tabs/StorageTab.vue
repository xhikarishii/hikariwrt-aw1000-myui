<script setup lang="ts">
import { computed } from 'vue'
import * as monitor from '@/api/monitor'
import type { Persist } from '@/api/monitor'
import { useAction } from '@/composables/action'
import { usePoll } from '@/composables/poll'
import { luciUrl } from '@/nav'
import { bucketTime } from '@/utils/series'

// Monitoring -> Storage: where each monitoring history is kept beyond RAM,
// how often it's saved and for how long, as LuCI's Monitoring -> Storage
// shows it. Changing that is done there (the Settings button); saving now is
// an action, so it's here too.
const props = defineProps<{ signal: boolean }>()
const { busy, run } = useAction()

const up = usePoll(() => monitor.status(), 30000)
const site = usePoll(() => monitor.sitestatus().catch(() => null), 30000)
const sig = usePoll(() => (props.signal ? monitor.sigstatus() : Promise.resolve(null)), 30000)

const EVERY: Record<number, string> = { 1800: '30 minutes', 3600: 'hour', 21600: '6 hours', 43200: '12 hours', 86400: 'day', 604800: '7 days' }
const KIND = { flash: 'the router’s internal flash', usb: 'router storage on USB', drive: 'a drive' } as const
const keep = (d: number) => (d === 730 ? '2 years' : d === 365 ? '1 year' : `${d} days`)

interface Card {
  key: 'uptime' | 'sites' | 'signal'
  title: string
  what: string
  p: Persist
  retain: number
  sub: string
  flush: () => Promise<{ ok: boolean; error?: string }>
}

const cards = computed<Card[]>(() => {
  const out: Card[] = []
  const u = up.data.value
  if (u?.ok)
    out.push({ key: 'uptime', title: 'Uptime history', what: 'Latency, loss, traffic and outages for each WAN', p: u.persist, retain: u.retain_days, sub: '', flush: monitor.flush })
  const w = site.data.value
  if (w?.ok)
    out.push({ key: 'sites', title: 'Sites history', what: 'How fast each site answered over each WAN, and the restarts and reboots', p: w.persist, retain: w.retain_days, sub: '/site-checks', flush: monitor.siteflush })
  const s = sig.data.value
  if (s?.ok && s.modem)
    out.push({ key: 'signal', title: 'Signal history', what: 'The 5G modem’s readings, bands and cell changes', p: s.persist, retain: s.retain_days, sub: '/modem-signal', flush: monitor.sigflush })
  return out
})

async function saveNow(c: Card): Promise<void> {
  if (await run(c.key, c.flush, `${c.title} saved`)) await (c.key === 'uptime' ? up.refresh() : c.key === 'sites' ? site.refresh() : sig.refresh())
}
</script>

<template>
  <div class="hk-mon">
    <v-alert v-if="up.error.value" type="error" variant="tonal" rounded="xl">
      {{ up.error.value instanceof Error ? up.error.value.message : up.error.value }}
    </v-alert>

    <div class="hk-mon-health">
      <section v-for="c in cards" :key="c.key" class="hk-card" :aria-label="c.title" style="gap: 12px">
        <div class="d-flex align-center ga-3">
          <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
            <h2 class="hk-h2">{{ c.title }}</h2>
            <span class="hk-label">{{ c.what }}</span>
          </div>
          <span class="hk-chip" :class="c.p.enabled ? (c.p.error ? 'hk-state--degraded' : 'hk-state--up') : 'hk-state--off'">
            {{ c.p.enabled ? (c.p.error ? 'Not saving' : 'On storage') : 'RAM only' }}
          </span>
        </div>

        <div class="hk-group">
          <template v-if="c.p.enabled">
            <div class="hk-st-row">
              <span class="hk-label">Kept in</span>
              <span>{{ c.p.path ? `${c.p.path}${c.sub}` : `${c.p.target} (not mounted)` }}<template v-if="c.p.kind"> · {{ KIND[c.p.kind] }}</template></span>
            </div>
            <div class="hk-st-row">
              <span class="hk-label">Saved</span>
              <span>Every {{ EVERY[c.p.flush_interval ?? 1800] ?? `${Math.round((c.p.flush_interval ?? 1800) / 60)} minutes` }}, and on every reboot or shutdown</span>
            </div>
            <div class="hk-st-row">
              <span class="hk-label">Kept for</span>
              <span>{{ keep(c.p.days) }}</span>
            </div>
            <div class="hk-st-row">
              <span class="hk-label">Last saved</span>
              <span>{{ c.p.last_flush ? bucketTime(c.p.last_flush) : 'Not yet' }}</span>
            </div>
          </template>
          <div v-else class="hk-st-row">
            <span class="hk-label">Kept in</span>
            <span>RAM only, for {{ c.retain }} days: forgotten on reboot</span>
          </div>
        </div>

        <v-alert v-if="c.p.enabled && c.p.error" type="warning" variant="tonal" rounded="lg" density="compact">The last save failed: {{ c.p.error }}.</v-alert>
        <v-alert v-if="c.p.enabled && c.p.kind === 'flash'" type="warning" variant="tonal" rounded="lg" density="compact">
          This writes to the router’s internal flash, which wears with writes. Saves only add the new rows, but saving once a day is kinder, and a USB drive
          avoids it altogether.
        </v-alert>

        <div class="d-flex flex-wrap justify-end ga-2">
          <v-btn v-if="c.p.enabled" variant="text" color="primary" height="40" :loading="busy[c.key]" @click="saveNow(c)">Save now</v-btn>
          <v-btn :href="luciUrl('admin/monitoring/storage')" variant="flat" color="secondary-container" height="40">Change</v-btn>
        </div>
      </section>
      <template v-if="!cards.length && !up.error.value">
        <section v-for="i in 2" :key="i" class="hk-card"><v-skeleton-loader type="heading, text@3" bg-color="transparent" /></section>
      </template>
    </div>
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
</style>
