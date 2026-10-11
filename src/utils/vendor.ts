// MAC vendor names from the IEEE registry (public/oui.tsv.gz, built by
// scripts/update-oui.mjs). The list is fetched and unpacked the first time
// a device is opened, then kept for the session.

import { isRandomMac } from '@/utils/clients'

export type Vendor = { kind: 'vendor'; name: string } | { kind: 'private' } | { kind: 'unknown' }

/** "PREFIX\tName" lines into a map keyed by the six hex digits. */
export function parseOui(text: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab === 6) m.set(line.slice(0, 6), line.slice(7).trim())
  }
  return m
}

/** What a MAC says about its maker, given the list. */
export function vendorOf(mac: string, list: Map<string, string>): Vendor {
  // A locally administered address is made up (phones' private Wi-Fi
  // addresses): its first three bytes belong to nobody.
  if (isRandomMac(mac)) return { kind: 'private' }
  const name = list.get(mac.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase())
  return name ? { kind: 'vendor', name } : { kind: 'unknown' }
}

let loading: Promise<Map<string, string>> | null = null

/** The list, fetched once. An empty map when it can't be had. */
export function vendorList(): Promise<Map<string, string>> {
  loading ??= (async () => {
    try {
      const r = await fetch('./oui.tsv.gz')
      if (!r.ok || !r.body) return new Map()
      // uhttpd serves the .gz as it is, so it's unpacked here
      const text = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text()
      return parseOui(text)
    } catch {
      return new Map()
    }
  })()
  return loading
}

export async function lookupVendor(mac: string): Promise<Vendor> {
  if (isRandomMac(mac)) return { kind: 'private' }
  return vendorOf(mac, await vendorList())
}
