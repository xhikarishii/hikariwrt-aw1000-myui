import { expect, it } from 'vitest'
import { dnsError, ipError, keyError, macError, mtuError, netmaskError, normalizeMac, parseList, ssidError } from './validate'

it('ip and netmask', () => {
  expect(ipError('192.168.88.1')).toBeNull()
  expect(ipError('256.1.1.1')).toBe('Not an IPv4 address')
  expect(ipError('', false)).toBeNull()
  expect(netmaskError('255.255.255.0')).toBeNull()
  expect(netmaskError('255.0.255.0')).toBe('Not a valid netmask')
})

it('dns lists', () => {
  expect(parseList('1.1.1.1, 9.9.9.9  8.8.8.8')).toEqual(['1.1.1.1', '9.9.9.9', '8.8.8.8'])
  expect(dnsError('1.1.1.1,x')).not.toBeNull()
})

it('ssid counts bytes', () => {
  expect(ssidError('udr.hikari-shii.moe')).toBeNull()
  expect(ssidError('é'.repeat(17))).toMatch(/34 of 32/)
  expect(ssidError('')).toBe('Required')
})

it('wpa keys', () => {
  expect(keyError('short', 'psk2')).toBe('At least 8 characters')
  expect(keyError('a'.repeat(64), 'sae')).toBeNull()
  expect(keyError('', 'none')).toBeNull()
  expect(keyError('pässwörd1', 'psk2')).toMatch(/ASCII/)
})

it('mtu', () => {
  expect(mtuError('')).toBeNull()
  expect(mtuError('1492')).toBeNull()
  expect(mtuError('100')).toBe('576 to 9000')
})

it('generates readable passwords', async () => {
  const { generatePassword, keyError } = await import('./validate')
  const p = generatePassword()
  expect(p).toHaveLength(12)
  expect(p).not.toMatch(/[0O1lI]/)
  expect(keyError(p, 'sae-mixed')).toBeNull()
})

it('reads MAC addresses in the usual spellings', () => {
  expect(normalizeMac('00:11:46:e9:c5:9d')).toBe('00:11:46:E9:C5:9D')
  expect(normalizeMac('00-11-46-E9-C5-9D')).toBe('00:11:46:E9:C5:9D')
  expect(normalizeMac('0011.46e9.c59d')).toBe('00:11:46:E9:C5:9D')
  expect(normalizeMac('00:11:46:e9:c5')).toBeNull()
})

it('accepts only unicast MACs for the WAN', () => {
  expect(macError('00:11:46:E9:C5:9D')).toBeNull()
  expect(macError('')).toBe('Required')
  expect(macError('01:00:5e:00:00:01')).toMatch(/multicast/)
  expect(macError('00:00:00:00:00:00')).toMatch(/usable/)
  expect(macError('zz:11:22:33:44:55')).toMatch(/hex/)
})
