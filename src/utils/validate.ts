// Field checks shared by the settings forms. Each returns an error message
// or null, so templates can bind them straight to error-messages.

export function isIPv4(s: string): boolean {
  const p = s.trim().split('.')
  return p.length === 4 && p.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255)
}

export function ipError(s: string, required = true): string | null {
  if (!s.trim()) return required ? 'Required' : null
  return isIPv4(s) ? null : 'Not an IPv4 address'
}

export function netmaskError(s: string): string | null {
  if (!isIPv4(s)) return 'Not a netmask'
  const bits = s
    .split('.')
    .map((x) => Number(x).toString(2).padStart(8, '0'))
    .join('')
  return /^1*0*$/.test(bits) ? null : 'Not a valid netmask'
}

/** "1.1.1.1, 9.9.9.9" or space separated -> list. */
export function parseList(s: string): string[] {
  return s.split(/[\s,]+/).filter(Boolean)
}

export function dnsError(s: string): string | null {
  const l = parseList(s)
  return l.every(isIPv4) ? null : 'Use IPv4 addresses, separated by commas'
}

/** SSIDs are up to 32 bytes (UTF-8), not characters. */
export function ssidError(s: string): string | null {
  const n = new TextEncoder().encode(s).length
  if (!n) return 'Required'
  return n > 32 ? `Too long (${n} of 32 bytes)` : null
}

/** WPA passphrase: 8-63 printable ASCII, or exactly 64 hex digits. */
export function keyError(s: string, encryption: string): string | null {
  if (encryption === 'none' || encryption === 'owe') return null
  if (/^[0-9a-fA-F]{64}$/.test(s)) return null
  if (s.length < 8) return 'At least 8 characters'
  if (s.length > 63) return 'At most 63 characters'
  return /^[\x20-\x7e]+$/.test(s) ? null : 'Letters, digits and ASCII symbols only'
}

/** "aa-bb-cc-dd-ee-ff" or "aabb.ccdd.eeff" -> "AA:BB:CC:DD:EE:FF"; null if it isn't a MAC. */
export function normalizeMac(s: string): string | null {
  const hex = s.trim().replace(/[:.\-\s]/g, '')
  if (!/^[0-9a-fA-F]{12}$/.test(hex)) return null
  return hex.toUpperCase().match(/../g)!.join(':')
}

/**
 * A MAC a WAN port may take: six hex pairs, not all zeros, and unicast (a
 * multicast address - the lowest bit of the first byte set - is never a
 * device's own, and no ISP would hand out a lease to it).
 */
export function macError(s: string): string | null {
  if (!s.trim()) return 'Required'
  const m = normalizeMac(s)
  if (!m) return 'Six pairs of hex digits, like 00:11:22:AA:BB:CC'
  if (m === '00:00:00:00:00:00') return 'Not a usable address'
  if (parseInt(m.slice(0, 2), 16) & 1) return 'That’s a multicast address; the first pair has to be even'
  return null
}

export function mtuError(s: string): string | null {
  if (!s.trim()) return null
  const n = Number(s)
  return Number.isInteger(n) && n >= 576 && n <= 9000 ? null : '576 to 9000'
}

/**
 * A Wi-Fi password people can read out and type: 12 characters from an
 * alphabet without look-alikes (no 0/O, 1/l/I), from the crypto RNG.
 */
export function generatePassword(length = 12): string {
  const A = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const r = new Uint32Array(length)
  crypto.getRandomValues(r)
  return Array.from(r, (n) => A[n % A.length]).join('')
}
