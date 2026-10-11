import { computed, ref, watch, type ComputedRef, type Ref, type WatchSource } from 'vue'

// A long list a page at a time, 10 to a page so a log never means a long
// scroll. The Monitoring logs list every entry of the period - a month of
// signal changes runs to thousands. Back to the first page whenever `reset`
// changes (the period, a filter); a list that shrinks under the page (the
// period's data refreshed) moves it back to the last page there is.
export interface Paged {
  /** 0-based */
  page: Ref<number>
  pages: ComputedRef<number>
  /** 1-based positions of the page's first and last entry, and of all */
  from: ComputedRef<number>
  to: ComputedRef<number>
  total: ComputedRef<number>
  go: (page: number) => void
}

export function usePaged<T>(list: Ref<T[]>, reset: WatchSource, size = 10): Paged & { visible: ComputedRef<T[]> } {
  const page = ref(0)
  watch(reset, () => (page.value = 0))
  const total = computed(() => list.value.length)
  const pages = computed(() => Math.max(1, Math.ceil(total.value / size)))
  watch(pages, (n) => {
    if (page.value > n - 1) page.value = n - 1
  })
  const visible = computed(() => list.value.slice(page.value * size, (page.value + 1) * size))
  const from = computed(() => (total.value ? page.value * size + 1 : 0))
  const to = computed(() => Math.min(total.value, (page.value + 1) * size))
  const go = (p: number) => (page.value = Math.min(pages.value - 1, Math.max(0, p)))
  return { page, pages, visible, from, to, total, go }
}
