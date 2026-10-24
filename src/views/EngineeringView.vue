<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import M3Switch from '@/components/m3/M3Switch.vue'
import SegmentedButton from '@/components/m3/SegmentedButton.vue'
import LineChart, { type ChartSeries } from '@/components/monitor/LineChart.vue'
import * as modem from '@/api/modem'
import type { EngCol, EngPaths, EngSession } from '@/api/modem'
import { useNotify } from '@/composables/notify'
import { bandDescription, gnbId } from '@/utils/cellular'
import { delta, emptyHistory, figures, gapped, mergeHistory, nextMark, signed, spread, toCsv, type EngHistory } from '@/utils/eng'
import { GRADE_NAME, gradeOf, gradesFor, zonesOf, type Grade, type Metric } from '@/utils/signal'

// Engineering mode: the modem read every 1-5 s while a person moves and turns
// the router, with every reading figure an aiming session needs - per receive
// path, per carrier, the neighbours - and graphs of the last minutes. The
// router runs one reading loop for it (aw1000-modem-eng) and pauses its other
// timed modem reads meanwhile; this page starts and stops that loop, and it
// ends by itself a minute after nobody reads it.
const notify = useNotify()

const sess = ref<EngSession | null>(null)
const hist = ref<EngHistory>(emptyHistory())
const error = ref('')
const ended = ref('')
const toggling = ref(false)
const interval = ref('2')
const windowMin = ref('5')
let timer: ReturnType<typeof setTimeout> | undefined
let alive = true
// just switched on: poll every second until the router says it is live
let starting = 0

const active = computed(() => !!sess.value?.active)
const data = computed(() => sess.value?.data ?? null)
const eng = computed(() => data.value?.eng ?? null)
const st = computed(() => data.value?.status ?? null)
const nowTs = computed(() => data.value?.ts ?? Math.floor(Date.now() / 1000))

// ------------------------------------------------------------------ polling --

async function tick(): Promise<void> {
  try {
    const s = await modem.engRead()
    const wasActive = active.value
    sess.value = s
    if (s.interval && s.active) interval.value = String(s.interval)
    if (wasActive && !s.active) ended.value = 'Engineering mode ended on the router (stopped elsewhere, a cell scan, or nobody reading for a minute).'
    if (s.active) {
      const last = hist.value.ts[hist.value.ts.length - 1] ?? 0
      const add = await modem.engSeries(last)
      hist.value = mergeHistory(hist.value, add, Math.floor(Date.now() / 1000) - (s.ring_minutes || 30) * 60)
    } else clearView()
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
  schedule()
}

// Every interval while live; slower in a hidden tab (enough to keep the
// session alive, the history catches up on return), and every 10 s while off
// so a session started from LuCI shows up here.
function schedule(): void {
  clearTimeout(timer)
  if (!alive) return
  if (active.value) starting = 0
  const ms = starting > 0 ? (starting--, 1000) : active.value ? (document.hidden ? 20000 : Number(interval.value) * 1000) : 10000
  timer = setTimeout(tick, ms)
}

function onVisible(): void {
  if (!document.hidden) tick()
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisible)
  tick()
})
onBeforeUnmount(() => {
  alive = false
  clearTimeout(timer)
  document.removeEventListener('visibilitychange', onVisible)
})
// Leaving the page ends the session, so the router's other modem reads resume
// at once rather than a minute later.
onBeforeRouteLeave(() => {
  if (active.value) modem.engStop().catch(() => undefined)
})

// Off means nothing shown: the router deletes the session's readings when it
// ends, and the page lets go of its copy too.
function clearView(): void {
  hist.value = emptyHistory()
  pinned.value = null
}

async function setActive(on: boolean): Promise<void> {
  toggling.value = true
  ended.value = ''
  try {
    const r = on ? await modem.engStart(Number(interval.value)) : await modem.engStop()
    if (!r.ok) notify.show(r.error ?? 'The router refused', 6000)
    else {
      sess.value = { ...r, data: on ? (sess.value?.data ?? null) : null }
      if (on) starting = 6
      else clearView()
    }
  } catch (e) {
    notify.show(e instanceof Error ? e.message : String(e), 6000)
  } finally {
    toggling.value = false
  }
  tick()
}

