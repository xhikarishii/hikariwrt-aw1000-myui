<script setup lang="ts">
import { computed } from 'vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import M3Switch from '@/components/m3/M3Switch.vue'
import NetworkForm from '@/components/networks/NetworkForm.vue'
import type { SetupState } from '@/composables/setup'
import { KIND_INFO } from '@/utils/networks'

// More networks: a guest network and a smart-home (IoT) network, each
// optional, each kept apart from Home. Switching one on shows its settings,
// already filled in for what it is for; the IoT one with the settings cheap
// smart-home Wi-Fi connects best with. Anything else - more networks, VLANs
// for a switch - is on the Networks page afterwards.
const props = defineProps<{ s: SetupState }>()
const n = computed(() => props.s.draft.networks)
const data = computed(() => props.s.orig.networks)
const existing = (kind: string) => data.value?.model.networks.find((x) => x.kind === kind) ?? null

const CARDS = [
  { key: 'guest' as const, kind: 'guest', icon: 'guest' as const, title: 'Guest network', text: KIND_INFO.guest.text },
  {
    key: 'iot' as const,
    kind: 'iot',
    icon: 'iot' as const,
    title: 'Smart-home network',
    text: 'For cameras, plugs, speakers and sensors: kept apart from your computers and phones, so a weak device can’t become a way in, and tuned for how cheap Wi-Fi chips connect.',
  },
]
</script>

<template>
  <v-alert v-if="!data" type="warning" variant="tonal" density="compact">The router’s network settings couldn’t be read. Skip this step; the Networks page can add these later.</v-alert>

  <template v-else>
    <div v-for="c in CARDS" :key="c.key" class="hk-sn">
      <div class="d-flex align-center ga-3">
        <span class="hk-sn__icon"><HkIcon :name="c.icon" /></span>
        <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
          <span class="hk-h2" style="font-size: 18px">{{ c.title }}</span>
          <span class="hk-label">{{ c.text }}</span>
        </div>
        <M3Switch v-if="n[c.key].spec" v-model="n[c.key].on" :label="c.title" />
        <span v-else class="hk-chip hk-chip--tonal">Already set up</span>
      </div>
      <p v-if="!n[c.key].spec && existing(c.kind)" class="hk-label" style="margin: 0">
        “{{ existing(c.kind)!.label }}” ({{ existing(c.kind)!.prefix }}.0/24) is already on the router. Change it on the Networks page.
      </p>
      <NetworkForm v-if="n[c.key].on && n[c.key].spec" v-model="n[c.key].spec!" :errors="s.networkErrors.value[c.key]" :radios="data.radios" :model="data.model" compact fresh />
    </div>
    <p class="hk-label" style="margin: 0 4px">More networks, and VLANs for a managed switch or access point, can be added any time on the Networks page.</p>
  </template>
</template>

<style scoped>
.hk-sn {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border-radius: 20px;
  background: rgb(var(--v-theme-surface-container-low));
}
.hk-sn__icon {
  width: 44px;
  height: 44px;
  border-radius: 22px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}
</style>
