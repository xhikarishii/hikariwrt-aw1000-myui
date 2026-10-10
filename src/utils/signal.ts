// Signal maths for Monitoring -> Signal, free of Vue so it can be tested:
// grading readings the way aw1000-modem does, the chart's quality zones,
// merging the network-mode bar, and the units.

import type { ModeState, SignalSeries } from '@/api/monitor'

export type Grade = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown'
export type Metric = 'rsrp' | 'rsrq' | 'sinr' | 'rssi'

/** [lower bound, grade], best first; anything under the last is poor. */
export type Grades = [number, Grade][]

// aw1000-modem's dB bands (common.awk), so this page and the modem pages
// never disagree about a reading.
const DB_GRADES: Record<Exclude<Metric, 'rsrp'>, Grades> = {
  rsrq: [[-10, 'excellent'], [-15, 'good'], [-20, 'fair']],
  sinr: [[20, 'excellent'], [13, 'good'], [0, 'fair']],
  rssi: [[-65, 'excellent'], [-75, 'good'], [-85, 'fair']],
}

/** RSRP is graded through the configured window: 80 / 60 / 40 % of it. */
export function rsrpGrades(win: [number, number] = [-120, -60]): Grades {
  const [lo, hi] = win
  const span = hi - lo
  return [
    [lo + span * 0.8, 'excellent'],
    [lo + span * 0.6, 'good'],
    [lo + span * 0.4, 'fair'],
  ]
}

export function gradesFor(metric: Metric, win?: [number, number]): Grades {
  return metric === 'rsrp' ? rsrpGrades(win) : DB_GRADES[metric]
}

export function gradeOf(grades: Grades, v: number | null | undefined): Grade {
  if (v == null || !Number.isFinite(v)) return 'unknown'
  for (const [min, g] of grades) if (v >= min) return g
  return 'poor'
}

const ORDER: Grade[] = ['excellent', 'good', 'fair', 'poor']

/** The worse of two grades; unknown only when both are. */
export function worst(a: Grade, b: Grade): Grade {
  const i = ORDER.indexOf(a)
  const j = ORDER.indexOf(b)
  if (i < 0) return b
  if (j < 0) return a
  return ORDER[Math.max(i, j)]!
}

export const GRADE_NAME: Record<Grade, string> = { excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor', unknown: 'Unknown' }

export interface Zone {
  from: number | null
  to: number | null
  grade: Exclude<Grade, 'unknown'>
}

/** Chart bands of y, one per grade, open-ended at the top and bottom. */
export function zonesOf(grades: Grades): Zone[] {
  const out: Zone[] = []
  let top: number | null = null
  for (const [min, g] of grades) {
    out.push({ from: min, to: top, grade: g as Zone['grade'] })
    top = min
  }
  out.push({ from: null, to: top, grade: 'poor' })
  return out
}

export const MODE_NAME: Record<ModeState, string> = { 0: 'No data', 1: '5G SA', 2: '5G NSA', 3: 'LTE', 4: 'No service' }
export const MODE_OF = { sa: 1, nsa: 2, lte: 3, none: 4 } as const

export interface ModeBar {
  ts: number[]
  state: ModeState[]
  step: number
  lband: string[]
  nband: string[]
  lrsrp: (number | null)[]
  nrsrp: (number | null)[]
  lsinr: (number | null)[]
  nsinr: (number | null)[]
}

const mean = (a: (number | null)[]) => {
  const v = a.filter((x): x is number => x != null)
  return v.length ? v.reduce((p, c) => p + c, 0) / v.length : null
}

/**
 * Merge buckets until there are at most `max` segments, like the uptime bar.
 * A merged segment shows the worst mode in it (no service over LTE over 5G
 * NSA over SA), so a short drop to LTE stays visible; the bands are every
 * one seen, the readings the mean.
 */
export function mergeModes(s: SignalSeries, max = 90): ModeBar {
  const n = s.ts.length
  const k = Math.max(1, Math.ceil(n / max))
  const out: ModeBar = { ts: [], state: [], step: s.step * k, lband: [], nband: [], lrsrp: [], nrsrp: [], lsinr: [], nsinr: [] }
  for (let i = 0; i < n; i += k) {
    let st: ModeState = 0
    const lb = new Set<string>()
    const nb = new Set<string>()
    for (let j = i; j < Math.min(i + k, n); j++) {
      if (s.mode[j]! > st) st = s.mode[j]!
      if (s.lband[j]) lb.add(s.lband[j]!)
      if (s.nband[j]) nb.add(s.nband[j]!)
    }
    out.ts.push(s.ts[i]!)
    out.state.push(st)
    out.lband.push([...lb].join(', '))
    out.nband.push([...nb].join(', '))
    out.lrsrp.push(mean(s.lte_rsrp.slice(i, i + k)))
    out.nrsrp.push(mean(s.nr_rsrp.slice(i, i + k)))
    out.lsinr.push(mean(s.lte_sinr.slice(i, i + k)))
    out.nsinr.push(mean(s.nr_sinr.slice(i, i + k)))
  }
  return out
}

/** "-95.5 dBm", one decimal at most. */
export const dbm = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 10) / 10} dBm`)
export const db = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 10) / 10} dB`)

/** "B28 58%, B3 42%" */
export function bandShares(list: { band: string; share: number }[] | undefined): string {
  if (!list?.length) return '—'
  return list.map((b) => `${b.band} ${b.share >= 10 ? Math.round(b.share) : b.share}%`).join(', ')
}