watch(interval, (v, old) => {
  if (active.value && v !== old && String(sess.value?.interval) !== v) modem.engStart(Number(v)).then(() => tick()).catch(() => undefined)
})

const stateLine = computed(() => {
  const s = sess.value
  if (!s) return 'Reading the router…'
  if (!s.active) return 'Off'
  if (s.paused_for === 'write') return 'Paused a moment: a change you made is being applied'
  if (s.paused_for === 'scan') return 'Paused: a cell scan has the modem'
  if (s.paused_for === 'busy') return 'Waiting for the modem…'
  if (s.paused_for === 'noport') return 'The modem isn’t answering'
  return `Live · every ${s.interval} s${s.last_ms != null ? ` · read in ${s.last_ms} ms` : ''}`
})
const nowSecs = () => Math.floor(Date.now() / 1000)

// ------------------------------------------------------------ live readings --

type Rat = 'lte' | 'nr'
const RAT_COLOR: Record<Rat, string> = { lte: 'rgb(var(--v-theme-primary))', nr: 'rgb(var(--v-theme-tertiary))' }
const grade = (m: Metric, v: number | null | undefined): Grade => gradeOf(gradesFor(m), v)

interface Ref {
  t: number
  v: Partial<Record<`${Rat}_${Metric}`, number | null>>
}
const pinned = ref<Ref | null>(null)

const radios = computed(() => {
  const e = eng.value
  if (!e) return []
  const out: { rat: Rat; title: string; sub: string; cur: Record<Metric, number | null> }[] = []
  if (e.lte)
    out.push({
      rat: 'lte',
      title: e.nr?.kind === 'nsa' ? 'LTE anchor' : 'LTE',
      sub: [e.lte.band != null ? `B${e.lte.band}` : null, e.lte.pci != null ? `PCI ${e.lte.pci}` : null].filter(Boolean).join(' · '),
      cur: { rsrp: e.lte.rsrp, rsrq: e.lte.rsrq, sinr: e.lte.sinr, rssi: e.lte.rssi },
    })
  if (e.nr)
    out.push({
      rat: 'nr',
      title: e.nr.kind === 'sa' ? '5G NR (SA)' : '5G NR (NSA)',
      sub: [e.nr.band != null ? `n${e.nr.band}` : null, e.nr.pci != null ? `PCI ${e.nr.pci}` : null].filter(Boolean).join(' · '),
      cur: { rsrp: e.nr.rsrp, rsrq: e.nr.rsrq, sinr: e.nr.sinr, rssi: null },
    })
  return out
})

const METRICS: { m: Metric; label: string; unit: string }[] = [
  { m: 'rsrp', label: 'RSRP', unit: 'dBm' },
  { m: 'sinr', label: 'SINR', unit: 'dB' },
  { m: 'rsrq', label: 'RSRQ', unit: 'dB' },
  { m: 'rssi', label: 'RSSI', unit: 'dBm' },
]
function figs(rat: Rat, m: Metric) {
  return figures(hist.value.ts, hist.value.cols[`${rat}_${m}` as EngCol] ?? [], nowTs.value)
}

function pin(): void {
  const v: Ref['v'] = {}
  for (const r of radios.value) for (const { m } of METRICS) v[`${r.rat}_${m}`] = figs(r.rat, m).avg ?? r.cur[m]
  pinned.value = { t: nowTs.value, v }
  notify.show('Reference pinned: the tiles now show the change from here', 4000)
}

async function mark(): Promise<void> {
  try {
    const label = nextMark(hist.value.marks)
    await modem.engMark(label)
    hist.value = { ...hist.value, marks: [...hist.value.marks, { t: nowSecs(), label }] }
    notify.show(`Marked ${label} on the graphs`, 3000)
  } catch (e) {
    notify.show(e instanceof Error ? e.message : String(e), 6000)
  }
}

