<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import SegmentedButton from '@/components/m3/SegmentedButton.vue'
import LineChart, { type ChartSeries } from '@/components/monitor/LineChart.vue'
import UptimeBar from '@/components/monitor/UptimeBar.vue'
import * as monitor from '@/api/monitor'
import type { MonitorWan, Range, WanSeries } from '@/api/monitor'
import { usePoll } from '@/composables/poll'
import { bytes, duration } from '@/utils/format'
import { bucketTime, mergeBar, ms, pct, rate, rateAxis, uptimePct } from '@/utils/series'

// Monitoring -> Uptime: internet uptime and quality per WAN, the way UniFi OS
// shows it. A health card per WAN with its uptime bar, then latency, loss,
// jitter and traffic charts, and the outages. Status is polled every 10 s
// (live readings); the series every minute, and at once when the period
// changes. Settings (targets, thresholds) live on the LuCI page; where the
// history is kept is the Storage tab.
const status = usePoll(() => monitor.status(), 10000)
const range = ref<Range>('24h')
const only = ref<string | null>(null)

const data = usePoll(async () => {
  const r = range.value
  const [series, events] = await Promise.all([monitor.series(r), monitor.events(r)])
  return { r, series, events }
}, 60000)
watch(range, () => data.refresh())

const st = computed(() => status.data.value)
const ser = computed(() => (data.data.value?.r === range.value ? data.data.value.series : null))
// Outages of a hidden WAN (from before its interface went off) are left out too.
const outages = computed(() =>
  (data.data.value?.events.events ?? []).filter((e) => wans.value.some((w) => w.name === e.wan) && (!only.value || e.wan === only.value)),
)

// 90 days and a year exist only while history is kept on storage for that long.
const ranges = computed(() => {
  const days = st.value?.persist.enabled ? st.value.persist.days : 0
  return [
    { value: '1h' as Range, label: '1H' },
    { value: '3h' as Range, label: '3H' },
    { value: '6h' as Range, label: '6H' },
    { value: '12h' as Range, label: '12H' },
    { value: '24h' as Range, label: '24H' },
    { value: '7d' as Range, label: '7D' },
    { value: '30d' as Range, label: '30D' },
    ...(days >= 90 ? [{ value: '90d' as Range, label: '90D' }] : []),
    ...(days >= 365 ? [{ value: '365d' as Range, label: '1Y' }] : []),
  ]
})
watch(ranges, (r) => {
  if (!r.some((x) => x.value === range.value)) range.value = '30d'
})

// Colours from the Material You palette: a role per WAN, error for loss.
const COLORS = ['rgb(var(--v-theme-primary))', 'rgb(var(--v-theme-tertiary))', 'rgb(var(--v-theme-secondary))', 'rgb(var(--v-theme-info))']
// WANs whose interface is switched off - the wired wan of a "5G router" -
// have nothing to measure, so the page leaves them out entirely.
const wans = computed(() => st.value?.wans.filter((w) => !w.iface_disabled) ?? [])
const colorOf = (name: string) => COLORS[Math.max(0, wans.value.findIndex((w) => w.name === name)) % COLORS.length]!

const enabled = computed(() => wans.value.filter((w) => w.enabled))
const shown = computed<WanSeries[]>(() =>
  (ser.value?.wans ?? []).filter((s) => enabled.value.some((w) => w.name === s.name) && (!only.value || s.name === only.value)),
)
const one = computed(() => shown.value.length === 1)
const seriesOf = (name: string) => ser.value?.wans.find((s) => s.name === name) ?? null

type Live = { tone: 'up' | 'degraded' | 'down' | 'off'; text: string }
function live(w: MonitorWan): Live {
  if (!w.enabled) return { tone: 'off', text: 'Not monitored' }
  if (!st.value?.running) return { tone: 'off', text: 'Monitor stopped' }
  if (!w.last) return { tone: 'off', text: 'Waiting for data' }
  if (w.outage || !w.last.up) return { tone: 'down', text: w.last.link ? 'No internet' : 'Offline' }
  const r = w.recent
  if (r && ((r.loss ?? 0) >= st.value.degraded_loss || (r.rtt ?? 0) >= st.value.degraded_rtt)) return { tone: 'degraded', text: 'Degraded' }
  return { tone: 'up', text: 'Online' }
}

function quality(kind: 'uptime' | 'rtt' | 'loss', v: number | null): string {
  if (v == null || !st.value) return ''
  if (kind === 'uptime') return v >= 99.9 ? 'is-good' : v >= 99 ? 'is-fair' : 'is-poor'
  const limit = kind === 'rtt' ? st.value.degraded_rtt : st.value.degraded_loss
  return v < limit / 2 ? 'is-good' : v < limit ? 'is-fair' : 'is-poor'
}

