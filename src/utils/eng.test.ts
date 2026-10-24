import { describe, expect, it } from 'vitest'
import type { EngSeries } from '@/api/modem'
import { delta, emptyHistory, figures, gapped, mergeHistory, nextMark, signed, spread, toCsv } from './eng'

const rows = (ts: number[], nr: (number | null)[], marks: { ts: number; label: string }[] = []): EngSeries => ({
  ok: true,
  rows: ts.length,
  series: { ts, mode: ts.map(() => 'nsa'), nr_rsrp: nr, nr_a0: nr.map((v) => (v == null ? null : v - 5)) },
  marks,
})

describe('mergeHistory', () => {
  it('appends only newer rows and keeps marks once', () => {
    let h = mergeHistory(emptyHistory(), rows([100, 102, 104], [-96, -95, -94], [{ ts: 102, label: 'A' }]))
    h = mergeHistory(h, rows([104, 106], [-94, -93], [{ ts: 102, label: 'A' }]))
    expect(h.ts).toEqual([100, 102, 104, 106])
    expect(h.cols.nr_rsrp).toEqual([-96, -95, -94, -93])
    expect(h.cols.nr_a0).toEqual([-101, -100, -99, -98])
    // a column the router didn't send is null, not missing
    expect(h.cols.lte_rsrp).toEqual([null, null, null, null])
    expect(h.marks).toEqual([{ t: 102, label: 'A' }])
  })

  it('drops rows and marks older than the window', () => {
    const h = mergeHistory(emptyHistory(), rows([100, 102, 104], [-96, -95, -94], [{ ts: 100, label: 'A' }, { ts: 104, label: 'B' }]), 102)
    expect(h.ts).toEqual([102, 104])
    expect(h.mode).toEqual(['nsa', 'nsa'])
    expect(h.marks).toEqual([{ t: 104, label: 'B' }])
    expect(mergeHistory(h, rows([], []), 200).ts).toEqual([])
  })
})

describe('gapped', () => {
  it('breaks the line where readings stopped', () => {
    const h = mergeHistory(emptyHistory(), rows([100, 102, 130, 132], [-96, -95, -90, -91]))
    const g = gapped(h, ['nr_rsrp'], 10)
    expect(g.ts).toEqual([100, 102, 103, 130, 132])
    expect(g.values[0]).toEqual([-96, -95, null, -90, -91])
  })
})

describe('figures', () => {
  it('averages the last 10 s and keeps the best of all', () => {
    const f = figures([100, 104, 108, 112], [-90, -100, -96, -94], 113)
    expect(f).toEqual({ avg: -96.7, best: -90, n: 3 })
    expect(figures([], [], 0)).toEqual({ avg: null, best: null, n: 0 })
  })

  it('deltas against a reference', () => {
    expect(delta(-92, -95)).toBe(3)
    expect(delta(null, -95)).toBeNull()
    expect(signed(3)).toBe('+3 dB')
    expect(signed(-2.5)).toBe('−2.5 dB')
    expect(signed(0)).toBe('±0 dB')
  })
})

describe('spread', () => {
  it('finds the weakest of the used paths', () => {
    expect(spread([-110, -95, -100, -94])).toEqual({ used: 4, spread: 16, weakest: 0, strongest: 3 })
    expect(spread([-93, -97, null, null])).toEqual({ used: 2, spread: 4, weakest: 1, strongest: 0 })
    expect(spread([-93, null, null, null]).spread).toBeNull()
  })
})

describe('export and marks', () => {
  it('writes one CSV row per reading with its mark', () => {
    const h = mergeHistory(emptyHistory(), rows([100, 102], [-96, -95], [{ ts: 101, label: 'A' }]))
    const csv = toCsv(h).trim().split('\n')
    expect(csv[0]!.startsWith('time,epoch,mode,lte_rsrp')).toBe(true)
    expect(csv[0]!.endsWith(',mark')).toBe(true)
    expect(csv[1]!.split(',').slice(1, 3)).toEqual(['100', 'nsa'])
    expect(csv[1]!.endsWith(',A')).toBe(true)
    expect(csv[2]!.endsWith(',')).toBe(true)
  })

  it('labels marks A, B, … then A2', () => {
    expect(nextMark([])).toBe('A')
    expect(nextMark([{ label: 'A' }, { label: 'B' }])).toBe('C')
    expect(nextMark(Array.from({ length: 26 }, (_, i) => ({ label: String.fromCharCode(65 + i) })))).toBe('A2')
  })
})
