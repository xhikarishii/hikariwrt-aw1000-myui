<script setup lang="ts">
import { computed } from 'vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import M3Switch from '@/components/m3/M3Switch.vue'
import type { SetupState } from '@/composables/setup'
import { usePoll } from '@/composables/poll'
import { bytes } from '@/utils/format'
import { driveTitle, needsFormat, type DriveOffer } from '@/utils/drive'

// A USB drive or SD card for the history the router keeps: monitoring (uptime,
// sites, signal, client traffic), 5G data usage and speed test results. The
// drives are looked for while this step is open, so one plugged in now shows
// up. A drive that is ready (or only needs mounting) is offered switched on;
// formatting one is never chosen for you.
const props = defineProps<{ s: SetupState }>()
const d = computed(() => props.s.draft.storage)
const offers = computed(() => props.s.offers.value)
const offer = computed(() => props.s.offer.value)

usePoll(() => props.s.refreshDrives(), 3000)

const STATE: Record<string, string> = {
  ready: 'Ready',
  unmounted: 'Not mounted',
  blank: 'Not formatted',
  unsupported: 'Needs formatting',
  router: 'Router storage',
}

function line(o: DriveOffer): string {
  const p = o.part
  if (o.state === 'router') return 'The router already runs from this drive, so its own storage is this drive.'
  if (o.state === 'blank') return 'It has no filesystem the router can use.'
  if (o.state === 'unsupported') return `${p?.fs ?? 'Its filesystem'} isn’t one the router can write to.`
  if (!p) return ''
  const free = p.free_kb != null ? ` · ${bytes(p.free_kb * 1024)} free` : ''
  return o.state === 'ready' ? `${p.name} · ${p.fs}${free} · at ${p.mountpoint}` : `${p.name} · ${p.fs} · would be mounted at ${o.target}`
}

function pick(o: DriveOffer): void {
  d.value.disk = o.disk.name
  d.value.format = false
  d.value.use = true
  d.value.touched = true
}
const touch = () => (d.value.touched = true)

