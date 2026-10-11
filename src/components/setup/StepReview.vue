<script setup lang="ts">
import { computed } from 'vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import type { IconName } from '@/components/icons/registry'
import type { SetupState, StepId } from '@/composables/setup'
import { countryByIso } from '@/utils/countries'
import { driveTitle } from '@/utils/drive'

// Everything that will change, in plain words, with a way back to each step.
const props = defineProps<{ s: SetupState }>()
const emit = defineEmits<{ go: [step: StepId] }>()

const PROTO: Record<string, string> = { dhcp: 'Automatic (DHCP)', pppoe: 'PPPoE', static: 'Static IP' }
const APN: Record<string, string> = { auto: 'Automatic APN', list: 'Carrier APN', custom: 'Custom APN' }
const PDP: Record<string, string> = { v4only: 'IPv4', dual: 'IPv4 + IPv6', split: 'IPv4 + IPv6 (two calls)', v6only: 'IPv6' }

interface Row {
  icon: IconName
  title: string
  value: string
  changed: boolean
  step: StepId
}

const rows = computed<Row[]>(() => {
  const s = props.s
  const c = s.changes.value
  const d = s.draft
  const r: Row[] = [
    { icon: 'lock', title: 'Admin password', value: c.password ? 'A new password' : 'Unchanged', changed: c.password, step: 'password' },
    {
      icon: 'system',
      title: 'Name, country and time',
      value: `${d.system.hostname} · ${countryByIso(d.system.country)?.name ?? d.system.country} · ${d.system.zonename}`,
      changed: c.system || c.country,
      step: 'system',
    },
  ]
  const standalone = s.hasUsage.value && d.usage === 'standalone'
  if (s.hasUsage.value)
    r.push({ icon: 'internet', title: 'Internet', value: standalone ? '5G router: the SIM is the internet' : 'Wired, with 5G as backup', changed: c.usage, step: 'internet' })
  if (standalone && s.orig.wanPort)
    r.push({
      icon: 'ethernet',
      title: 'WAN port',
      value: d.wanAsLan ? 'Used as a LAN port' : 'Not used',
      changed: c.lanPort,
      step: 'internet',
    })
  if (!standalone)
    r.push({
      icon: 'ethernet',
      title: 'Cable internet',
      value: `${PROTO[d.wan.proto] ?? d.wan.proto}${d.wan.proto === 'pppoe' ? ` as ${d.wan.username}` : d.wan.proto === 'static' ? ` ${d.wan.ipaddr}` : ''} · ${d.wan.ipv6 ? 'IPv4 + IPv6' : 'IPv4'}${s.orig.wanMac ? ` · ${s.macNext.value ? `MAC ${s.macNext.value}` : 'its own MAC'}` : ''}`,
      changed: c.wan || c.mac,
      step: 'internet',
    })
  if (s.hasModem.value) {
    const row = s.carriers.value.find((x) => x.id === d.apn.carrier)
    r.push({
      icon: 'cellular',
      title: '5G',
      value: `${d.apn.mode === 'list' && row ? `${row.name} (${row.apn})` : d.apn.mode === 'custom' ? `APN ${d.apn.apn}` : APN.auto!}${s.orig.ipv6 ? ` · ${PDP[d.v6style] ?? d.v6style}` : ''}`,
      changed: c.apn || c.ipv6,
      step: 'internet',
    })
  }
  const names = [...new Set(s.wifiNext.value.map((b) => b.ssid))]
  r.push({
    icon: 'wifi',
    title: 'Wi-Fi',
    value: `${names.join(' · ') || '—'}${c.country ? ` · channels for ${countryByIso(d.system.country)?.name ?? d.system.country}` : ''}`,
    changed: c.wifi || c.country,
    step: 'wifi',
  })
  const sd = d.storage
  const o = s.offer.value
  if (s.offers.value.length || c.storage) {
    const what = [sd.monitoring && s.orig.monStorage && 'monitoring', sd.usage && s.orig.usage?.persist && 'data usage', sd.speedtest && s.orig.speed && 'speed tests']
      .filter(Boolean)
      .join(', ')
    r.push({
      icon: 'storage',
      title: 'Storage',
      value:
        sd.use && o
          ? `${sd.format ? 'Erase and format ' : ''}${driveTitle(o.disk)}: ${what || 'nothing'}` +
            (s.storageChanges.value.wipe ? ' · deleting its old history' : s.oldHistory.value && sd.monitoring ? ' · carrying on with its history' : '')
          : 'No drive used',
      changed: c.storage,
      step: 'storage',
    })
  }
  return r
})
const anything = computed(() => Object.values(props.s.changes.value).some(Boolean))
</script>

<template>
  <div class="hk-review">
    <div v-for="r in rows" :key="r.title" class="hk-review__row">
      <span class="hk-review__icon" :class="{ on: r.changed }"><HkIcon :name="r.icon" :size="20" /></span>
      <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
        <span class="font-weight-bold" style="font-size: 14px">{{ r.title }}</span>
        <span class="hk-label" style="overflow-wrap: anywhere">{{ r.value }}</span>
      </div>
      <span class="hk-chip" :class="r.changed ? 'hk-chip--tonal' : 'hk-chip--outline'">{{ r.changed ? 'Will change' : 'As is' }}</span>
      <v-btn variant="text" color="primary" size="small" @click="emit('go', r.step)">Edit</v-btn>
    </div>
  </div>
  <v-alert v-if="s.changes.value.wifi" type="info" variant="tonal" density="comfortable">
    Wi-Fi restarts last. If you’re on Wi-Fi, you’ll be disconnected and can rejoin with the new details shown on the next screen.
  </v-alert>
  <p v-if="!anything" class="text-muted" style="font-size: 14px; margin: 0">Nothing to change. Finish to mark setup as done.</p>
</template>

<style scoped>
.hk-review {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hk-review__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 8px 10px 14px;
  background: rgb(var(--v-theme-surface-container-low));
  border-radius: 4px;
}
.hk-review__row:first-child {
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
}
.hk-review__row:last-child {
  border-bottom-left-radius: 20px;
  border-bottom-right-radius: 20px;
}
.hk-review__icon {
  width: 40px;
  height: 40px;
  border-radius: 20px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: rgb(var(--v-theme-surface-container-highest));
  color: rgb(var(--v-theme-on-surface-muted));
}
.hk-review__icon.on {
  background: rgb(var(--v-theme-primary-container));
  color: rgb(var(--v-theme-on-primary-container));
}
@media (max-width: 599.98px) {
  .hk-review__row .hk-chip {
    display: none;
  }
}
</style>
