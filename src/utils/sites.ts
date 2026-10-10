// Helpers for Monitoring -> Sites, free of Vue so they can be tested.

import type { SiteResult } from '@/api/monitor'

export type Tone = 'good' | 'fair' | 'poor' | 'none'

/** Green under 100 ms, orange under 200, red above or without an answer. */
export function toneOf(r: SiteResult | null | undefined): Tone {
  if (!r) return 'none'
  if (!r.ok || r.latency == null) return 'poor'
  return r.latency < 100 ? 'good' : r.latency < 200 ? 'fair' : 'poor'
}

/** A check's time as a tile shows it. */
export function resultText(r: SiteResult | null | undefined, gateway = false): string {
  if (!r) return '—'
  if (!r.ok) return gateway ? 'no reply' : 'timeout'
  return msShort(r.latency)
}

export function msShort(v: number | null | undefined): string {
  if (v == null) return '—'
  return v < 10 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`
}

/** The mean response time of the sites that answered, or null. */
export function meanLatency(results: Record<string, SiteResult>): number | null {
  const v = Object.values(results)
    .filter((r) => r.ok && r.latency != null)
    .map((r) => r.latency!)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/** Bytes a day the checks cost: about 5 kB each, mostly the TLS handshake. */
export function dailyCost(sites: number, wans: number, interval: number): number {
  return sites * wans * 5000 * Math.floor(86400 / interval)
}

const LETTER_ROLES = ['primary', 'secondary', 'tertiary', 'error'] as const

/** The container role a site's letter tile takes, the same every time. */
export function letterRole(host: string): (typeof LETTER_ROLES)[number] {
  let h = 0
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) % 9973
  return LETTER_ROLES[h % LETTER_ROLES.length]!
}

/** "www.example.com" -> "E" */
export function letterOf(host: string): string {
  return host.replace(/^www\./, '').charAt(0).toUpperCase() || '?'
}

/** "3 min ago" */
export function ago(ts: number | null | undefined, now: number): string {
  if (!ts) return 'not yet'
  const s = Math.max(0, now - ts)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  return `${Math.floor(s / 3600)} h ago`
}
