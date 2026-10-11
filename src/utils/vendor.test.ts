import { describe, expect, it } from 'vitest'
import { parseOui, vendorOf } from './vendor'

const list = parseOui('9C6B00\tASRock Incorporation\nF0D5BF\tIntel\nbad line\n')

describe('vendor', () => {
  it('reads the list', () => {
    expect(list.size).toBe(2)
    expect(list.get('F0D5BF')).toBe('Intel')
  })

  it('finds the maker from the first three bytes', () => {
    expect(vendorOf('9c:6b:00:8e:9c:8f', list)).toEqual({ kind: 'vendor', name: 'ASRock Incorporation' })
    expect(vendorOf('F0-D5-BF-11-22-33', list)).toEqual({ kind: 'vendor', name: 'Intel' })
  })

  it('says when a MAC is made up', () => {
    // 0x26: the locally administered bit is set
    expect(vendorOf('26:65:96:F9:F6:BB', list)).toEqual({ kind: 'private' })
  })

  it('says when the maker is not listed', () => {
    expect(vendorOf('00:11:22:33:44:55', list)).toEqual({ kind: 'unknown' })
  })
})