const base = computed(() => ({ ts: shown.value[0]?.ts ?? [], step: ser.value?.step ?? 60, from: ser.value?.from ?? 0, to: ser.value?.to ?? 1 }))
const latency = computed<ChartSeries[]>(() =>
  shown.value.map((s) => ({ label: s.label, color: colorOf(s.name), values: s.rtt, band: one.value ? [s.rmin, s.rmax] : undefined })),
)
const loss = computed<ChartSeries[]>(() =>
  shown.value.map((s) => ({ label: s.label, color: one.value ? 'rgb(var(--v-theme-error))' : colorOf(s.name), values: s.loss, area: one.value })),
)
const jitter = computed<ChartSeries[]>(() =>
  shown.value.map((s) => ({ label: s.label, color: one.value ? 'rgb(var(--v-theme-secondary))' : colorOf(s.name), values: s.jitter })),
)
const traffic = computed<ChartSeries[]>(() =>
  shown.value.flatMap((s) => [
    { label: one.value ? 'Download' : `${s.label} download`, color: one.value ? 'rgb(var(--v-theme-primary))' : colorOf(s.name), values: s.rx, area: true },
    { label: one.value ? 'Upload' : `${s.label} upload`, color: one.value ? 'rgb(var(--v-theme-tertiary))' : colorOf(s.name), values: s.tx, dash: !one.value },
  ]),
)
const totals = computed(() => shown.value.reduce((a, s) => ({ rx: a.rx + s.summary.rx, tx: a.tx + s.summary.tx }), { rx: 0, tx: 0 }))

const fmtMsAxis = (v: number) => `${v} ms`
const fmtPctAxis = (v: number) => `${v}%`
</script>

