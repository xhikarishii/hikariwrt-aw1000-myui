// Engineering mode's maths, free of Vue so it can be tested: the reading
// history kept from the router's ring (merged as it grows), the figures
// shown beside each live reading (10 s average, best so far, change against
// a pinned reference), the antennas' spread, and the CSV export.

import { ENG_COLS, type EngCol, type EngSeries } from '@/api/modem'

export interface EngHistory {
  ts: number[]
  mode: string[]
  cols: Record<EngCol, (number | null)[]>
  marks: { t: number; label: string }[]
}

export function emptyHistory(): EngHistory {
  return { ts: [], mode: [], cols: Object.fromEntries(ENG_COLS.map((c) => [c, []])) as unknown as EngHistory['cols'], marks: [] }
}

/** The history with `add` appended (rows newer than its last only) and rows before `keepFrom` dropped. */
export function mergeHistory(h: EngHistory, add: EngSeries, keepFrom = 0): EngHistory {
  const ts = add.series.ts ?? []
  const last = h.ts.length ? h.ts[h.ts.length - 1]! : -Infinity
  const take = ts.map((t, i) => (t != null && t > last ? i : -1)).filter((i) => i >= 0)
  const out: EngHistory = {
    ts: [...h.ts, ...take.map((i) => ts[i]!)],
    mode: [...h.mode, ...take.map((i) => add.series.mode?.[i] ?? '')],
    cols: Object.fromEntries(ENG_COLS.map((c) => [c, [...h.cols[c], ...take.map((i) => add.series[c]?.[i] ?? null)]])) as unknown as EngHistory['cols'],
    marks: [...h.marks],
  }
  for (const m of add.marks) if (!out.marks.some((x) => x.t === m.ts && x.label === m.label)) out.marks.push({ t: m.ts, label: m.label })
  const cut = out.ts.findIndex((t) => t >= keepFrom)
  if (cut > 0) {
    out.ts = out.ts.slice(cut)
    out.mode = out.mode.slice(cut)
    for (const c of ENG_COLS) out.cols[c] = out.cols[c].slice(cut)
  } else if (cut < 0 && out.ts.length) {
    return { ...emptyHistory(), marks: out.marks.filter((m) => m.t >= keepFrom) }
  }
  out.marks = out.marks.filter((m) => m.t >= keepFrom)
  return out
}

/**
 * Series for a chart, with a null inserted wherever readings stopped for
 * longer than `maxGap` seconds (a pause, a scan, the session off): a gap in
 * the line rather than a straight line across it.
 */
export function gapped(h: EngHistory, keys: EngCol[], maxGap: number): { ts: number[]; values: (number | null)[][] } {
  const ts: number[] = []
  const values: (number | null)[][] = keys.map(() => [])
  for (let i = 0; i < h.ts.length; i++) {
    const t = h.ts[i]!
    if (i > 0 && t - h.ts[i - 1]! > maxGap) {
      ts.push(h.ts[i - 1]! + 1)
      values.forEach((v) => v.push(null))
    }
    ts.push(t)
    keys.forEach((k, j) => values[j]!.push(h.cols[k][i] ?? null))
  }
  return { ts, values }
}

export interface Figures {
  /** mean of the readings in the last `secs` seconds */
  avg: number | null
  /** the highest reading in the whole history: for RSRP, RSRQ and SINR higher is better */
  best: number | null
  /** how many readings the average is of */
  n: number
}

export function figures(ts: number[], values: (number | null)[], now: number, secs = 10): Figures {
  let sum = 0
  let n = 0
  let best: number | null = null
  for (let i = 0; i < ts.length; i++) {
    const v = values[i]
    if (v == null) continue
    if (best == null || v > best) best = v
    if (ts[i]! > now - secs) {
      sum += v
      n++
    }
  }
  return { avg: n ? Math.round((sum / n) * 10) / 10 : null, best, n }
}

/** Current minus reference, one decimal; null when either is missing. */
export function delta(cur: number | null | undefined, ref: number | null | undefined): number | null {
  if (cur == null || ref == null) return null
  return Math.round((cur - ref) * 10) / 10
}

export const signed = (v: number | null, unit = ' dB') => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}${unit}`)

/**
 * How evenly the receive paths hear the cell: the spread between the best and
 * the worst used path, and which is weakest. A spread over ~6 dB usually means
 * the router is side-on to the cell, or a path's antenna is shadowed.
 */
export function spread(paths: (number | null)[] | undefined): { used: number; spread: number | null; weakest: number | null; strongest: number | null } {
  const used = (paths ?? []).map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null)
  if (used.length < 2) return { used: used.length, spread: null, weakest: null, strongest: null }
  const lo = used.reduce((a, b) => (b.v < a.v ? b : a))
  const hi = used.reduce((a, b) => (b.v > a.v ? b : a))
  return { used: used.length, spread: hi.v - lo.v, weakest: lo.i, strongest: hi.i }
}

/** The history as CSV: one row per reading, local time and epoch, a mark column. */
export function toCsv(h: EngHistory): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const when = (t: number) => {
    const d = new Date(t * 1000)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
  const lines = [['time', 'epoch', 'mode', ...ENG_COLS, 'mark'].join(',')]
  for (let i = 0; i < h.ts.length; i++) {
    const t = h.ts[i]!
    const next = h.ts[i + 1] ?? Infinity
    const mark = h.marks.filter((m) => m.t >= t && m.t < next).map((m) => m.label).join(' ')
    lines.push([when(t), t, h.mode[i] ?? '', ...ENG_COLS.map((c) => h.cols[c][i] ?? ''), mark].join(','))
  }
  return lines.join('\n') + '\n'
}

/** The next free mark label: A, B, ... Z, then A2, B2, ... */
export function nextMark(marks: { label: string }[]): string {
  const taken = new Set(marks.map((m) => m.label))
  for (let round = 1; round < 10; round++)
    for (let c = 65; c <= 90; c++) {
      const l = String.fromCharCode(c) + (round > 1 ? round : '')
      if (!taken.has(l)) return l
    }
  return `M${marks.length + 1}`
}
