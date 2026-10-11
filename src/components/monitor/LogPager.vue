<script setup lang="ts">
import HkIcon from '@/components/icons/HkIcon.vue'
import type { Paged } from '@/composables/paged'

// The pager under a Monitoring log: where this page sits ("11–20 of 1,351")
// and first / previous / next / last. Shown only when there is more than one
// page.
defineProps<{ p: Paged; label: string }>()
const n = (v: number) => v.toLocaleString()
</script>

<template>
  <nav v-if="p.pages.value > 1" class="hk-pager" :aria-label="`${label} pages`">
    <span class="hk-label hk-pager__pos" aria-live="polite">{{ n(p.from.value) }}–{{ n(p.to.value) }} of {{ n(p.total.value) }}</span>
    <v-btn icon variant="text" size="small" aria-label="First page" :disabled="p.page.value === 0" @click="p.go(0)"><HkIcon name="chevronFirst" :size="18" /></v-btn>
    <v-btn icon variant="text" size="small" aria-label="Previous page" :disabled="p.page.value === 0" @click="p.go(p.page.value - 1)"><HkIcon name="chevronLeft" :size="18" /></v-btn>
    <span class="hk-pager__page">{{ p.page.value + 1 }} / {{ p.pages.value }}</span>
    <v-btn icon variant="text" size="small" aria-label="Next page" :disabled="p.page.value >= p.pages.value - 1" @click="p.go(p.page.value + 1)"><HkIcon name="chevronRight" :size="18" /></v-btn>
    <v-btn icon variant="text" size="small" aria-label="Last page" :disabled="p.page.value >= p.pages.value - 1" @click="p.go(p.pages.value - 1)"><HkIcon name="chevronLast" :size="18" /></v-btn>
  </nav>
</template>

<style scoped>
.hk-pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 2px;
}
.hk-pager__pos {
  margin-right: auto;
  font-variant-numeric: tabular-nums;
}
.hk-pager__page {
  min-width: 56px;
  text-align: center;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
</style>