<template>
  <div class="hk-mon">
    <v-alert v-if="status.error.value" type="error" variant="tonal" rounded="xl">
      {{ status.error.value instanceof Error ? status.error.value.message : status.error.value }}
    </v-alert>
    <v-alert v-else-if="st && !st.running" type="warning" variant="tonal" rounded="xl">The monitor isn’t running, so nothing is being recorded.</v-alert>
    <v-alert v-else-if="st && !st.clock_ok" type="info" variant="tonal" rounded="xl">Waiting for the router’s clock to be set before recording.</v-alert>
    <v-alert v-if="st?.persist.enabled && st.persist.error" type="warning" variant="tonal" rounded="xl">
      History couldn’t be saved: {{ st.persist.error }}. It’s kept in RAM until the storage is back.
    </v-alert>

    <div class="hk-mon-bar">
      <SegmentedButton v-model="range" :options="ranges" label="Period" class="hk-mon-range" />
      <div v-if="enabled.length > 1" class="d-flex flex-wrap ga-2" role="group" aria-label="WANs shown">
        <button type="button" class="hk-filter" :class="{ 'is-on': !only }" :aria-pressed="!only" @click="only = null">
          <HkIcon v-if="!only" name="check" :size="16" :stroke="2.6" />All WANs
        </button>
        <button v-for="w in enabled" :key="w.name" type="button" class="hk-filter" :class="{ 'is-on': only === w.name }" :aria-pressed="only === w.name" @click="only = w.name">
          <span class="hk-dot" :style="{ background: colorOf(w.name) }" />{{ w.label }}
        </button>
      </div>
    </div>

    <!-- Health, one card per WAN -->
    <div class="hk-mon-health">
      <template v-if="st">
        <section v-for="w in wans" :key="w.name" class="hk-card" :aria-label="`${w.label} health`" style="gap: 14px">
          <div class="d-flex align-center ga-3">
            <span class="hk-dot hk-dot--lg" :style="{ background: colorOf(w.name) }" />
            <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
              <h2 class="hk-h2">{{ w.label }}</h2>
              <span class="hk-label">{{ w.name }}<template v-if="w.last?.device"> · {{ w.last.device }}</template></span>
            </div>
            <span class="hk-chip" :class="`hk-state--${live(w).tone}`">{{ live(w).text }}</span>
          </div>

          <template v-if="w.enabled">
            <div class="hk-mon-tiles">
              <div class="hk-tile" :title="seriesOf(w.name)?.summary.down_seconds ? `Down for ${duration(seriesOf(w.name)!.summary.down_seconds)}` : undefined">
                <span class="hk-label">Uptime</span>
                <span class="hk-display hk-mon-val" :class="quality('uptime', seriesOf(w.name)?.summary.uptime ?? null)">{{ uptimePct(seriesOf(w.name)?.summary.uptime) }}</span>
              </div>
              <div class="hk-tile">
                <span class="hk-label">Latency</span>
                <span class="hk-display hk-mon-val" :class="quality('rtt', seriesOf(w.name)?.summary.rtt ?? null)">{{ ms(seriesOf(w.name)?.summary.rtt) }}</span>
              </div>
              <div class="hk-tile">
                <span class="hk-label">Packet loss</span>
                <span class="hk-display hk-mon-val" :class="quality('loss', seriesOf(w.name)?.summary.loss ?? null)">{{ pct(seriesOf(w.name)?.summary.loss) }}</span>
              </div>
              <div class="hk-tile" :title="seriesOf(w.name) ? `${bytes(seriesOf(w.name)!.summary.rx)} down · ${bytes(seriesOf(w.name)!.summary.tx)} up` : undefined">
                <span class="hk-label">Data used</span>
                <span class="hk-display hk-mon-val">{{ seriesOf(w.name) ? bytes(seriesOf(w.name)!.summary.rx + seriesOf(w.name)!.summary.tx) : '—' }}</span>
              </div>
            </div>

            <UptimeBar v-if="seriesOf(w.name) && ser" :bar="mergeBar(seriesOf(w.name)!, ser.step, 90)" :from="ser.from" :label="`${w.label} uptime over the period`" />
            <v-skeleton-loader v-else type="text" bg-color="transparent" />

            <div class="hk-mon-live hk-label">
              <span>Now <b>{{ ms(w.last?.rtt) }}</b></span>
              <span>↓ <b>{{ rate(w.last?.rx_rate) }}</b></span>
              <span>↑ <b>{{ rate(w.last?.tx_rate) }}</b></span>
              <span>24h <b>{{ uptimePct(w.uptime['24h']) }}</b> · 7d <b>{{ uptimePct(w.uptime['7d']) }}</b> · 30d <b>{{ uptimePct(w.uptime['30d']) }}</b></span>
            </div>
            <v-alert v-if="w.outage" type="error" variant="tonal" rounded="lg" density="compact">
              Down since {{ bucketTime(w.outage.start) }}: {{ w.outage.cause === 'link' ? 'the link is down' : 'no replies from the targets' }}.
            </v-alert>
          </template>
          <span v-else class="text-muted" style="font-size: 14px">Not pinged, so it costs no data. Turn it on in Settings (LuCI).</span>
        </section>
      </template>
      <template v-else>
        <section v-for="i in 2" :key="i" class="hk-card"><v-skeleton-loader type="heading, text@3" bg-color="transparent" /></section>
      </template>
    </div>

    <!-- Charts -->
    <div v-if="ser && shown.length" class="hk-mon-charts">
      <section class="hk-card" aria-label="Latency" style="gap: 8px">
        <div class="hk-mon-head">
          <h2 class="hk-h2">Latency</h2>
          <span class="hk-label">{{ one ? `avg ${ms(shown[0]!.summary.rtt)} · min–max shaded` : 'average per WAN' }}</span>
        </div>
        <LineChart v-bind="base" :series="latency" :fmt-y="fmtMsAxis" :fmt-val="ms" label="Latency chart" />
      </section>
      <section class="hk-card" aria-label="Packet loss" style="gap: 8px">
        <div class="hk-mon-head">
          <h2 class="hk-h2">Packet loss</h2>
          <span v-if="one" class="hk-label">{{ pct(shown[0]!.summary.loss) }} in this period</span>
        </div>
        <LineChart v-bind="base" :series="loss" :height="150" :y-max="5" :fmt-y="fmtPctAxis" :fmt-val="pct" label="Packet loss chart" />
      </section>
      <section class="hk-card" aria-label="Jitter" style="gap: 8px">
        <div class="hk-mon-head">
          <h2 class="hk-h2">Jitter</h2>
          <span v-if="one" class="hk-label">avg {{ ms(shown[0]!.summary.jitter) }}</span>
        </div>
        <LineChart v-bind="base" :series="jitter" :height="150" :fmt-y="fmtMsAxis" :fmt-val="ms" label="Jitter chart" />
      </section>
      <section class="hk-card hk-mon-wide" aria-label="Traffic" style="gap: 8px">
        <div class="hk-mon-head">
          <h2 class="hk-h2">Traffic</h2>
          <span class="hk-label">↓ {{ bytes(totals.rx) }} · ↑ {{ bytes(totals.tx) }} in this period</span>
        </div>
        <LineChart v-bind="base" :series="traffic" :height="200" :fmt-y="rateAxis" :fmt-val="rate" label="Traffic chart" />
      </section>
    </div>
    <section v-else-if="st && !enabled.length" class="hk-card text-muted">No WAN is being monitored. Turn one on in Settings (LuCI).</section>
    <section v-else class="hk-card"><v-skeleton-loader type="image" bg-color="transparent" /></section>

    <!-- Outages -->
    <section class="hk-card" aria-label="Outages" style="gap: 8px">
      <div class="hk-mon-head">
        <h2 class="hk-h2">Outages</h2>
        <span v-if="outages.length" class="hk-label">{{ outages.length }} in this period</span>
      </div>
      <div v-if="outages.length" class="hk-group">
        <div v-for="o in outages" :key="`${o.wan}${o.start}`" class="hk-mon-outage">
          <span class="hk-dot" :style="{ background: colorOf(o.wan) }" />
          <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
            <span style="font-size: 14px">{{ o.label }} · {{ o.cause === 'link' ? 'link down' : 'no replies' }}</span>
            <span class="hk-label">{{ bucketTime(o.start) }}</span>
          </div>
          <span v-if="o.end == null" class="hk-chip hk-state--down">Ongoing · {{ duration(o.duration) }}</span>
          <span v-else class="hk-num" style="font-size: 14px">{{ duration(o.duration) }}</span>
        </div>
      </div>
      <span v-else class="text-muted" style="font-size: 14px">No outages in this period.</span>
    </section>
  </div>
</template>
