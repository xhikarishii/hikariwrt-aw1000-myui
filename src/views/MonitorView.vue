<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import SignalTab from '@/components/monitor/tabs/SignalTab.vue'
import SitesTab from '@/components/monitor/tabs/SitesTab.vue'
import StorageTab from '@/components/monitor/tabs/StorageTab.vue'
import UptimeTab from '@/components/monitor/tabs/UptimeTab.vue'
import * as monitor from '@/api/monitor'
import { luciUrl } from '@/nav'
import '@/styles/monitor.css'

// Monitoring, in the tabs LuCI's Monitoring menu has: Uptime (per WAN),
// Sites (how fast websites answer over each WAN), Signal (the 5G modem's,
// when the modem package is installed) and Storage (where each history is
// kept). Each tab's Settings button opens its LuCI
// page, where those settings live.
const route = useRoute()
const router = useRouter()

// null until asked: a link straight to ?tab=signal shouldn't bounce to Uptime
// while the router is still answering.
const hasModem = ref<boolean | null>(null)
onMounted(async () => {
  hasModem.value = !!(await monitor.sigstatus().catch(() => null))?.modem
})

const TABS = computed(() => [
  { id: 'uptime', title: 'Uptime', luci: 'admin/monitoring/uptime', overline: 'Uptime, latency, loss and traffic per WAN' },
  { id: 'sites', title: 'Sites', luci: 'admin/monitoring/sites', overline: 'How fast websites answer over each WAN' },
  ...(hasModem.value !== false ? [{ id: 'signal', title: 'Signal', luci: 'admin/monitoring/signal', overline: 'The 5G modem’s signal over time' }] : []),
  { id: 'storage', title: 'Storage', luci: 'admin/monitoring/storage', overline: 'Where the monitoring history is kept' },
])

const tab = computed(() => TABS.value.find((t) => t.id === route.query.tab) ?? TABS.value[0]!)
watch(
  () => tab.value.id,
  () => nextTick(() => document.querySelector('.hk-tab.is-on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })),
  { immediate: true },
)
function pick(id: string): void {
  router.replace({ query: id === 'uptime' ? {} : { tab: id } })
}
</script>

<template>
  <PageHeader :overline="tab.overline" title="Monitoring">
    <template #actions>
      <v-btn :href="luciUrl(tab.luci)" variant="flat" color="secondary-container" height="48" rounded="pill">
        <HkIcon name="system" :size="18" class="mr-2" />Settings
      </v-btn>
    </template>
  </PageHeader>

  <div role="tablist" aria-label="Monitoring sections" class="hk-tabs">
    <button
      v-for="t in TABS"
      :key="t.id"
      type="button"
      role="tab"
      class="hk-tab"
      :class="{ 'is-on': tab.id === t.id }"
      :aria-selected="tab.id === t.id ? 'true' : 'false'"
      @click="pick(t.id)"
    >
      <span>{{ t.title }}</span>
    </button>
  </div>

  <UptimeTab v-if="tab.id === 'uptime'" />
  <SitesTab v-else-if="tab.id === 'sites'" />
  <SignalTab v-else-if="tab.id === 'signal'" />
  <StorageTab v-else-if="tab.id === 'storage'" :signal="hasModem !== false" />
</template>