function exportCsv(): void {
  const blob = new Blob([toCsv(hist.value)], { type: 'text/csv' })
  const a = document.createElement('a')
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  a.href = URL.createObjectURL(blob)
  a.download = `engineering-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ------------------------------------------------------------------ antennas --

const RX_SCALE: [number, number] = [-125, -65]
const pct = (v: number | null | undefined) => (v == null ? 0 : Math.max(2, Math.min(100, ((v - RX_SCALE[0]) / (RX_SCALE[1] - RX_SCALE[0])) * 100)))
const antennas = computed(() => {
  const a = eng.value?.antennas
  if (!a) return []
  return (['nr', 'lte'] as Rat[])
    .filter((r) => a[r])
    .map((r) => {
      const p = a[r] as EngPaths
      const rows = [0, 1, 2, 3]
        .map((i) => ({ i, rsrp: p.rsrp?.[i] ?? null, rsrq: p.rsrq?.[i] ?? null, sinr: p.sinr?.[i] ?? null }))
        .filter((x) => x.rsrp != null || x.sinr != null)
      const sp = spread(p.rsrp)
      let hint = ''
      if (sp.spread != null && sp.spread >= 6) hint = `RX${sp.weakest} hears the cell ${sp.spread} dB weaker than RX${sp.strongest}: try turning the router so that side faces the cell.`
      else if (sp.spread != null) hint = `Paths within ${sp.spread} dB of each other: the router faces the cell evenly.`
      return { rat: r, title: r === 'nr' ? '5G NR' : 'LTE', rows, hint }
    })
})

// -------------------------------------------------------------------- graphs --

const WINDOWS = [
  { value: '2', label: '2 min' },
  { value: '5', label: '5 min' },
  { value: '10', label: '10 min' },
  { value: '30', label: '30 min' },
]
const view = computed(() => {
  const to = Math.max(nowTs.value, hist.value.ts[hist.value.ts.length - 1] ?? 0)
  const from = to - Number(windowMin.value) * 60
  const i0 = hist.value.ts.findIndex((t) => t >= from)
  const h: EngHistory =
    i0 <= 0
      ? hist.value
      : {
          ts: hist.value.ts.slice(i0),
          mode: hist.value.mode.slice(i0),
          cols: Object.fromEntries(Object.entries(hist.value.cols).map(([k, v]) => [k, v.slice(i0)])) as EngHistory['cols'],
          marks: hist.value.marks,
        }
  return { from, to, h }
})
const zoneColor = (g: string) =>
  g === 'excellent' ? 'rgb(var(--v-theme-success))' : g === 'good' ? 'rgba(var(--v-theme-success), 0.5)' : g === 'fair' ? 'rgb(var(--v-theme-warning))' : 'rgb(var(--v-theme-error))'
const RX_COLORS = ['rgb(var(--v-theme-primary))', 'rgb(var(--v-theme-tertiary))', 'rgb(var(--v-theme-info))', 'rgb(var(--v-theme-success))']

function chart(title: string, sub: string, keys: { k: EngCol; label: string; color: string; dash?: boolean }[], metric: Metric | null, yMin: number, yMax: number) {
  const step = Number(sess.value?.interval ?? interval.value)
  const g = gapped(view.value.h, keys.map((x) => x.k), Math.max(step * 3, 8))
  const series: ChartSeries[] = keys.map((x, j) => ({ label: x.label, color: x.color, dash: x.dash, values: g.values[j]! })).filter((s) => s.values.some((v) => v != null))
  const zones = metric ? zonesOf(gradesFor(metric)).map((z) => ({ from: z.from, to: z.to, color: zoneColor(z.grade), label: GRADE_NAME[z.grade] })) : []
  return { title, sub, ts: g.ts, series, zones, yMin, yMax }
}
const charts = computed(() =>
  [
    chart('RSRP', 'signal strength, dBm', [{ k: 'lte_rsrp', label: 'LTE', color: RAT_COLOR.lte }, { k: 'nr_rsrp', label: '5G NR', color: RAT_COLOR.nr }], 'rsrp', -110, -80),
    chart('SINR', 'signal quality, dB', [{ k: 'lte_sinr', label: 'LTE', color: RAT_COLOR.lte }, { k: 'nr_sinr', label: '5G NR', color: RAT_COLOR.nr }], 'sinr', 0, 20),
    chart('RSRQ', 'signal quality, dB', [{ k: 'lte_rsrq', label: 'LTE', color: RAT_COLOR.lte }, { k: 'nr_rsrq', label: '5G NR', color: RAT_COLOR.nr }], 'rsrq', -20, -5),
    chart('5G antennas', 'RSRP per receive path, dBm', [0, 1, 2, 3].map((i) => ({ k: `nr_a${i}` as EngCol, label: `RX${i}`, color: RX_COLORS[i]! })), null, -110, -80),
    chart('LTE antennas', 'RSRP per receive path, dBm', [0, 1, 2, 3].map((i) => ({ k: `lte_a${i}` as EngCol, label: `RX${i}`, color: RX_COLORS[i]! })), null, -110, -80),
  ].filter((c) => c.series.length),
)
const axis = (v: number) => String(v)
const fmtDb = (v: number) => `${v} dB`
const fmtDbm = (v: number) => `${v} dBm`

// --------------------------------------------------------- cells and carriers --

const STATE: Record<string, string> = { CONNECT: 'Connected (data flowing)', NOCONN: 'Idle (registered, no data right now)', SEARCH: 'Searching', LIMSRV: 'Limited service' }
const lteCell = (hex: string | null | undefined) => {
  if (!hex || !/^[0-9a-f]+$/i.test(hex)) return null
  const eci = parseInt(hex, 16)
  return { enb: Math.floor(eci / 256), sector: eci % 256 }
}
const tacText = (hex: string | null | undefined) => (hex && /^[0-9a-f]+$/i.test(hex) ? `${hex} (${parseInt(hex, 16)})` : (hex ?? '—'))
const v = (x: number | string | null | undefined, unit = '') => (x == null || x === '' ? '—' : `${x}${unit}`)

const lteFacts = computed(() => {
  const l = eng.value?.lte
  if (!l) return []
  const c = lteCell(l.cell_id)
  return [
    ['Band', `B${l.band ?? '?'} ${l.duplex ? `(${l.duplex})` : ''}`],
    ['EARFCN', v(l.earfcn)],
    ['PCI', v(l.pci)],
    ['Cell ID', l.cell_id ? `${l.cell_id}${c ? ` · eNB ${c.enb}, sector ${c.sector}` : ''}` : '—'],
    ['TAC', tacText(l.tac)],
    ['Network', l.mcc && l.mnc ? `${l.mcc}-${l.mnc}${st.value?.operator ? ` · ${st.value.operator}` : ''}` : '—'],
    ['Bandwidth', l.dl_bw != null ? `${l.dl_bw} MHz down · ${l.ul_bw ?? '?'} MHz up` : '—'],
    ['CQI', v(l.cqi)],
    ['TX power', v(l.tx_power, ' dBm')],
    ['srxlev', v(l.srxlev)],
    ['SINR (QENG)', l.sinr_qeng != null ? `${l.sinr_qeng} (the modem’s own scale)` : '—'],
  ] as [string, string][]
})
const nrBand = computed(() => st.value?.bands?.find((b) => b.tech === 'NR' && (eng.value?.nr?.pci == null || b.pci === eng.value.nr.pci)) ?? null)
const nrFacts = computed(() => {
  const n = eng.value?.nr
  if (!n) return []
  const g = n.cell_id ? gnbId(n.cell_id, st.value?.gnb_id_bits ?? 24) : null
  const rows: [string, string][] = [
    ['Band', n.band != null ? bandDescription(`n${n.band}`) + (n.duplex ? ` · ${n.duplex}` : '') : '—'],
    ['ARFCN', v(n.arfcn)],
    ['PCI', v(n.pci)],
    ['Bandwidth', v(nrBand.value?.bandwidth, ' MHz')],
    ['Subcarrier spacing', n.scs_raw != null ? `${15 * 2 ** n.scs_raw} kHz` : '—'],
  ]
  if (n.kind === 'sa') rows.push(['Cell ID', n.cell_id ? `${n.cell_id}${g != null ? ` · gNB ${g}` : ''}` : '—'], ['TAC', tacText(n.tac)], ['srxlev', v(n.srxlev)])
  else rows.push(['Cell ID', 'Not reported in NSA'])
  return rows
})

const carriers = computed(() => st.value?.bands ?? [])
const totalBw = computed(() => carriers.value.reduce((a, b) => a + (b.bandwidth ?? 0), 0))
const neighbours = computed(() =>
  [...(eng.value?.neighbours ?? [])]
    .map((n) => ({ ...n, serving: n.tech === 'LTE' && n.pci === eng.value?.lte?.pci && n.arfcn === eng.value?.lte?.earfcn }))
    .sort((a, b) => (b.rsrp ?? -999) - (a.rsrp ?? -999)),
)
const g = (m: Metric, x: number | null | undefined) => `g-${grade(m, x)}`
</script>

<template>
  <PageHeader :overline="st?.mode_label ? `${st.mode_label}${st.operator ? ` · ${st.operator}` : ''}` : 'Cellular'" title="Engineering mode" />

  <!-- Control -->
  <section class="hk-card" aria-label="Engineering mode" style="gap: 14px">
    <div class="d-flex align-center ga-3 flex-wrap">
      <span class="hk-eng__icon" :class="{ on: active }"><HkIcon name="antenna" /></span>
      <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
        <span class="hk-h2" style="font-size: 18px">Live radio readings</span>
        <span class="hk-label" role="status">{{ stateLine }}</span>
      </div>
      <M3Switch :model-value="active" label="Engineering mode" :busy="toggling" @update:model-value="setActive" />
    </div>
    <v-alert type="info" variant="tonal" density="compact" rounded="lg" class="hk-eng__note">
      While engineering mode is on, the router’s other modem checks pause and show their last reading: the signal history, SMS forwarding and
      the diagnostics on other pages. Changes you make (band locks, SMS, the AT console) still go through. It switches itself off when you leave
      this page.
    </v-alert>
    <div class="d-flex flex-wrap align-center ga-3">
      <div class="d-flex flex-column ga-1">
        <span class="hk-label">Read every</span>
        <SegmentedButton
          v-model="interval"
          label="Read every"
          :options="[
            { value: '1', label: '1 s' },
            { value: '2', label: '2 s' },
            { value: '3', label: '3 s' },
            { value: '5', label: '5 s' },
          ]"
        />
      </div>
      <div class="d-flex flex-column ga-1">
        <span class="hk-label">Graphs show</span>
        <SegmentedButton v-model="windowMin" label="Graphs show" :options="WINDOWS" />
      </div>
      <v-spacer />
      <div class="d-flex flex-wrap ga-2">
        <v-btn variant="tonal" height="40" :disabled="!active" @click="pin"><HkIcon name="check" :size="16" class="mr-1" />Pin reference</v-btn>
        <v-btn variant="tonal" height="40" :disabled="!active" @click="mark">Mark position</v-btn>
        <v-btn variant="text" height="40" :disabled="!hist.ts.length" @click="exportCsv">Export CSV</v-btn>
      </div>
    </div>
    <v-alert v-if="ended" type="warning" variant="tonal" density="compact" rounded="lg">{{ ended }}</v-alert>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" rounded="lg">{{ error }}</v-alert>
  </section>

  <template v-if="data">
    <!-- Live tiles -->
    <div class="hk-eng__radios">
      <section v-for="r in radios" :key="r.rat" class="hk-card" :aria-label="r.title" style="gap: 12px">
        <div class="d-flex align-center ga-2">
          <span class="hk-dot" :style="{ background: RAT_COLOR[r.rat] }" />
          <h2 class="hk-h2 flex-grow-1" style="font-size: 18px">{{ r.title }}</h2>
          <span class="hk-label">{{ r.sub }}</span>
        </div>
        <div class="hk-eng__tiles">
          <div v-for="mt in METRICS.filter((x) => x.m !== 'rssi' || r.rat === 'lte')" :key="mt.m" class="hk-eng__tile" :class="g(mt.m, r.cur[mt.m])">
            <span class="hk-label">{{ mt.label }}</span>
            <span class="hk-eng__val"><b>{{ r.cur[mt.m] ?? '—' }}</b> <small>{{ mt.unit }}</small></span>
            <span class="hk-eng__fig">10 s avg {{ figs(r.rat, mt.m).avg ?? '—' }} · best {{ figs(r.rat, mt.m).best ?? '—' }}</span>
            <span v-if="pinned" class="hk-eng__delta" :class="{ up: (delta(figs(r.rat, mt.m).avg ?? r.cur[mt.m], pinned.v[`${r.rat}_${mt.m}`]) ?? 0) > 0, down: (delta(figs(r.rat, mt.m).avg ?? r.cur[mt.m], pinned.v[`${r.rat}_${mt.m}`]) ?? 0) < 0 }">
              {{ signed(delta(figs(r.rat, mt.m).avg ?? r.cur[mt.m], pinned.v[`${r.rat}_${mt.m}`])) }} vs reference
            </span>
          </div>
        </div>
      </section>
      <p v-if="!radios.length" class="hk-label">No serving cell in the last reading.</p>
    </div>

    <!-- Antennas -->
    <section v-if="antennas.length" class="hk-card" aria-label="Receive paths" style="gap: 12px">
      <div class="d-flex flex-column">
        <h2 class="hk-h2" style="font-size: 18px">Receive paths</h2>
        <span class="hk-label">Each antenna’s view of the cell. Turn the router slowly and watch the weakest path.</span>
      </div>
      <div class="hk-eng__ant">
        <div v-for="a in antennas" :key="a.rat" class="d-flex flex-column ga-2">
          <span style="font-weight: 600; font-size: 14px">{{ a.title }}</span>
          <div v-for="row in a.rows" :key="row.i" class="hk-eng__rx">
            <span class="hk-eng__rxname">RX{{ row.i }}</span>
            <div class="hk-eng__bar" :aria-label="`RX${row.i} RSRP ${row.rsrp ?? 'none'} dBm`">
              <span :class="g('rsrp', row.rsrp)" :style="{ width: `${pct(row.rsrp)}%` }" />
            </div>
            <span class="hk-eng__rxval">{{ row.rsrp ?? '—' }} dBm</span>
            <span class="hk-eng__rxval" :class="g('sinr', row.sinr)">{{ row.sinr ?? '—' }} dB</span>
          </div>
          <span class="hk-label">{{ a.hint }}</span>
        </div>
      </div>
    </section>

    <!-- Graphs -->
    <div class="hk-eng__charts">
      <section v-for="c in charts" :key="c.title" class="hk-card" :aria-label="c.title" style="gap: 6px">
        <div class="d-flex align-baseline ga-2">
          <h2 class="hk-h2" style="font-size: 16px">{{ c.title }}</h2>
          <span class="hk-label">{{ c.sub }}</span>
        </div>
        <LineChart
          :ts="c.ts"
          :step="1"
          :from="view.from"
          :to="view.to"
          :series="c.series"
          :zones="c.zones"
          :marks="hist.marks"
          fit
          :y-min="c.yMin"
          :y-max="c.yMax"
          :height="170"
          :fmt-y="axis"
          :fmt-val="c.title === 'RSRP' || c.title.includes('antennas') ? fmtDbm : fmtDb"
          :label="`${c.title} over the last ${windowMin} minutes`"
          empty="No readings in this window yet"
        />
      </section>
    </div>

    <!-- Serving cells -->
    <div class="hk-eng__cells">
      <section v-if="lteFacts.length" class="hk-card" aria-label="LTE serving cell" style="gap: 8px">
        <h2 class="hk-h2" style="font-size: 16px">LTE serving cell</h2>
        <span class="hk-label">{{ STATE[eng?.state ?? ''] ?? eng?.state ?? '' }}</span>
        <dl class="hk-eng__kv">
          <div v-for="[k, val] in lteFacts" :key="k"><dt>{{ k }}</dt><dd>{{ val }}</dd></div>
        </dl>
      </section>
      <section v-if="nrFacts.length" class="hk-card" aria-label="5G serving cell" style="gap: 8px">
        <h2 class="hk-h2" style="font-size: 16px">5G NR serving cell</h2>
        <span class="hk-label">{{ eng?.nr?.kind === 'sa' ? 'Standalone' : 'Non-standalone: data rides on the LTE anchor’s control' }}</span>
        <dl class="hk-eng__kv">
          <div v-for="[k, val] in nrFacts" :key="k"><dt>{{ k }}</dt><dd>{{ val }}</dd></div>
        </dl>
      </section>
    </div>

    <!-- Carriers -->
    <section class="hk-card" aria-label="Carrier aggregation" style="gap: 8px">
      <div class="d-flex align-baseline ga-2 flex-wrap">
        <h2 class="hk-h2" style="font-size: 16px">Carrier aggregation</h2>
        <span class="hk-label">{{ carriers.length }} carrier{{ carriers.length === 1 ? '' : 's' }} · {{ totalBw }} MHz combined</span>
      </div>
      <div class="hk-eng__scroll">
        <table class="hk-eng__table">
          <thead>
            <tr><th>Role</th><th>Band</th><th>Width</th><th>ARFCN</th><th>PCI</th><th>RSRP</th><th>RSRQ</th><th>SINR</th><th>RSSI</th></tr>
          </thead>
          <tbody>
            <tr v-for="(b, i) in carriers" :key="i">
              <td>{{ b.role }}</td>
              <td><b>{{ b.band }}</b></td>
              <td>{{ v(b.bandwidth, ' MHz') }}</td>
              <td>{{ v(b.arfcn) }}</td>
              <td>{{ v(b.pci) }}</td>
              <td :class="g('rsrp', b.rsrp)">{{ v(b.rsrp) }}</td>
              <td :class="g('rsrq', b.rsrq)">{{ v(b.rsrq) }}</td>
              <td :class="g('sinr', b.sinr)">{{ v(b.sinr) }}</td>
              <td :class="g('rssi', b.rssi)">{{ v(b.rssi) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Neighbours -->
    <section class="hk-card" aria-label="Neighbour cells" style="gap: 8px">
      <div class="d-flex align-baseline ga-2 flex-wrap">
        <h2 class="hk-h2" style="font-size: 16px">Neighbour cells</h2>
        <span class="hk-label">{{ neighbours.length ? 'Cells the modem hears besides the one it uses, strongest first' : 'None reported (5G standalone reports none)' }}</span>
      </div>
      <div v-if="neighbours.length" class="hk-eng__scroll">
        <table class="hk-eng__table">
          <thead>
            <tr><th>Tech</th><th>Kind</th><th>ARFCN</th><th>PCI</th><th>RSRP</th><th>RSRQ</th><th>RSSI</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="(n, i) in neighbours" :key="i" :class="{ serving: n.serving }">
              <td>{{ n.tech }}</td>
              <td>{{ n.kind === 'intra' ? 'Same channel' : n.kind === 'inter' ? 'Other channel' : '—' }}</td>
              <td>{{ v(n.arfcn) }}</td>
              <td>{{ v(n.pci) }}</td>
              <td :class="g('rsrp', n.rsrp)">{{ v(n.rsrp) }}</td>
              <td :class="g('rsrq', n.rsrq)">{{ v(n.rsrq) }}</td>
              <td :class="g('rssi', n.rssi)">{{ v(n.rssi) }}</td>
              <td><span v-if="n.serving" class="hk-chip hk-chip--tonal">Serving</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
  <section v-else-if="sess && !active" class="hk-card hk-eng__empty">
    <HkIcon name="antenna" :size="36" />
    <span class="hk-h2" style="font-size: 20px">Switch engineering mode on to start reading</span>
    <span class="hk-label">Put the router where you want to test, switch on, then move or turn it slowly and watch the readings and graphs.</span>
  </section>
</template>

<style scoped>
.hk-eng__icon {
  width: 44px;
  height: 44px;
  border-radius: 22px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: rgb(var(--v-theme-surface-container-highest));
  color: rgb(var(--v-theme-on-surface-muted));
}
.hk-eng__icon.on {
  background: rgb(var(--v-theme-primary-container));
  color: rgb(var(--v-theme-on-primary-container));
}
.hk-eng__note {
  font-size: 13px;
}
.hk-eng__radios,
.hk-eng__cells {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}
.hk-eng__charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 16px;
}
@media (max-width: 600px) {
  .hk-eng__radios,
  .hk-eng__cells,
  .hk-eng__charts {
    grid-template-columns: minmax(0, 1fr);
  }
}
.hk-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.hk-eng__tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px;
}
.hk-eng__tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface-container-lowest));
  border-left: 4px solid rgb(var(--v-theme-outline-variant));
}
.hk-eng__tile.g-excellent,
.hk-eng__tile.g-good {
  border-left-color: rgb(var(--v-theme-success));
}
.hk-eng__tile.g-fair {
  border-left-color: rgb(var(--v-theme-warning));
}
.hk-eng__tile.g-poor {
  border-left-color: rgb(var(--v-theme-error));
}
.hk-eng__val b {
  font-size: 26px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.hk-eng__val small {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-muted));
}
.hk-eng__fig,
.hk-eng__delta {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-muted));
}
.hk-eng__delta.up {
  color: rgb(var(--v-theme-success));
  font-weight: 600;
}
.hk-eng__delta.down {
  color: rgb(var(--v-theme-error));
  font-weight: 600;
}
.hk-eng__ant {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
}
.hk-eng__rx {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 72px 52px;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.hk-eng__rxname {
  font-weight: 600;
}
.hk-eng__rxval {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.hk-eng__bar {
  height: 10px;
  border-radius: 5px;
  background: rgb(var(--v-theme-surface-container-highest));
  overflow: hidden;
}
.hk-eng__bar span {
  display: block;
  height: 100%;
  border-radius: 5px;
  background: rgb(var(--v-theme-outline));
  transition: width 0.4s ease;
}
.hk-eng__bar span.g-excellent,
.hk-eng__bar span.g-good {
  background: rgb(var(--v-theme-success));
}
.hk-eng__bar span.g-fair {
  background: rgb(var(--v-theme-warning));
}
.hk-eng__bar span.g-poor {
  background: rgb(var(--v-theme-error));
}
td.g-excellent,
td.g-good,
.hk-eng__rxval.g-excellent,
.hk-eng__rxval.g-good {
  color: rgb(var(--v-theme-success));
}
td.g-fair,
.hk-eng__rxval.g-fair {
  color: rgb(var(--v-theme-warning));
}
td.g-poor,
.hk-eng__rxval.g-poor {
  color: rgb(var(--v-theme-error));
}
.hk-eng__kv {
  margin: 0;
  display: flex;
  flex-direction: column;
  font-size: 14px;
}
.hk-eng__kv > div {
  display: flex;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}
.hk-eng__kv > div:last-child {
  border-bottom: 0;
}
.hk-eng__kv dt {
  flex: 0 0 140px;
  color: rgb(var(--v-theme-on-surface-muted));
}
.hk-eng__kv dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.hk-eng__scroll {
  overflow-x: auto;
}
.hk-eng__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.hk-eng__table th {
  text-align: left;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface-muted));
  padding: 6px 8px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  white-space: nowrap;
}
.hk-eng__table td {
  padding: 6px 8px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  white-space: nowrap;
}
.hk-eng__table tr.serving td {
  background: rgb(var(--v-theme-secondary-container), 0.35);
}
.hk-eng__empty {
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: 40px 24px;
}
</style>
