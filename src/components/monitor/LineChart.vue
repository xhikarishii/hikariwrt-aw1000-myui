<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { bucketTime, maxOf, niceTicks, runs, timeTicks } from '@/utils/series'

// Time-series line chart in SVG: lines, filled areas and a min–max band,
// with a crosshair and a tooltip on hover (or touch). Drawn at the box's
// pixel width (ResizeObserver) rather than scaled, so text and strokes stay
// the same size on a phone. A null in the data is a gap in the line.

export interface ChartSeries {
  label: string
  /** Any CSS colour, e.g. rgb(var(--v-theme-primary)). */
  color: string
  values: (number | null)[]
  area?: boolean
  dash?: boolean
  band?: [(number | null)[], (number | null)[]]
}

/** A band of y shaded behind the lines (null = open-ended), e.g. a quality grade. */
export interface ChartZone {
  from: number | null
  to: number | null
  color: string
  label?: string
}

const props = withDefaults(
  defineProps<{
    ts: number[]
    step: number
    from: number
    to: number
    series: ChartSeries[]
    height?: number
    /** At least this much on the y axis. */
    yMax?: number
    /** Fit the y axis to the data at both ends (readings below zero, like
     *  dBm) instead of starting at 0; yMin / yMax then only widen it, and are
     *  the range shown with no data. */
    fit?: boolean
    yMin?: number
    zones?: ChartZone[]
    fmtY?: (v: number) => string
    fmtVal?: (v: number) => string
    label: string
    empty?: string
  }>(),
  { height: 180, yMax: undefined, yMin: undefined, zones: () => [], fmtY: (v: number) => String(v), fmtVal: undefined, empty: 'No data for this period yet' },
)

const box = ref<HTMLElement | null>(null)
const width = ref(600)
const hover = ref<number | null>(null)
let ro: ResizeObserver | undefined

onMounted(() => {
  if (!box.value) return
  width.value = box.value.clientWidth || 600
  ro = new ResizeObserver((e) => {
    const w = Math.floor(e[0].contentRect.width)
    if (w > 0) width.value = w
  })
  ro.observe(box.value)
})
onBeforeUnmount(() => ro?.disconnect())

const PAD = { l: 46, r: 10, t: 8, b: 22 }
const innerW = computed(() => Math.max(width.value - PAD.l - PAD.r, 10))
const innerH = computed(() => props.height - PAD.t - PAD.b)
const any = computed(() => props.series.some((s) => s.values.some((v) => v != null)))
const yt = computed(() => {
  const count = props.height < 150 ? 3 : 4
  if (!props.fit) return niceTicks(0, Math.max(props.yMax ?? 0, maxOf(...props.series.flatMap((s) => [s.values, s.band?.[1]]))), count)
  let lo = Infinity
  let hi = -Infinity
  for (const s of props.series)
    for (const a of [s.values, s.band?.[0], s.band?.[1]])
      for (const v of a ?? [])
        if (v != null) {
          lo = Math.min(lo, v)
          hi = Math.max(hi, v)
        }
  if (props.yMin != null) lo = Math.min(lo, props.yMin)
  if (props.yMax != null) hi = Math.max(hi, props.yMax)
  if (!Number.isFinite(lo)) lo = 0
  if (!Number.isFinite(hi)) hi = lo + 1
  return niceTicks(lo, hi, count)
})
// zones clipped to the axis
const zoneRects = computed(() =>
  props.zones
    .map((z) => {
      const a = Math.max(z.from ?? yt.value.min, yt.value.min)
      const b = Math.min(z.to ?? yt.value.max, yt.value.max)
      return b > a ? { y: y(b), h: y(a) - y(b), color: z.color, label: z.label } : null
    })
    .filter((z) => z != null),
)
const half = computed(() => props.step / 2)
const x = (t: number) => PAD.l + ((t + half.value - props.from) / (props.to - props.from || 1)) * innerW.value
const y = (v: number) => PAD.t + innerH.value - ((v - yt.value.min) / (yt.value.max - yt.value.min || 1)) * innerH.value
const val = (v: number) => (props.fmtVal ?? props.fmtY)(v)