// Monitoring history an earlier setup left on the chosen drive.
const old = computed(() => props.s.oldHistory.value)
const day = (t: number | null) => (t ? new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '?')
const oldSize = computed(() => {
  const kb = old.value?.kb ?? 0
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} kB`
})

// What already lives where, for the "already here" notes - none of which
// holds once the drive is formatted.
const target = computed(() => props.s.storageTarget.value)
const here = computed(() => {
  const o = props.s.orig
  if (d.value.format) return { monitoring: false, usage: false, speedtest: false }
  return {
    monitoring: !!o.monStorage?.persist.enabled && o.monStorage.persist.target === target.value,
    usage: !!o.usage?.persist && o.usage.persist.target === target.value,
    speedtest: !!o.speed?.persist?.enabled && o.speed.persist.target === target.value,
  }
})
const used = computed(() => {
  const o = offer.value
  if (!o) return ''
  const parts = o.disk.partitions ?? []
  if (!parts.length) return ''
  const u = parts.reduce((a, p) => a + (p.used_kb ?? 0), 0)
  return `${parts.length} partition${parts.length === 1 ? '' : 's'}${u ? `, ${bytes(u * 1024)} in use` : ''}`
})
// history the router already keeps on this very drive goes with the format
const onIt = computed(() => {
  const o = props.s.orig
  const mps = (offer.value?.disk.partitions ?? []).map((p) => p.mountpoint).filter(Boolean)
  return (
    (!!o.monStorage?.persist.enabled && mps.includes(o.monStorage.persist.target)) ||
    (!!o.usage?.persist && mps.includes(o.usage.persist.target)) ||
    (!!o.speed?.persist?.enabled && mps.includes(o.speed.persist.target))
  )
})
</script>

<template>
  <!-- No drive yet: say so, and keep looking -->
  <div v-if="!offers.length" class="hk-sec hk-empty">
    <span class="hk-sec__icon"><HkIcon name="storage" /></span>
    <div class="d-flex flex-column ga-1">
      <span class="hk-h2" style="font-size: 18px">No drive plugged in</span>
      <span class="hk-label">
        Plug a USB drive or SD card into the router and it shows up here. With one, the router keeps its monitoring, data usage and speed test history for
        months, and across reboots and firmware upgrades. Without one, that history stays in memory and is forgotten on reboot.
      </span>
      <span class="hk-label d-flex align-center ga-2 mt-1"><v-progress-circular indeterminate size="14" width="2" />Looking for a drive…</span>
    </div>
  </div>

  <template v-else>
    <div class="hk-sec">
      <div class="d-flex align-center ga-3">
        <span class="hk-sec__icon"><HkIcon name="storage" /></span>
        <div class="d-flex flex-column flex-grow-1">
          <span class="hk-h2" style="font-size: 18px">{{ offers.length === 1 ? 'A drive is plugged in' : `${offers.length} drives are plugged in` }}</span>
          <span class="hk-label">Keep the router’s history on it, so it lasts across reboots and upgrades.</span>
        </div>
        <M3Switch v-model="d.use" label="Use a drive for history" @update:model-value="touch" />
      </div>

      <div v-if="d.use" class="d-flex flex-column ga-2" role="radiogroup" aria-label="Drive">
        <button
          v-for="o in offers"
          :key="o.disk.name"
          type="button"
          role="radio"
          class="hk-drive"
          :class="{ 'is-on': d.disk === o.disk.name }"
          :aria-checked="d.disk === o.disk.name"
          @click="pick(o)"
        >
          <span class="d-flex flex-column flex-grow-1" style="min-width: 0">
            <span class="font-weight-bold" style="font-size: 15px">{{ driveTitle(o.disk) }}</span>
            <span class="hk-label">{{ line(o) }}</span>
          </span>
          <span class="hk-chip" :class="needsFormat(o) ? 'hk-chip--outline' : 'hk-chip--tonal'">{{ STATE[o.state] }}</span>
        </button>
      </div>
    </div>

    <template v-if="d.use && offer">
      <!-- Formatting: only ever on purpose -->
      <div v-if="needsFormat(offer)" class="hk-sec">
        <div class="d-flex align-center ga-3">
          <div class="d-flex flex-column flex-grow-1">
            <span style="font-size: 15px; font-weight: 600">Erase and format it</span>
            <span class="hk-label">As ext4, the filesystem the router reads and writes best.</span>
          </div>
          <M3Switch v-model="d.format" label="Erase and format the drive" @update:model-value="touch" />
        </div>
        <v-alert v-if="d.format" type="warning" variant="tonal" density="compact">
          Everything on {{ offer.disk.name }} ({{ driveTitle(offer.disk) }}{{ used ? `; ${used}` : '' }}) is erased when you finish setup. This can’t be undone.
          <template v-if="onIt"> The history the router keeps on it now goes too; it writes what it still has in memory back at the next save.</template>
        </v-alert>
        <span v-else class="hk-label">The drive can’t be used without formatting. Or skip this step, and set it up later on the Storage page.</span>
      </div>
      <p v-else-if="offer.state === 'unmounted'" class="hk-label" style="margin: 0 4px">
        It’s mounted at {{ offer.target }} when you finish, and from then on whenever it’s plugged in.
      </p>

      <!-- History an earlier setup left on it -->
      <div v-if="old && d.monitoring" class="hk-sec">
        <div class="d-flex align-center ga-3">
          <span class="hk-sec__icon"><HkIcon name="chart" /></span>
          <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
            <span style="font-size: 15px; font-weight: 600">This drive already has monitoring history</span>
            <span class="hk-label">{{ old.histories.join(', ') }} · {{ day(old.oldest) }} to {{ day(old.newest) }} · {{ oldSize }}</span>
          </div>
        </div>
        <div class="d-flex flex-column ga-2" role="radiogroup" aria-label="The history already on the drive">
          <button
            type="button"
            role="radio"
            class="hk-drive"
            :class="{ 'is-on': d.old === 'keep' }"
            :aria-checked="d.old === 'keep'"
            @click="(d.old = 'keep'), touch()"
          >
            <span class="d-flex flex-column flex-grow-1">
              <span class="font-weight-bold" style="font-size: 15px">Carry on with it</span>
              <span class="hk-label">Its earlier months stay, and what the router has recorded since joins them.</span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            class="hk-drive"
            :class="{ 'is-on': d.old === 'fresh' }"
            :aria-checked="d.old === 'fresh'"
            @click="(d.old = 'fresh'), touch()"
          >
            <span class="d-flex flex-column flex-grow-1">
              <span class="font-weight-bold" style="font-size: 15px">Start fresh</span>
              <span class="hk-label">Delete it, and keep only what this router has recorded. Its own history isn’t touched.</span>
            </span>
          </button>
        </div>
        <span v-if="d.old === 'keep'" class="hk-label">Pick this when it’s from this router before a reset or a firmware upgrade. From another router, its WAN and site history won’t match this one’s.</span>
      </div>

      <!-- What goes on it -->
      <div class="hk-sec">
        <span style="font-size: 15px; font-weight: 600">Keep on it</span>
        <div v-if="s.orig.monStorage" class="hk-what">
          <div class="d-flex flex-column flex-grow-1">
            <span style="font-size: 14px">Monitoring history</span>
            <span class="hk-label">Uptime, website checks, 5G signal and each device’s traffic{{ here.monitoring ? ' · already here' : '' }}</span>
          </div>
          <M3Switch v-model="d.monitoring" label="Monitoring history" @update:model-value="touch" />
        </div>
        <div v-if="s.orig.usage?.persist" class="hk-what">
          <div class="d-flex flex-column flex-grow-1">
            <span style="font-size: 14px">5G data usage</span>
            <span class="hk-label">The daily counts behind the allowance{{ here.usage ? ' · already here' : '' }}</span>
          </div>
          <M3Switch v-model="d.usage" label="5G data usage" @update:model-value="touch" />
        </div>
        <div v-if="s.orig.speed" class="hk-what">
          <div class="d-flex flex-column flex-grow-1">
            <span style="font-size: 14px">Speed test results</span>
            <span class="hk-label">The results list and their share cards{{ here.speedtest ? ' · already here' : '' }}</span>
          </div>
          <M3Switch v-model="d.speedtest" label="Speed test results" @update:model-value="touch" />
        </div>
        <span class="hk-label">
          History already kept elsewhere moves to the drive. How often it’s saved and for how long can be changed later under Monitoring → Storage.
        </span>
      </div>
    </template>
  </template>
</template>

<style scoped>
.hk-sec {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  border-radius: 20px;
  background: rgb(var(--v-theme-surface-container-low));
}
.hk-empty {
  flex-direction: row;
  align-items: flex-start;
  gap: 14px;
}
.hk-sec__icon {
  width: 44px;
  height: 44px;
  border-radius: 22px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}
.hk-drive {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 2px solid rgb(var(--v-theme-outline-variant));
  border-radius: 16px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.hk-drive.is-on {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}
.hk-drive.is-on .hk-label {
  color: inherit;
  opacity: 0.85;
}
.hk-drive:focus-visible {
  outline: 3px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}
.hk-what {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
