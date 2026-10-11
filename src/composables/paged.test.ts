import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { usePaged } from './paged'

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

describe('usePaged', () => {
  it('shows 10 at a time, and says where it is', () => {
    const p = usePaged(ref(range(25)), ref('24h'))
    expect(p.pages.value).toBe(3)
    expect(p.visible.value).toEqual(range(10))
    p.go(2)
    expect(p.visible.value).toEqual(range(25).slice(20))
    expect([p.from.value, p.to.value, p.total.value]).toEqual([21, 25, 25])
  })

  it('stays within the pages there are', () => {
    const p = usePaged(ref(range(15)), ref('24h'))
    p.go(9)
    expect(p.page.value).toBe(1)
    p.go(-3)
    expect(p.page.value).toBe(0)
  })

  it('goes back to the first page when the period changes', async () => {
    const period = ref('24h')
    const p = usePaged(ref(range(40)), period)
    p.go(3)
    period.value = '7d'
    await nextTick()
    expect(p.page.value).toBe(0)
  })

  it('follows a list that shrinks under the page', async () => {
    const list = ref(range(40))
    const p = usePaged(list, ref('24h'))
    p.go(3)
    list.value = range(14)
    await nextTick()
    expect(p.page.value).toBe(1)
    expect(p.visible.value).toEqual(range(14).slice(10))
  })

  it('is one empty page for no entries', () => {
    const p = usePaged(ref([] as number[]), ref('1h'))
    expect([p.pages.value, p.from.value, p.to.value]).toEqual([1, 0, 0])
  })
})
