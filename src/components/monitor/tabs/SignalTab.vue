<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import SegmentedButton from '@/components/m3/SegmentedButton.vue'
import LineChart, { type ChartSeries } from '@/components/monitor/LineChart.vue'
import ModeBar from '@/components/monitor/ModeBar.vue'
import * as monitor from '@/api/monitor'
import * as modem from '@/api/modem'
import type { ModemSignal } from '@/api/modem'
import type { ModeState, Range, SignalMetric } from '@/api/monitor'
import { usePoll } from '@/composables/poll'
import { luciUrl } from '@/nav'
import { bucketTime } from '@/utils/series'
import {
  GRADE_NAME, MODE_NAME, MODE_OF, bandShares, db, dbm, gradeOf, gradesFor, mergeModes, worst, zonesOf,
  type Grade, type Metric,
} from '@/utils/signal'

// Monitoring -> Signal: the 5G modem's signal over time, for finding the
// spot, the band and the cell where it does best. The readings now come from
// the modem's own cached status (polled every 10 s, like the Cellular page);
// the history from aw1000-monitor (the series every minute, and at once when
// the period changes). Grades are aw1000-modem's, so this page and the
// Cellular page always agree about a reading.
const sig = usePoll(() => monitor.sigstatus(), 10000)
const now = usePoll(() => modem.status(), 10000)
const range = ref<Range>('24h')
const radio = ref<'all' | 'lte' | 'nr'>('all')

const data = usePoll(async () => {
  const r = range.value
  const [series, events] = await Promise.all([monitor.sigseries(r), monitor.sigevents(r)])
  return { r, series, events }
}, 60000)
watch(range, () => data.refresh())

const st = computed(() => sig.data.value)
const m = computed(() => now.data.value)
const ser = computed(() => (data.data.value?.r === range.value && data.data.value.series.ok ? data.data.value.series : null))
const sum = computed(() => ser.value?.summary ?? null)
const changes = computed(() => data.data.value?.events.changes ?? [])

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
const rangeLabel = computed(() => ranges.value.find((r) => r.value === range.value)?.label ?? '')

const LTE = 'rgb(var(--v-theme-primary))'
const NR = 'rgb(var(--v-theme-tertiary))'
const RADIOS = [
  { id: 'all' as const, label: 'LTE and 5G', color: null },
  { id: 'lte' as const, label: 'LTE', color: LTE },
  { id: 'nr' as const, label: '5G NR', color: NR },
]

const win = (tech: 'lte' | 'nr') => st.value?.rsrp_window?.[tech]
const grade = (metric: Metric, tech: 'lte' | 'nr', v: number | null | undefined): Grade => gradeOf(gradesFor(metric, win(tech)), v)
const TONE: Record<Grade, string> = { excellent: 'is-good', good: 'is-good', fair: 'is-fair', poor: 'is-poor', unknown: '' }
const CHIP: Record<Grade, string> = { excellent: 'up', good: 'up', fair: 'degraded', poor: 'down', unknown: 'off' }

// The readings now: the modem's "signal" is the LTE anchor (or the NR cell
// in SA), "signal_nr" the NR leg of NSA; its band list adds the bandwidth.
type Now = ModemSignal & { bandwidth: number | null; role: string | null }
function nowOf(tech: 'lte' | 'nr'): Now | null {
  const s = m.value
  if (!s?.ok) return null
  let r: ModemSignal | null | undefined = null
  if (tech === 'lte') r = s.signal?.tech === 'LTE' && s.signal.rsrp != null ? s.signal : null
  else r = s.signal?.tech === 'NR' ? s.signal : s.signal_nr?.rsrp != null ? s.signal_nr : null
  if (!r) return null
  const b = s.bands?.find((x) => x.tech === (tech === 'nr' ? 'NR' : 'LTE') && x.band === r!.band && (x.pci == null || x.pci === r!.pci))
  return { ...r, bandwidth: b?.bandwidth ?? null, role: b?.role ?? null }
}

