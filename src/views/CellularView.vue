<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import BandLockCard from '@/components/cellular/BandLockCard.vue'
import DataCard from '@/components/cellular/DataCard.vue'
import MessagesCard from '@/components/cellular/MessagesCard.vue'
import SignalCard from '@/components/cellular/SignalCard.vue'
import SimCard from '@/components/cellular/SimCard.vue'
import ApnTab from '@/components/cellular/tabs/ApnTab.vue'
import AtTab from '@/components/cellular/tabs/AtTab.vue'
import LockTab from '@/components/cellular/tabs/LockTab.vue'
import SmsTab from '@/components/cellular/tabs/SmsTab.vue'
import UsageTab from '@/components/cellular/tabs/UsageTab.vue'
import * as modem from '@/api/modem'
import { reconnect } from '@/api/services'
import { usePoll } from '@/composables/poll'
import { useAction } from '@/composables/action'
import { useConfirm } from '@/composables/confirm'
import { shortRevision, homePlmn } from '@/utils/cellular'

// Cellular, as on the design canvas. Loading follows the AT-port rule:
//   polled every 5 s:       status (cached by aw1000-modem-info)
//   on open and Refresh:    diag, SMS list (they send AT commands)
//   on open / after Apply:  lock info, profile, usage (cheap, rarely change)

const route = useRoute()
const router = useRouter()
const { busy, run } = useAction()
const { ask } = useConfirm()

const TABS = [
  { id: 'overview', title: 'Overview' },
  { id: 'lock', title: 'Band & cell lock' },
  { id: 'sms', title: 'SMS' },
  { id: 'apn', title: 'APN & IPv6' },
  { id: 'usage', title: 'Data usage' },
  { id: 'at', title: 'AT console' },
] as const

const tab = computed(() => TABS.find((t) => t.id === route.query.tab) ?? TABS[0])
// On narrow screens the tab row scrolls; keep the chosen tab in view.
watch(
  () => tab.value.id,
  () => nextTick(() => document.querySelector('.hk-tab.is-on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })),
  { immediate: true },
)
function pick(id: string): void {
  router.replace({ query: id === 'overview' ? {} : { tab: id } })
}

const status = usePoll(() => modem.status(), 5000)
const diag = ref<modem.ModemDiag | null>(null)
const sms = ref<modem.SmsList | null>(null)
const lock = ref<modem.LockInfo | null>(null)
const profile = ref<modem.ProfileInfo | null>(null)
const usage = ref<modem.UsageInfo | null>(null)
const smsLoading = ref(true)

async function loadModemSide(): Promise<void> {
  smsLoading.value = true
  const [d, m] = await Promise.all([modem.diag().catch(() => null), modem.smslist().catch(() => null)])
  diag.value = d
  sms.value = m
  smsLoading.value = false
}
async function loadSettings(): Promise<void> {
  const [l, p, u] = await Promise.all([
    modem.lockinfo().catch(() => null),
    modem.profileinfo().catch(() => null),
    modem.usageinfo().catch(() => null),
  ])
  lock.value = l
  profile.value = p
  usage.value = u
}

onMounted(() => {
  loadModemSide()
  loadSettings()
})

// Lock writes answer with a fresh lockinfo; use it, or re-read.
function onLockState(state?: modem.LockInfo): void {
  if (state?.ok) lock.value = state
  else modem.lockinfo().then((l) => (lock.value = l), () => undefined)
}

const overline = computed(() => {
  const m = diag.value?.module
  return m ? `Quectel ${m.model} · firmware ${shortRevision(m.revision)}` : 'Modem'
})

async function refresh(): Promise<void> {
  await run('refresh', async () => {
    status.data.value = await modem.refresh()
    await loadModemSide()
  })
}

async function doReconnect(): Promise<void> {
  const iface = status.data.value?.link?.interface || 'wwan0'
  const ok = await ask({
    title: 'Reconnect 5G?',
    text: 'The cellular connection drops and dials again, which takes about half a minute. If 5G is the uplink in use, the internet pauses meanwhile.',
    confirm: 'Reconnect',
  })
  if (!ok) return
  await run('reconnect', () => reconnect(iface), 'Reconnecting 5G…')
  setTimeout(() => status.refresh(), 5000)
}
</script>

<template>
  <PageHeader :overline="overline" title="Cellular">
    <template #actions>
      <v-btn variant="flat" color="secondary-container" height="48" rounded="pill" :loading="busy.refresh" @click="refresh">
        <HkIcon name="refresh" :size="18" class="mr-2" />Refresh
      </v-btn>
      <v-btn variant="flat" color="primary" height="48" rounded="pill" :loading="busy.reconnect" @click="doReconnect">Reconnect</v-btn>
    </template>
  </PageHeader>

  <div role="tablist" aria-label="Cellular sections" class="hk-tabs">
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

  <v-alert v-if="status.error.value" type="error" variant="tonal" rounded="xl">
    Can't read the modem: {{ status.error.value instanceof Error ? status.error.value.message : status.error.value }}
  </v-alert>

  <div v-if="tab.id === 'overview'" class="hk-cell-grid">
    <div class="hk-cell-main">
      <SignalCard :modem="status.data.value" :diag="diag" :lock="lock" :profile="profile" />
      <BandLockCard :lock="lock" @applied="loadSettings" />
    </div>
    <div class="hk-cell-side">
      <SimCard :modem="status.data.value" />
      <DataCard :usage="usage" />
      <MessagesCard :sms="sms" :loading="smsLoading" />
    </div>
  </div>

  <LockTab v-else-if="tab.id === 'lock'" :lock="lock" :home="homePlmn(status.data.value?.mcc, status.data.value?.mnc)" @state="onLockState" />
  <SmsTab v-else-if="tab.id === 'sms'" />
  <ApnTab v-else-if="tab.id === 'apn'" />
  <UsageTab v-else-if="tab.id === 'usage'" />
  <AtTab v-else-if="tab.id === 'at'" />
</template>

<style scoped>
.hk-cell-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  padding-top: 4px;
}
.hk-cell-main {
  grid-column: span 2;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.hk-cell-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
@media (max-width: 1279.98px) {
  .hk-cell-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .hk-cell-main {
    grid-column: auto;
  }
}
</style>