const xTicks = computed(() =>
  timeTicks(props.from, props.to, Math.max(2, Math.floor(innerW.value / 90)))
    .map((t) => ({ ...t, x: PAD.l + ((t.t - props.from) / (props.to - props.from || 1)) * innerW.value }))
    .filter((t) => t.x >= PAD.l + 12 && t.x <= width.value - PAD.r - 12),
)

const pt = (i: number, v: number) => `${x(props.ts[i]).toFixed(1)},${y(v).toFixed(1)}`

const paths = computed(() => {
  const base = y(Math.max(yt.value.min, 0)).toFixed(1)
  return props.series.map((s) => {
    const bands = s.band
      ? runs(s.band[1]).map((r) => {
          const up = r.map((i) => pt(i, s.band![1][i]!))
          const dn = [...r].reverse().map((i) => pt(i, s.band![0][i] ?? s.band![1][i]!))
          return `M${[...up, ...dn].join('L')}Z`
        })
      : []
    const lines: string[] = []
    const areas: string[] = []
    const dots: { cx: number; cy: number }[] = []
    for (const r of runs(s.values)) {
      const pts = r.map((i) => pt(i, s.values[i]!))
      if (r.length === 1) dots.push({ cx: x(props.ts[r[0]]), cy: y(s.values[r[0]]!) })
      else lines.push(`M${pts.join('L')}`)
      if (s.area) areas.push(`M${x(props.ts[r[0]]).toFixed(1)},${base}L${pts.join('L')}L${x(props.ts[r[r.length - 1]]).toFixed(1)},${base}Z`)
    }
    return { s, bands, lines, areas, dots }
  })
})

function onMove(e: PointerEvent): void {
  if (!any.value || !props.ts.length) return
  const svg = e.currentTarget as SVGElement
  const rect = svg.getBoundingClientRect()
  const px = ((e.clientX - rect.left) * width.value) / rect.width
  const t = props.from + ((px - PAD.l) / innerW.value) * (props.to - props.from) - half.value
  hover.value = Math.min(props.ts.length - 1, Math.max(0, Math.round((t - props.ts[0]) / (props.step || 1))))
}

const tip = computed(() => {
  const i = hover.value
  if (i == null) return null
  const hx = x(props.ts[i])
  return {
    x: hx,
    left: hx + 180 > width.value ? Math.max(0, hx - 192) : hx + 12,
    time: bucketTime(props.ts[i], props.step),
    rows: props.series.map((s) => {
      const v = s.values[i]
      const lo = s.band?.[0][i]
      const hi = s.band?.[1][i]
      return {
        label: s.label,
        color: s.color,
        text: v == null ? '—' : val(v) + (lo != null && hi != null ? ` (${val(lo)} – ${val(hi)})` : ''),
        cy: v == null ? null : y(v),
      }
    }),
  }
})
</script>

