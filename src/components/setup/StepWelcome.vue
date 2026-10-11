<script setup lang="ts">
import AppearanceSettings from '@/components/AppearanceSettings.vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import type { IconName } from '@/components/icons/registry'
import type { SetupState } from '@/composables/setup'

defineProps<{ s: SetupState }>()

const COVER: { icon: IconName; text: string }[] = [
  { icon: 'lock', text: 'An admin password' },
  { icon: 'system', text: 'The router’s name and time zone' },
  { icon: 'internet', text: 'Your internet: cable, 5G, or both' },
  { icon: 'wifi', text: 'Your Wi-Fi name and password' },
  { icon: 'storage', text: 'A USB drive for the router’s history' },
  { icon: 'check', text: 'A last look before anything changes' },
]
</script>

<template>
  <ul class="hk-cover">
    <li v-for="c in COVER" :key="c.text">
      <span class="hk-cover__icon"><HkIcon :name="c.icon" :size="20" /></span>
      {{ c.text }}
    </li>
  </ul>
  <div class="hk-welcome-look">
    <div class="hk-h2" style="font-size: 16px">Make it yours</div>
    <p class="hk-label" style="margin: 0 0 12px">Pick a colour; the whole interface follows it. You can change it any time.</p>
    <AppearanceSettings colors-only />
  </div>
</template>

<style scoped>
.hk-cover {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
@media (max-width: 599.98px) {
  .hk-cover {
    grid-template-columns: minmax(0, 1fr);
  }
}
.hk-cover li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface-container-low));
  font-size: 14px;
}
.hk-cover__icon {
  width: 36px;
  height: 36px;
  border-radius: 18px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: rgb(var(--v-theme-primary-container));
  color: rgb(var(--v-theme-on-primary-container));
}
.hk-welcome-look {
  padding: 16px;
  border-radius: 20px;
  background: rgb(var(--v-theme-surface-container-low));
}
</style>
