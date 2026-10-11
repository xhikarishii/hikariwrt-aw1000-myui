<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import HkIcon from '@/components/icons/HkIcon.vue'
import LogPager from '@/components/monitor/LogPager.vue'
import SegmentedButton from '@/components/m3/SegmentedButton.vue'
import LineChart, { type ChartSeries } from '@/components/monitor/LineChart.vue'
import * as svc from '@/api/services'
import type { SpeedHistoryIface, SpeedRange } from '@/api/services'
import { useAction } from '@/composables/action'
import { useConfirm } from '@/composables/confirm'
import { usePaged } from '@/composables/paged'
import { usePoll } from '@/composables/poll'
import { luciUrl } from '@/nav'
import { useUi } from '@/stores/ui'

// Monitoring -> Speed test, all of it for the period chosen at the top, like
// the other tabs: the overview (each uplink's averages, with the latest result
// and the schedule), the graphs (download, upload and latency per uplink, in
// the Uptime and Sites tabs' colours) and the log of every test, by hand or
// scheduled. Running one is the app-wide speed test dialog; the schedule is
// set on LuCI's page (the Settings button), how many results are kept and
// where under Storage. Polled every 15 s, so a test run from the dialog, or
// by the schedule, shows up here when it's done.
const ui = useUi()
const router = useRouter()
const { ask } = useConfirm()
const { busy, run } = useAction()

const st = usePoll(() => svc.speedStatus(), 15000)
const li = usePoll(() => svc.speedInterfaces(), 300000)

const s = computed(() => (st.data.value?.ok ? st.data.value : null))
const results = computed(() => [...(s.value?.results ?? [])].sort((a, b) => b.started - a.started))
const latest = computed(() => results.value.find((r) => r.ok) ?? null)
const label = (name: string) => li.data.value?.interfaces.find((i) => i.name === name)?.label ?? name

const mbps = (bps: number | null | undefined) => (bps == null ? '—' : ((bps * 8) / 1e6).toFixed(bps * 8 >= 1e8 ? 0 : 1))
const when = (t: number) => new Date(t * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

// ---- the schedule ----
const sched = computed(() => s.value?.schedule ?? null)
const EVERY: Record<number, string> = { 1: 'every hour', 3: 'every 3 hours', 6: 'every 6 hours', 12: 'every 12 hours', 24: 'once a day' }
const clock = (t: number) => {
  const d = new Date(t * 1000)
  const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${hm}`
}
const gb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`)
const schedLine = computed(() => {
  const sc = sched.value
  if (!sc?.enabled) return 'Not scheduled: tests run only when you start one.'
  const names = sc.ifaces.map(label).join(' and ')
  return `Scheduled ${EVERY[sc.interval] ?? `every ${sc.interval} hours`} over ${names}${sc.next ? ` · next ${clock(sc.next)}` : ''}`
})
const schedCost = computed(() => {
  const sc = sched.value
  if (!sc?.enabled) return ''
  return sc.estimate
    .filter((e) => sc.ifaces.includes(e.iface))
    .map((e) => `about ${gb(e.per_day)} a day over ${label(e.iface)}`)
    .join(' · ')
})

// ---- the history graphs ----
const range = ref<SpeedRange>('7d')
const RANGES: { value: SpeedRange; label: string }[] = [
  { value: '24h', label: '24H' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '365d', label: '1Y' },
]
const hist = usePoll(async () => {
  const r = range.value
  return { r, h: await svc.speedHistory(r) }
}, 60000)
watch(range, () => hist.refresh())
const h = computed(() => (hist.data.value?.r === range.value && hist.data.value.h.ok ? hist.data.value.h : null))
// a new result is a new point
watch(
  () => results.value[0]?.started,
  (t, was) => {
    if (was != null && t !== was) hist.refresh()
  },
)
const COLORS = ['rgb(var(--v-theme-primary))', 'rgb(var(--v-theme-tertiary))', 'rgb(var(--v-theme-secondary))', 'rgb(var(--v-theme-info))']
const colorOf = (name: string) => COLORS[Math.max(0, (h.value?.ifaces ?? []).findIndex((w) => w.name === name)) % COLORS.length]!
const tested = computed(() => (h.value?.ifaces ?? []).filter((w) => w.tests > 0))
type Key = 'download' | 'upload' | 'latency'
const seriesOf = (k: Key): ChartSeries[] =>
  tested.value.map((w: SpeedHistoryIface) => ({ label: w.label, color: colorOf(w.name), values: w[k], band: [w[`${k}_min`], w[`${k}_max`]] }))
const mb = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1))
const ms = (v: number) => v.toFixed(0)

