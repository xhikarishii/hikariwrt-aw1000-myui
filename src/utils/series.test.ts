import { describe, expect, it } from 'vitest'
import { bucketTime, maxOf, mergeBar, niceTicks, pct, rate, rateAxis, runs, timeTicks, uptimePct } from './series'

describe('niceTicks', () => {
  it('rounds the top up to a nice step', () => {
    expect(niceTicks(0, 37)).toEqual({ min: 0, max: 40, step: 10, ticks: [0, 10, 20, 30, 40] })
  })
  it('handles small ranges without float noise', () => {
    const t = niceTicks(0, 0.7)
    expect(t.ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8])
  })
  it('gives an axis for an empty chart', () => {
    expect(niceTicks(0, 0).max).toBeGreaterThan(0)
  })
  it('uses 2.5 steps', () => {
    expect(niceTicks(0, 9, 4).step).toBe(2.5)
  })
})

describe('timeTicks', () => {
  it('puts hour steps on local hour marks', () => {
    const from = new Date(2026, 8, 27, 10, 17).getTime() / 1000
    const ticks = timeTicks(from, from + 6 * 3600, 6)
    expect(ticks.length).toBeGreaterThan(0)
    for (const t of ticks) expect(new Date(t.t * 1000).getMinutes()).toBe(0)
    expect(ticks[0].label).toBe('11:00')
  })
  it('labels a week on a narrow chart more than once', () => {
    const from = new Date(2026, 9, 5, 3, 0).getTime() / 1000
    const ticks = timeTicks(from, from + 7 * 86400, 3)
    expect(ticks.length).toBeGreaterThanOrEqual(2)
  })

  it('uses local midnights and dates for day steps', () => {
    const from = new Date(2026, 8, 1, 13, 0).getTime() / 1000
    const ticks = timeTicks(from, from + 30 * 86400, 5)
    for (const t of ticks) expect(new Date(t.t * 1000).getHours()).toBe(0)
    expect(ticks[0].label).toBe('Sep 2')
  })
  it('never returns more than asked', () => {
    const from = 1790000000
    expect(timeTicks(from, from + 86400, 4).length).toBeLessThanOrEqual(5)
  })
})

describe('bucketTime', () => {
  it('shows a range for buckets longer than a minute', () => {
    const t = new Date(2026, 8, 27, 14, 0).getTime() / 1000
    expect(bucketTime(t, 1200)).toBe('Sep 27, 14:00 – 14:20')
    expect(bucketTime(t, 60)).toBe('Sep 27, 14:00')
    expect(bucketTime(t, 86400)).toBe('Sep 27')
  })
})

describe('runs', () => {
  it('splits at nulls', () => {
    expect(runs([1, 2, null, null, 3, null, 4, 5])).toEqual([[0, 1], [4], [6, 7]])
    expect(runs([null, null])).toEqual([])
  })
})

describe('maxOf', () => {
  it('ignores nulls and missing arrays', () => {
    expect(maxOf([1, null, 3], undefined, [2])).toBe(3)
    expect(maxOf([null])).toBe(0)
  })
})

describe('mergeBar', () => {
  const s = {
    ts: [0, 60, 120, 180, 240, 300],
    state: [1, 1, 3, 1, 0, 0] as (0 | 1 | 2 | 3)[],
    rtt: [10, 20, null, 30, null, null],
    loss: [0, 0, 100, 0, null, null],
  }
  it('keeps the worst state so an outage stays visible', () => {
    const m = mergeBar(s, 60, 2)
    expect(m.state).toEqual([3, 1])
    expect(m.ts).toEqual([0, 180])
    expect(m.step).toBe(180)
  })
  it('averages the buckets that have values', () => {
    const m = mergeBar(s, 60, 2)
    expect(m.rtt).toEqual([15, 30])
    expect(m.loss[0]).toBeCloseTo(33.333, 2)
  })
  it('leaves short series alone', () => {
    expect(mergeBar(s, 60, 90).state).toEqual(s.state)
  })
})

describe('units', () => {
  it('floors uptime so an outage never rounds to 100%', () => {
    expect(uptimePct(99.999)).toBe('99.99%')
    expect(uptimePct(100)).toBe('100%')
    expect(uptimePct(97.46)).toBe('97.4%')
    expect(uptimePct(null)).toBe('—')
  })
  it('prints rates in bits', () => {
    expect(rate(125000)).toBe('1.0 Mbps')
    expect(rate(33)).toBe('264 bps')
    expect(rate(6_250_000)).toBe('50.0 Mbps')
    expect(rateAxis(6_000_000)).toBe('48M')
  })
  it('prints loss', () => {
    expect(pct(0)).toBe('0.0%')
    expect(pct(12.4)).toBe('12%')
  })
})
