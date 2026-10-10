import { describe, expect, it } from 'vitest'
import type { SignalSeries } from '@/api/monitor'
import { bandShares, db, dbm, gradeOf, gradesFor, mergeModes, rsrpGrades, worst, zonesOf } from './signal'

describe('grades', () => {
  it('grades RSRP through the window like aw1000-modem', () => {
    // -120..-60: 80/60/40 % are -72, -84, -96
    expect(rsrpGrades([-120, -60]).map((g) => g[0])).toEqual([-72, -84, -96])
    const g = gradesFor('rsrp', [-120, -60])
    expect(gradeOf(g, -70)).toBe('excellent')
    expect(gradeOf(g, -84)).toBe('good')
    expect(gradeOf(g, -95)).toBe('fair')
    expect(gradeOf(g, -97)).toBe('poor')
    expect(gradeOf(g, null)).toBe('unknown')
  })

  it('uses the dB bands for the rest', () => {
    expect(gradeOf(gradesFor('sinr'), 20)).toBe('excellent')
    expect(gradeOf(gradesFor('sinr'), 8)).toBe('fair')
    expect(gradeOf(gradesFor('sinr'), -3)).toBe('poor')
    expect(gradeOf(gradesFor('rsrq'), -11)).toBe('good')
    expect(gradeOf(gradesFor('rssi'), -58)).toBe('excellent')
  })

  it('takes the worse of two grades', () => {
    expect(worst('good', 'fair')).toBe('fair')
    expect(worst('unknown', 'good')).toBe('good')
    expect(worst('poor', 'unknown')).toBe('poor')
  })

  it('builds open-ended zones, best at the top', () => {
    expect(zonesOf(gradesFor('sinr'))).toEqual([
      { from: 20, to: null, grade: 'excellent' },
      { from: 13, to: 20, grade: 'good' },
      { from: 0, to: 13, grade: 'fair' },
      { from: null, to: 0, grade: 'poor' },
    ])
  })
})

describe('mergeModes', () => {
  const base = {
    ok: true, range: '1h', from: 0, to: 240, step: 60,
    ts: [0, 60, 120, 180],
    mode: [2, 3, 2, 0],
    lband: ['B28', 'B3', 'B28', null],
    nband: ['n78', null, 'n78', null],
    ca: [2, 1, 2, null],
    lte_rsrp: [-96, -90, -98, null],
    nr_rsrp: [-95, null, -97, null],
    lte_sinr: [8, 15, 6, null],
    nr_sinr: [14, null, 12, null],
  } as unknown as SignalSeries

  it('keeps every bucket when there are few', () => {
    const b = mergeModes(base, 90)
    expect(b.state).toEqual([2, 3, 2, 0])
    expect(b.step).toBe(60)
  })

  it('shows the worst mode and every band in a merged segment', () => {
    const b = mergeModes(base, 2)
    expect(b.step).toBe(120)
    expect(b.state).toEqual([3, 2])
    expect(b.lband).toEqual(['B28, B3', 'B28'])
    expect(b.nband).toEqual(['n78', 'n78'])
    expect(b.lrsrp[0]).toBe(-93)
    expect(b.nrsrp[1]).toBe(-97)
  })
})

describe('units', () => {
  it('prints readings with at most one decimal', () => {
    expect(dbm(-95.44)).toBe('-95.4 dBm')
    expect(db(13)).toBe('13 dB')
    expect(dbm(null)).toBe('—')
  })

  it('lists band shares', () => {
    expect(bandShares([{ band: 'B28', share: 58.8 }, { band: 'B3', share: 4.2 }])).toBe('B28 59%, B3 4.2%')
    expect(bandShares([])).toBe('—')
  })
})
