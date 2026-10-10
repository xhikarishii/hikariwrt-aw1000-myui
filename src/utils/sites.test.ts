import { describe, expect, it } from 'vitest'
import type { SiteResult } from '@/api/monitor'
import { ago, dailyCost, letterOf, letterRole, meanLatency, resultText, toneOf } from './sites'

const r = (ok: boolean, latency: number | null): SiteResult => ({ ts: 0, ok, code: ok ? 200 : null, latency, connect: null })

describe('sites', () => {
  it('colours a time like the reference grid', () => {
    expect(toneOf(r(true, 4))).toBe('good')
    expect(toneOf(r(true, 176))).toBe('fair')
    expect(toneOf(r(true, 201))).toBe('poor')
    expect(toneOf(r(false, null))).toBe('poor')
    expect(toneOf(undefined)).toBe('none')
  })

  it('prints a check', () => {
    expect(resultText(r(true, 3.74))).toBe('3.7 ms')
    expect(resultText(r(true, 221.6))).toBe('222 ms')
    expect(resultText(r(false, null))).toBe('timeout')
    expect(resultText(r(false, null), true)).toBe('no reply')
    expect(resultText(null)).toBe('—')
  })

  it('averages the sites that answered', () => {
    expect(meanLatency({ a: r(true, 100), b: r(true, 200), c: r(false, null) })).toBe(150)
    expect(meanLatency({})).toBeNull()
  })

  it('estimates the daily cost', () => {
    // 15 sites, 2 WANs, every 5 minutes: 43.2 MB
    expect(dailyCost(15, 2, 300)).toBe(43_200_000)
  })

  it('gives a site the same letter tile every time', () => {
    expect(letterOf('www.messenger.com')).toBe('M')
    expect(letterRole('messenger.com')).toBe(letterRole('messenger.com'))
  })

  it('says how long ago', () => {
    expect(ago(1000, 1030)).toBe('just now')
    expect(ago(1000, 1000 + 180)).toBe('3 min ago')
    expect(ago(null, 1000)).toBe('not yet')
  })
})
