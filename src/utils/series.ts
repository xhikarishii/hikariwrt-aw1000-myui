// Chart maths for the Monitoring page, kept free of Vue so it can be tested:
// axis ticks, gap-aware paths, merging uptime-bar buckets, and the units
// the page prints.

import type { BucketState } from '@/api/monitor'

export interface Ticks {
  min: number
  max: number
  step: number
  ticks: number[]
}

/** "Nice" ticks from min up to at least max: 1, 2, 2.5 or 5 x 10^n apart. */
export function niceTicks(min: number, max: number, count = 4): Ticks {
  if (!(max > min)) max = min + 1
  const raw = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number((Math.round(v / step) * step).toPrecision(12)))
  return { min: lo, max: hi, step, ticks }
}

const TIME_STEPS = [300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 259200, 604800, 1209600, 2592000]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

/** Time-axis ticks between from and to (seconds), at most `max` of them,
 *  on local hour marks, or on local midnights for day steps. */
export function timeTicks(from: number, to: number, max: number): { t: number; label: string }[] {
  const span = to - from
  const step = TIME_STEPS.find((s) => span / s <= max) ?? TIME_STEPS[TIME_STEPS.length - 1]
  const out: number[] = []
  if (step >= 86400) {
    const d = new Date(from * 1000)
    d.setHours(0, 0, 0, 0)
    let t = d.getTime() / 1000
    while (t < from) t += 86400
    for (; t <= to; t += step) out.push(t)
  } else {
    const off = new Date(from * 1000).getTimezoneOffset() * 60
    for (let t = Math.ceil((from - off) / step) * step + off; t <= to; t += step) out.push(t)
  }
  return out.map((t) => ({ t, label: tickLabel(t, step) }))
}

function tickLabel(t: number, step: number): string {
  const d = new Date(t * 1000)
  if (step >= 86400 || (step >= 3600 && d.getHours() === 0 && d.getMinutes() === 0)) return `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "Sep 27, 14:05", "Sep 27, 14:00 – 14:20" for a bucket, "Sep 27" for a day. */
export function bucketTime(t: number, step?: number): string {
  const a = new Date(t * 1000)
  const s = `${MONTHS[a.getMonth()]} ${a.getDate()}, ${pad(a.getHours())}:${pad(a.getMinutes())}`
  if (!step || step <= 60) return s
  if (step >= 86400) return `${MONTHS[a.getMonth()]} ${a.getDate()}`
  const b = new Date((t + step) * 1000)
  return `${s} – ${pad(b.getHours())}:${pad(b.getMinutes())}`
}

/** Index runs without nulls: a gap in the history is a gap in the line. */
export function runs(values: (number | null)[]): number[][] {
  const out: number[][] = []
  let cur: number[] | null = null
  values.forEach((v, i) => {
    if (v == null) {
      cur = null
      return
    }
    if (!cur) out.push((cur = []))
    cur.push(i)
  })
  return out
}

/** Largest non-null value across arrays (0 when there is none). */
export function maxOf(...arrays: ((number | null)[] | undefined)[]): number {
  let m = 0
  for (const a of arrays) for (const v of a ?? []) if (v != null && v > m) m = v
  return m
}

export interface Bar {
  ts: number[]
  state: BucketState[]
  rtt: (number | null)[]
  loss: (number | null)[]
  step: number
}

/**
 * Merge buckets until there are at most `max` segments, so each one is wide
 * enough to point at. A merged segment takes the worst state in it (a short
 * outage must not vanish into the hours around it); latency and loss are the
 * mean of the buckets that have them.
 */
export function mergeBar(s: { ts: number[]; state: BucketState[]; rtt: (number | null)[]; loss: (number | null)[] }, step: number, max = 90): Bar {
  const n = s.ts.length
  const k = Math.max(1, Math.ceil(n / max))
  const out: Bar = { ts: [], state: [], rtt: [], loss: [], step: step * k }
  const mean = (a: (number | null)[]) => {
    const v = a.filter((x): x is number => x != null)
    return v.length ? v.reduce((p, c) => p + c, 0) / v.length : null
  }
  for (let i = 0; i < n; i += k) {
    let st: BucketState = 0
    for (let j = i; j < Math.min(i + k, n); j++) if (s.state[j] > st) st = s.state[j]
    out.ts.push(s.ts[i])
    out.state.push(st)
    out.rtt.push(mean(s.rtt.slice(i, i + k)))
    out.loss.push(mean(s.loss.slice(i, i + k)))
  }
  return out
}

/** Uptime: "100%", "99.98%" (floored, so a short outage never rounds away). */
export function uptimePct(v: number | null | undefined): string {
  if (v == null) return '—'
  if (v >= 100) return '100%'
  if (v >= 99.9) return `${(Math.floor(v * 100) / 100).toFixed(2)}%`
  return `${(Math.floor(v * 10) / 10).toFixed(1)}%`
}

export function ms(v: number | null | undefined): string {
  if (v == null) return '—'
  return v < 10 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`
}

export function pct(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v.toFixed(v >= 10 ? 0 : 1)}%`
}

/** Bytes per second as bits per second, decimal: what a line is sold in. */
export function rate(bytesPerSec: number | null | undefined): string {
  if (bytesPerSec == null) return '—'
  let b = bytesPerSec * 8
  const u = ['bps', 'kbps', 'Mbps', 'Gbps']
  let i = 0
  while (b >= 1000 && i < u.length - 1) {
    b /= 1000
    i++
  }
  return i === 0 || b >= 100 ? `${Math.round(b)} ${u[i]}` : `${b.toFixed(1)} ${u[i]}`
}

/** Short axis label for a rate: "48M", "1.5k". */
export function rateAxis(bytesPerSec: number): string {
  let b = bytesPerSec * 8
  const u = ['', 'k', 'M', 'G']
  let i = 0
  while (b >= 1000 && i < u.length - 1) {
    b /= 1000
    i++
  }
  return `${Number.isInteger(b) ? b : b.toFixed(1)}${u[i]}`
}
