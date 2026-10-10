<script setup lang="ts">
import { computed, ref } from 'vue'
import { bucketTime } from '@/utils/series'
import { MODE_NAME, db, dbm, type ModeBar } from '@/utils/signal'

// The network mode over a period, drawn like the uptime bar: one segment
// per bucket (5G SA, 5G NSA, LTE, no service, no data), with a tooltip of
// the bands and readings in the segment under the pointer (or finger).
const props = defineProps<{ bar: ModeBar; from: number; label: string }>()

const hover = ref<number | null>(null)
const row = ref<HTMLElement | null>(null)
const left = ref(0)

function onMove(e: PointerEvent): void {
  const seg = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')
  if (!seg || !row.value) {
    hover.value = null
    return
  }
  hover.value = Number(seg.dataset.i)
  const r = row.value.getBoundingClientRect()
  const s = seg.getBoundingClientRect()
  left.value = Math.max(0, Math.min(s.left - r.left + s.width / 2 - 95, r.width - 190))
}

const tip = computed(() => {
  const i = hover.value
  if (i == null) return null
  const b = props.bar
  const st = b.state[i]!
  const rows: [string, string][] = []
  if (st) {
    if (b.lband[i]) rows.push(['LTE band', b.lband[i]!])
    if (b.nband[i]) rows.push(['5G band', b.nband[i]!])
    if (b.lrsrp[i] != null) rows.push(['LTE RSRP', dbm(b.lrsrp[i])])
    if (b.lsinr[i] != null) rows.push(['LTE SINR', db(b.lsinr[i])])
    if (b.nrsrp[i] != null) rows.push(['5G RSRP', dbm(b.nrsrp[i])])
    if (b.nsinr[i] != null) rows.push(['5G SINR', db(b.nsinr[i])])
  }
  return { time: bucketTime(b.ts[i]!, b.step), st, name: MODE_NAME[st], rows }
})
</script>

<template>
  <div class="hk-mb">
    <div ref="row" class="hk-mb__row" role="img" :aria-label="label" @pointermove="onMove" @pointerdown="onMove" @pointerleave="hover = null">
      <div v-for="(s, i) in bar.state" :key="i" :data-i="i" class="hk-mb__seg" :class="[`is-${s}`, { 'is-hot': hover === i }]" />
    </div>
    <div class="hk-mb__ends hk-label">
      <span>{{ bar.ts.length ? bucketTime(from) : '' }}</span>
      <span>Now</span>
    </div>
    <div v-if="tip" class="hk-mb__tip" :style="{ left: `${left}px` }" role="status">
      <div class="hk-label">{{ tip.time }}</div>
      <div class="hk-mb__line"><span class="hk-mb__key" :class="`is-${tip.st}`" />{{ tip.name }}</div>
      <div v-for="r in tip.rows" :key="r[0]" class="hk-mb__line">{{ r[0] }} <b>{{ r[1] }}</b></div>
    </div>
  </div>
</template>

<style scoped>
.hk-mb {
  position: relative;
}
.hk-mb__row {
  display: flex;
  gap: 2px;
  height: 32px;
  touch-action: pan-y;
}
.hk-mb__seg {
  flex: 1 1 0;
  min-width: 1px;
  border-radius: 3px;
  background: rgb(var(--v-theme-surface-container-highest));
  transition: transform 0.1s;
}
.hk-mb__seg.is-1,
.hk-mb__key.is-1 {
  background: rgb(var(--v-theme-success));
}
.hk-mb__seg.is-2,
.hk-mb__key.is-2 {
  background: rgb(var(--v-theme-info));
}
.hk-mb__seg.is-3,
.hk-mb__key.is-3 {
  background: rgb(var(--v-theme-warning));
}
.hk-mb__seg.is-4,
.hk-mb__key.is-4 {
  background: rgb(var(--v-theme-error));
}
.hk-mb__seg.is-hot {
  transform: scaleY(1.15);
}
.hk-mb__ends {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
}
.hk-mb__tip {
  position: absolute;
  top: 40px;
  z-index: 2;
  width: 190px;
  pointer-events: none;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
  line-height: 18px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}
.hk-mb__tip .hk-label {
  color: inherit;
  opacity: 0.75;
}
.hk-mb__line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hk-mb__line b {
  margin-left: auto;
  font-weight: 600;
}
.hk-mb__key {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: rgb(var(--v-theme-surface-container-highest));
}
</style>