<template>
  <div ref="box" class="hk-lc">
    <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="label" @pointermove="onMove" @pointerdown="onMove" @pointerleave="hover = null">
      <rect v-for="(z, k) in zoneRects" :key="`z${k}`" class="hk-lc__zone" :x="PAD.l" :width="innerW" :y="z.y" :height="z.h" :fill="z.color">
        <title v-if="z.label">{{ z.label }}</title>
      </rect>
      <g v-for="v in yt.ticks" :key="v">
        <line class="hk-lc__grid" :x1="PAD.l" :x2="width - PAD.r" :y1="Math.round(y(v)) + 0.5" :y2="Math.round(y(v)) + 0.5" />
        <text class="hk-lc__axis" :x="PAD.l - 6" :y="Math.round(y(v)) + 4" text-anchor="end">{{ fmtY(v) }}</text>
      </g>
      <text v-for="t in xTicks" :key="t.t" class="hk-lc__axis" :x="t.x" :y="height - 5" text-anchor="middle">{{ t.label }}</text>
      <text v-if="!any" class="hk-lc__empty" :x="PAD.l + innerW / 2" :y="PAD.t + innerH / 2" text-anchor="middle">{{ empty }}</text>

      <g v-for="(p, k) in paths" :key="k">
        <path v-for="(d, j) in p.bands" :key="`b${j}`" class="hk-lc__band" :fill="p.s.color" :d="d" />
        <path v-for="(d, j) in p.areas" :key="`a${j}`" class="hk-lc__area" :fill="p.s.color" :d="d" />
        <path v-for="(d, j) in p.lines" :key="`l${j}`" class="hk-lc__line" :class="{ 'is-dash': p.s.dash }" :stroke="p.s.color" :d="d" />
        <circle v-for="(c, j) in p.dots" :key="`d${j}`" :cx="c.cx" :cy="c.cy" r="2.5" :fill="p.s.color" />
      </g>

      <template v-if="tip">
        <line class="hk-lc__cross" :x1="tip.x" :x2="tip.x" :y1="PAD.t" :y2="PAD.t + innerH" />
        <template v-for="(r, k) in tip.rows" :key="k">
          <circle v-if="r.cy != null" class="hk-lc__dot" :cx="tip.x" :cy="r.cy" r="4.5" :fill="r.color" />
        </template>
      </template>
    </svg>

    <div v-if="tip" class="hk-lc__tip" :style="{ left: `${tip.left}px` }" role="status">
      <div class="hk-label">{{ tip.time }}</div>
      <div v-for="(r, k) in tip.rows" :key="k" class="hk-lc__row">
        <span class="hk-lc__key" :style="{ background: r.color }" />
        <span>{{ r.label }}</span>
        <b>{{ r.text }}</b>
      </div>
    </div>

    <div v-if="series.length > 1" class="hk-lc__legend">
      <span v-for="s in series" :key="s.label"><span class="hk-lc__key hk-lc__key--line" :class="{ 'is-dash': s.dash }" :style="{ color: s.color }" />{{ s.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.hk-lc {
  position: relative;
  width: 100%;
  min-width: 0;
  user-select: none;
  touch-action: pan-y;
}
.hk-lc svg {
  display: block;
  width: 100%;
  overflow: visible;
}
.hk-lc__grid {
  stroke: rgb(var(--v-theme-outline-variant));
  stroke-width: 1;
  shape-rendering: crispEdges;
}
.hk-lc__axis {
  fill: rgb(var(--v-theme-on-surface-muted));
  font-size: 11px;
}
.hk-lc__empty {
  fill: rgb(var(--v-theme-on-surface-muted));
  font-size: 13px;
}
.hk-lc__line {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.hk-lc__line.is-dash {
  stroke-dasharray: 5 4;
}
.hk-lc__area {
  opacity: 0.16;
}
.hk-lc__band {
  opacity: 0.18;
}
.hk-lc__zone {
  opacity: 0.1;
}
.hk-lc__cross {
  stroke: rgb(var(--v-theme-on-surface-muted));
  stroke-dasharray: 3 3;
  shape-rendering: crispEdges;
}
.hk-lc__dot {
  stroke: rgb(var(--v-theme-surface-container));
  stroke-width: 2;
}
.hk-lc__tip {
  position: absolute;
  top: 0;
  z-index: 2;
  pointer-events: none;
  min-width: 170px;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}
.hk-lc__tip .hk-label {
  color: inherit;
  opacity: 0.75;
}
.hk-lc__row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hk-lc__row b {
  margin-left: auto;
  padding-left: 16px;
  font-weight: 600;
}
.hk-lc__key {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.hk-lc__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin-top: 6px;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-muted));
}
.hk-lc__legend > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.hk-lc__key--line {
  width: 16px;
  height: 0;
  border-radius: 0;
  border-top: 2px solid currentColor;
}
.hk-lc__key--line.is-dash {
  border-top-style: dashed;
}
</style>