// ---- the log: every test of the period, with the kept result's details when there is one ----
const log = computed(() =>
  (h.value?.log ?? []).map(([t, iface, ok, down, up, lat, auto]) => ({ t, iface, ok, down, up, lat, auto, rec: results.value.find((r) => r.started === t) ?? null })),
)
const logPage = usePaged(log, () => range.value)

const kept = computed(() => {
  const p = s.value?.persist
  return p?.enabled ? `Every test, saved on ${p.path}.` : 'Every test, kept in RAM: they go at the next reboot.'
})

async function clear(): Promise<void> {
  const ok = await ask({
    title: 'Clear the results?',
    text: 'Every kept speed test result is deleted, and the history the graphs draw - the saved copies too. This can’t be undone.',
    confirm: 'Clear',
    destructive: true,
  })
  if (ok && (await run('clear', svc.speedClear, 'Results cleared'))) await Promise.all([st.refresh(), hist.refresh()])
}
</script>

<template>
  <div class="hk-mon">
    <v-alert v-if="st.error.value" type="error" variant="tonal" rounded="xl">
      {{ st.error.value instanceof Error ? st.error.value.message : st.error.value }}
    </v-alert>

    <template v-if="s">
      <v-alert v-if="!s.installed" type="warning" variant="tonal" rounded="xl">The Ookla speedtest program isn’t installed on the router.</v-alert>

      <div class="hk-mon-bar">
        <SegmentedButton v-model="range" :options="RANGES" label="Period" class="hk-mon-range" />
      </div>

      <!-- Overview: each uplink over the period, the latest result, the schedule -->
      <section class="hk-card" aria-label="Overview">
        <div class="d-flex align-center ga-3 flex-wrap">
          <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
            <h2 class="hk-h2">Speed</h2>
            <span class="hk-label">
              <template v-if="s.running">{{ s.run?.auto ? 'A scheduled test is running…' : 'A test is running…' }}</template>
              <template v-else-if="latest">
                Latest {{ when(latest.started) }} over {{ label(latest.interface) }} · ↓ {{ mbps(latest.download) }} ↑ {{ mbps(latest.upload) }} Mbps ·
                {{ latest.latency?.toFixed(0) ?? '—' }} ms
              </template>
              <template v-else>No tests yet</template>
            </span>
          </div>
          <v-btn color="primary" variant="flat" height="48" rounded="pill" :disabled="!s.installed" @click="ui.openSpeedTest()">
            <HkIcon name="speed" :size="18" class="mr-2" />{{ s.running ? 'Show the test' : 'Run speed test' }}
          </v-btn>
        </div>

        <div v-if="tested.length" class="hk-sp-sum">
          <div v-for="w in tested" :key="w.name" class="hk-tile">
            <span class="d-flex align-center" style="font-size: 14px; font-weight: 600"><span class="hk-dot mr-2" :style="{ background: colorOf(w.name) }" />{{ w.label }}</span>
            <span v-if="w.summary.download" style="font-size: 15px; font-variant-numeric: tabular-nums">
              ↓ <b>{{ mb(w.summary.download.avg) }}</b> ↑ <b>{{ w.summary.upload ? mb(w.summary.upload.avg) : '—' }}</b> Mbps ·
              <b>{{ w.summary.latency ? ms(w.summary.latency.avg) : '—' }}</b> ms
            </span>
            <span v-else style="font-size: 14px">No test got through</span>
            <span class="hk-label"
              >{{ w.tests }} test{{ w.tests === 1 ? '' : 's' }}<template v-if="w.failed">, {{ w.failed }} failed</template
              ><template v-if="w.summary.download"> · ↓ {{ mb(w.summary.download.min) }}–{{ mb(w.summary.download.max) }} Mbps</template></span
            >
          </div>
        </div>
        <p v-else-if="h" class="hk-label" style="margin: 0">No tests in this period.</p>

        <div class="hk-sp-sched">
          <HkIcon name="refresh" :size="18" />
          <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
            <span style="font-size: 14px">{{ schedLine }}</span>
            <span v-if="schedCost" class="hk-label">{{ schedCost }}</span>
          </div>
          <v-btn :href="luciUrl('admin/monitoring/speedtest')" variant="text" height="36">{{ sched?.enabled ? 'Change' : 'Schedule' }}</v-btn>
        </div>
      </section>

      <!-- The graphs -->
      <section class="hk-card" aria-label="Over time">
        <div class="hk-mon-head">
          <h2 class="hk-h2">Over time</h2>
          <span class="hk-label">average per bucket, range shaded</span>
        </div>
        <div v-if="h" class="hk-sp-charts">
          <div>
            <div class="hk-sp-ct">Download</div>
            <LineChart :ts="h.ts" :step="h.step" :from="h.from" :to="h.to" :series="seriesOf('download')" :y-max="10" :fmt-y="mb" :fmt-val="(v) => `${mb(v)} Mbps`" label="Download over time" empty="No tests in this period" :height="170" />
          </div>
          <div>
            <div class="hk-sp-ct">Upload</div>
            <LineChart :ts="h.ts" :step="h.step" :from="h.from" :to="h.to" :series="seriesOf('upload')" :y-max="10" :fmt-y="mb" :fmt-val="(v) => `${mb(v)} Mbps`" label="Upload over time" empty="No tests in this period" :height="170" />
          </div>
          <div>
            <div class="hk-sp-ct">Latency</div>
            <LineChart :ts="h.ts" :step="h.step" :from="h.from" :to="h.to" :series="seriesOf('latency')" :y-max="20" :fmt-y="ms" :fmt-val="(v) => `${ms(v)} ms`" label="Latency over time" empty="No tests in this period" :height="170" />
          </div>
        </div>
        <v-skeleton-loader v-else-if="!hist.error.value" type="image" bg-color="transparent" />
      </section>

      <!-- The log: every test of the period -->
      <section class="hk-card" aria-label="Tests" style="gap: 8px">
        <div class="hk-mon-head">
          <h2 class="hk-h2">Tests</h2>
          <span v-if="log.length" class="hk-label">{{ log.length }} in this period</span>
        </div>
        <span class="text-muted" style="font-size: 13px">{{ kept }} The ISP, server and speedtest.net link are kept for the last {{ s.keep ?? 10 }}.</span>

        <template v-if="log.length">
          <div class="hk-group">
            <div v-for="e in logPage.visible.value" :key="`${e.t}${e.iface}`" class="hk-sp-row">
              <span class="hk-dot" :style="{ background: colorOf(e.iface) }" />
              <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
                <span style="font-size: 14px; font-weight: 600">{{ when(e.t) }} · {{ label(e.iface) }}</span>
                <span v-if="e.ok" class="hk-label hk-sp-where">{{
                  [e.auto ? 'Scheduled' : 'By hand', e.rec?.isp, e.rec?.server, e.rec?.location].filter(Boolean).join(' · ')
                }}</span>
                <span v-else class="text-error" style="font-size: 13px">{{
                  e.rec ? `Failed: ${e.rec.error || 'no result'}` : e.auto ? 'Didn’t run: the uplink was down, or out of data allowance' : 'Failed'
                }}</span>
              </div>
              <div v-if="e.ok" class="hk-sp-nums">
                <span title="Download">↓ {{ e.down != null ? mb(e.down) : '—' }}</span>
                <span title="Upload">↑ {{ e.up != null ? mb(e.up) : '—' }}</span>
                <span class="hk-label">Mbps · {{ e.lat != null ? ms(e.lat) : '—' }} ms</span>
              </div>
              <v-btn v-if="e.rec?.url" :href="e.rec.url" target="_blank" rel="noopener" icon variant="text" size="small" aria-label="Open the result on speedtest.net">
                <HkIcon name="advanced" :size="18" />
              </v-btn>
            </div>
          </div>
          <LogPager :p="logPage" label="Tests" />
        </template>
        <span v-else-if="h" class="text-muted" style="font-size: 14px">No tests in this period.</span>

        <div class="d-flex flex-wrap justify-end ga-2">
          <v-btn variant="text" height="40" @click="router.replace({ query: { tab: 'storage' } })">Where they’re kept</v-btn>
          <v-btn v-if="results.length || log.length" variant="text" color="error" height="40" :loading="busy.clear" :disabled="s.running" @click="clear">Clear</v-btn>
        </div>
      </section>
    </template>
    <section v-else-if="!st.error.value" class="hk-card"><v-skeleton-loader type="heading, text@4" bg-color="transparent" /></section>
  </div>
</template>

<style scoped>
.hk-sp-sched {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 8px 8px 16px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface-container-lowest));
}
.hk-sp-sum {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}
.hk-sp-sum .hk-tile {
  padding: 12px 14px;
  gap: 4px;
}
.hk-sp-charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}
.hk-sp-ct {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
}
.hk-sp-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px 10px 16px;
  background: rgb(var(--v-theme-surface-container-lowest));
}
.hk-sp-where {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hk-sp-nums {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex: none;
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