const cards = computed(() =>
  (['lte', 'nr'] as const).map((tech) => {
    const n = nowOf(tech)
    const pre = tech === 'lte' ? 'lte_' : 'nr_'
    let note = ''
    if (!n) {
      if (tech === 'lte' && m.value?.mode === 'nr5g_sa') note = 'Not in use: the modem is on 5G standalone.'
      else if (tech === 'nr') note = m.value?.mode === 'lte' ? 'No 5G cell right now: the modem is on LTE only.' : 'No 5G cell right now.'
      else note = 'No LTE cell right now.'
    }
    const g = {
      rsrp: grade('rsrp', tech, n?.rsrp),
      sinr: grade('sinr', tech, n?.sinr),
      rsrq: grade('rsrq', tech, n?.rsrq),
      rssi: grade('rssi', tech, n?.rssi),
    }
    const stat = (k: SignalMetric, f: (v: number) => string) => {
      const v = sum.value?.[k]
      return v ? `${f(v.avg)} avg · ${f(v.min)} – ${f(v.max)}` : null
    }
    return {
      tech,
      name: tech === 'lte' ? 'LTE' : '5G NR',
      color: tech === 'lte' ? LTE : NR,
      now: n,
      note,
      g,
      overall: n ? worst(g.rsrp, g.sinr) : ('unknown' as Grade),
      cell: n
        ? [
            n.band,
            n.bandwidth ? `${n.bandwidth} MHz` : null,
            n.pci != null ? `PCI ${n.pci}` : null,
            n.arfcn != null ? `${tech === 'nr' ? 'NR-ARFCN' : 'EARFCN'} ${n.arfcn}` : null,
            n.cell_id ? `cell ${n.cell_id}` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : '',
      rsrpStat: stat(`${pre}rsrp` as SignalMetric, dbm),
      sinrStat: stat(`${pre}sinr` as SignalMetric, db),
    }
  }),
)

const modeBar = computed(() => (ser.value ? mergeModes(ser.value, 90) : null))
const MODE_DOT: Record<ModeState, string> = {
  0: 'rgb(var(--v-theme-surface-container-highest))',
  1: 'rgb(var(--v-theme-success))',
  2: 'rgb(var(--v-theme-info))',
  3: 'rgb(var(--v-theme-warning))',
  4: 'rgb(var(--v-theme-error))',
}
const modeShares = computed(() => {
  const s = sum.value?.modes
  if (!s) return []
  return (Object.keys(MODE_OF) as (keyof typeof MODE_OF)[])
    .filter((k) => s[k] > 0)
    .map((k) => ({ name: MODE_NAME[MODE_OF[k]], color: MODE_DOT[MODE_OF[k]], share: s[k] }))
})

// Charts: one radio or both, shaded by the grades of the radio shown (LTE's
// when both are).
const showLte = computed(() => radio.value !== 'nr')
const showNr = computed(() => radio.value !== 'lte')
const one = computed(() => showLte.value !== showNr.value)
const zoneColor = (g: string) =>
  g === 'excellent' ? 'rgb(var(--v-theme-success))' : g === 'good' ? 'rgba(var(--v-theme-success), 0.5)' : g === 'fair' ? 'rgb(var(--v-theme-warning))' : 'rgb(var(--v-theme-error))'

function chart(metric: Metric, nr = true) {
  const s = ser.value!
  const series: ChartSeries[] = []
  const k = (tech: string) => `${tech}_${metric}` as SignalMetric
  if (showLte.value)
    series.push({ label: 'LTE', color: LTE, values: s[k('lte')], band: one.value ? [s[`${k('lte')}_min`], s[`${k('lte')}_max`]] : undefined })
  if (showNr.value && nr)
    series.push({ label: '5G NR', color: NR, values: s[k('nr')], band: one.value ? [s[`${k('nr')}_min`], s[`${k('nr')}_max`]] : undefined })
  const tech = showNr.value && !showLte.value ? 'nr' : 'lte'
  const zones = zonesOf(gradesFor(metric, win(tech))).map((z) => ({ from: z.from, to: z.to, color: zoneColor(z.grade), label: GRADE_NAME[z.grade] }))
  return { series, zones }
}

const base = computed(() => ({ ts: ser.value?.ts ?? [], step: ser.value?.step ?? 60, from: ser.value?.from ?? 0, to: ser.value?.to ?? 1 }))
const CHARTS = [
  { metric: 'rsrp' as Metric, title: 'RSRP', sub: 'strength, dBm', fmt: dbm, yMin: -110, yMax: -80, nr: true },
  { metric: 'sinr' as Metric, title: 'SINR', sub: 'quality, dB', fmt: db, yMin: 0, yMax: 20, nr: true },
  { metric: 'rsrq' as Metric, title: 'RSRQ', sub: 'quality, dB', fmt: db, yMin: -20, yMax: -5, nr: true },
  { metric: 'rssi' as Metric, title: 'RSSI', sub: 'received power, dBm (LTE)', fmt: dbm, yMin: -90, yMax: -50, nr: false },
]
const charts = computed(() => (ser.value ? CHARTS.map((c) => ({ ...c, ...chart(c.metric, c.nr) })) : []))
const axis = (v: number) => String(v)

const KIND: Record<string, string> = {
  mode: 'Network mode',
  lte_band: 'LTE band',
  lte_cell: 'LTE cell (PCI)',
  nr_band: '5G band',
  nr_cell: '5G cell (PCI)',
}
const changeVal = (kind: string, v: string) => (kind === 'mode' ? (MODE_NAME[MODE_OF[v as keyof typeof MODE_OF]] ?? v) : v)

// The carriers now, each reading graded.
const carriers = computed(() =>
  (m.value?.bands ?? []).map((b) => {
    const tech = b.tech === 'NR' ? ('nr' as const) : ('lte' as const)
    return {
      ...b,
      tech,
      cells: [
        { k: 'RSRP', v: b.rsrp, f: dbm, g: grade('rsrp', tech, b.rsrp) },
        { k: 'SINR', v: b.sinr, f: db, g: grade('sinr', tech, b.sinr) },
        { k: 'RSRQ', v: b.rsrq, f: db, g: grade('rsrq', tech, b.rsrq) },
        { k: 'RSSI', v: b.rssi, f: dbm, g: grade('rssi', tech, b.rssi) },
      ],
    }
  }),
)
</script>

<template>
  <div class="hk-mon">
    <v-alert v-if="sig.error.value" type="error" variant="tonal" rounded="xl">
      {{ sig.error.value instanceof Error ? sig.error.value.message : sig.error.value }}
    </v-alert>
    <v-alert v-else-if="st && !st.enabled" type="info" variant="tonal" rounded="xl">
      Signal history is switched off, so nothing is being recorded. The readings below are live from the modem; turn it on in Settings.
    </v-alert>
    <v-alert v-else-if="st && !st.running" type="warning" variant="tonal" rounded="xl">The monitor isn’t running, so nothing is being recorded.</v-alert>
    <v-alert v-else-if="st && !st.clock_ok" type="info" variant="tonal" rounded="xl">Waiting for the router’s clock to be set before recording.</v-alert>
    <v-alert v-if="st?.persist.enabled && st.persist.error" type="warning" variant="tonal" rounded="xl">
      Signal history couldn’t be saved: {{ st.persist.error }}. It’s kept in RAM until the storage is back.
    </v-alert>
    <v-alert v-if="m && !m.ok" type="error" variant="tonal" rounded="xl">{{ m.error || 'The modem didn’t answer.' }}</v-alert>

    <div class="hk-mon-bar">
      <SegmentedButton v-model="range" :options="ranges" label="Period" class="hk-mon-range" />
      <div class="d-flex flex-wrap ga-2" role="group" aria-label="Radios shown">
        <button v-for="r in RADIOS" :key="r.id" type="button" class="hk-filter" :class="{ 'is-on': radio === r.id }" :aria-pressed="radio === r.id" @click="radio = r.id">
          <HkIcon v-if="radio === r.id && !r.color" name="check" :size="16" :stroke="2.6" />
          <span v-if="r.color" class="hk-dot" :style="{ background: r.color }" />{{ r.label }}
        </button>
      </div>
    </div>

    <!-- The readings now, one card per radio -->
    <div class="hk-mon-health">
      <template v-if="m">
        <section v-for="c in cards" :key="c.tech" class="hk-card" :aria-label="`${c.name} signal`" style="gap: 14px">
          <div class="d-flex align-center ga-3">
            <span class="hk-dot hk-dot--lg" :style="{ background: c.color }" />
            <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
              <h2 class="hk-h2">{{ c.name }}<span v-if="c.now?.role" class="hk-label ml-2">{{ c.now.role === 'PCC' ? 'primary' : 'secondary' }}</span></h2>
              <span class="hk-label">{{ c.cell || ' ' }}</span>
            </div>
            <span class="hk-chip" :class="`hk-state--${CHIP[c.overall]}`">{{ c.now ? GRADE_NAME[c.overall] : 'No cell' }}</span>
          </div>
          <span v-if="!c.now" class="text-muted" style="font-size: 14px">{{ c.note }}</span>
          <div v-else class="hk-mon-tiles">
            <div class="hk-tile" :title="GRADE_NAME[c.g.rsrp]">
              <span class="hk-label">RSRP</span>
              <span class="hk-display hk-mon-val" :class="TONE[c.g.rsrp]">{{ c.now.rsrp ?? '—' }}<small> dBm</small></span>
            </div>
            <div class="hk-tile" :title="GRADE_NAME[c.g.sinr]">
              <span class="hk-label">SINR</span>
              <span class="hk-display hk-mon-val" :class="TONE[c.g.sinr]">{{ c.now.sinr ?? '—' }}<small> dB</small></span>
            </div>
            <div class="hk-tile" :title="GRADE_NAME[c.g.rsrq]">
              <span class="hk-label">RSRQ</span>
              <span class="hk-display hk-mon-val" :class="TONE[c.g.rsrq]">{{ c.now.rsrq ?? '—' }}<small> dB</small></span>
            </div>
            <div v-if="c.tech === 'lte'" class="hk-tile" :title="GRADE_NAME[c.g.rssi]">
              <span class="hk-label">RSSI</span>
              <span class="hk-display hk-mon-val" :class="TONE[c.g.rssi]">{{ c.now.rssi ?? '—' }}<small> dBm</small></span>
            </div>
            <div v-else class="hk-tile">
              <span class="hk-label">Bandwidth</span>
              <span class="hk-display hk-mon-val">{{ c.now.bandwidth ?? '—' }}<small> MHz</small></span>
            </div>
          </div>
          <div v-if="c.rsrpStat || c.sinrStat" class="hk-mon-live hk-label">
            <span v-if="c.rsrpStat">RSRP <b>{{ c.rsrpStat }}</b></span>
            <span v-if="c.sinrStat">SINR <b>{{ c.sinrStat }}</b></span>
            <span>{{ rangeLabel }}</span>
          </div>
        </section>
      </template>
      <template v-else>
        <section v-for="i in 2" :key="i" class="hk-card"><v-skeleton-loader type="heading, text@3" bg-color="transparent" /></section>
      </template>
    </div>

    <!-- Network mode over the period, bands, carriers now -->
    <section class="hk-card" aria-label="Network" style="gap: 12px">
      <div class="hk-mon-head">
        <h2 class="hk-h2">Network</h2>
        <span class="hk-label">
          {{ m?.mode_label || '—' }}<template v-if="m?.operator"> · {{ m.operator }}</template
          ><template v-if="(m?.ca?.total ?? 0) > 1"> · {{ m!.ca!.total }} carriers aggregated</template>
        </span>
      </div>
      <ModeBar v-if="modeBar && ser" :bar="modeBar" :from="ser.from" label="Network mode over the period" />
      <v-skeleton-loader v-else type="text" bg-color="transparent" />
      <div class="hk-mon-live hk-label">
        <span v-for="s in modeShares" :key="s.name"><span class="hk-dot" :style="{ background: s.color, display: 'inline-block', marginRight: '6px' }" />{{ s.name }} <b>{{ s.share.toFixed(1) }}%</b></span>
        <span v-if="ser && !modeShares.length">No readings in this period yet</span>
      </div>
      <div class="hk-mon-live hk-label">
        <span>LTE bands <b>{{ bandShares(sum?.bands.lte) }}</b></span>
        <span>5G bands <b>{{ bandShares(sum?.bands.nr) }}</b></span>
      </div>
      <div v-if="carriers.length" class="hk-sig-table">
        <table>
          <thead>
            <tr><th>Carrier</th><th>Band</th><th>Width</th><th>PCI</th><th class="hk-sig-hide">ARFCN</th><th>RSRP</th><th>SINR</th><th>RSRQ</th><th>RSSI</th></tr>
          </thead>
          <tbody>
            <tr v-for="b in carriers" :key="`${b.role}${b.band}${b.pci}`">
              <td><span class="hk-dot" :style="{ background: b.tech === 'nr' ? NR : LTE, display: 'inline-block', marginRight: '6px' }" />{{ b.role || '—' }}</td>
              <td>{{ b.band || '—' }}</td>
              <td>{{ b.bandwidth ? `${b.bandwidth} MHz` : '—' }}</td>
              <td>{{ b.pci ?? '—' }}</td>
              <td class="hk-sig-hide">{{ b.arfcn ?? '—' }}</td>
              <td v-for="x in b.cells" :key="x.k">
                <span v-if="x.v != null" class="hk-mon-val" :class="TONE[x.g]" style="font-size: inherit; font-weight: 600">{{ x.f(x.v) }}</span>
                <template v-else>—</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Charts -->
    <div v-if="ser" class="hk-mon-charts is-two">
      <section v-for="c in charts" :key="c.metric" class="hk-card" :aria-label="c.title" style="gap: 8px">
        <div class="hk-mon-head">
          <h2 class="hk-h2">{{ c.title }} <span class="hk-label">{{ c.sub }}</span></h2>
          <span class="hk-label">{{ one ? 'average, range shaded' : 'average per bucket' }}</span>
        </div>
        <LineChart
          v-bind="base"
          :series="c.series"
          fit
          :y-min="c.yMin"
          :y-max="c.yMax"
          :zones="c.zones"
          :fmt-y="axis"
          :fmt-val="c.fmt"
          :label="`${c.title} chart`"
          :empty="c.series.length ? undefined : 'LTE only has this reading'"
        />
      </section>
    </div>
    <section v-else class="hk-card"><v-skeleton-loader type="image" bg-color="transparent" /></section>

    <!-- Band, cell and mode changes -->
    <section class="hk-card" aria-label="Changes" style="gap: 8px">
      <div class="hk-mon-head">
        <h2 class="hk-h2">Changes</h2>
        <span v-if="changes.length" class="hk-label">{{ changes.length }} in this period</span>
      </div>
      <span class="text-muted" style="font-size: 13px">
        Every move to another band, cell or network mode. Many cell changes while the router stands still mean it sits between two cells: a spot where one is
        clearly stronger, or a cell lock, keeps it on one.
      </span>
      <div v-if="changes.length" class="hk-group">
        <div v-for="c in changes" :key="`${c.ts}${c.kind}`" class="hk-mon-outage">
          <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
            <span style="font-size: 14px">{{ KIND[c.kind] ?? c.kind }}: {{ changeVal(c.kind, c.from) }} → {{ changeVal(c.kind, c.to) }}</span>
            <span class="hk-label">{{ bucketTime(c.ts) }}</span>
          </div>
        </div>
      </div>
      <span v-else class="text-muted" style="font-size: 14px">No band, cell or mode changes in this period.</span>
    </section>

    <!-- What the numbers mean -->
    <section class="hk-card" aria-label="Getting a better signal" style="gap: 8px">
      <h2 class="hk-h2">Getting a better signal</h2>
      <ul class="hk-sig-tips">
        <li><b>RSRP</b> is how strong the cell is: above −90 dBm is good, below −105 dBm is weak.</li>
        <li><b>SINR</b> is how clean it is, and matters most for speed: above 13 dB is good, below 0 dB is poor. A strong but noisy cell is often slower than a weaker, clean one.</li>
        <li><b>RSRQ</b> drops when the cell is busy or interfered with: above −10 dB is excellent.</li>
        <li>
          Moving the router: a window facing the tower and a higher spot help most. Move it in small steps and wait for a few readings (every
          {{ st?.interval ?? 15 }} s here, live readings every 10 s) before judging. Walls, metal and coated glass cost the most.
        </li>
        <li>
          Once you know which band or cell works best,
          <router-link to="/cellular?tab=lock" class="hk-sig-a">band &amp; cell lock</router-link>
          keeps the modem on it. Low bands (LTE B28, n28) reach further; high bands (n78) are faster but need a cleaner line of sight.
        </li>
      </ul>
      <span class="text-muted" style="font-size: 13px">
        Recording: every {{ st?.interval ?? 15 }} s,
        {{ st?.persist.enabled ? `kept on storage for ${st.persist.days} days` : `kept in RAM for ${st?.retain_days ?? 30} days` }}.
        <a :href="luciUrl('admin/monitoring/signal')" class="hk-sig-a">Change in Settings</a>
      </span>
    </section>
  </div>
</template>

<style scoped>
.hk-sig-table {
  overflow-x: auto;
}
.hk-sig-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.hk-sig-table th {
  text-align: left;
  font-weight: 500;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-muted));
  padding: 6px 10px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  white-space: nowrap;
}
.hk-sig-table td {
  padding: 8px 10px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  white-space: nowrap;
}
.hk-sig-table tr:last-child td {
  border-bottom: 0;
}
.hk-sig-a {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
  text-decoration: none;
}
.hk-sig-a:hover {
  text-decoration: underline;
}
.hk-sig-tips {
  margin: 0 0 0 20px;
  font-size: 14px;
  line-height: 1.6;
}
.hk-mon-val small {
  font-size: 13px;
  font-weight: 400;
  color: rgb(var(--v-theme-on-surface-muted));
}
@media (max-width: 599.98px) {
  .hk-sig-hide {
    display: none;
  }
}
</style>
