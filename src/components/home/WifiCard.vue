<script setup lang="ts">
import { computed } from 'vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import M3Switch from '@/components/m3/M3Switch.vue'
import type { WirelessRadio } from '@/api/router'
import { setWifiAp, type MeshStatus, type WifiAp } from '@/api/services'
import { useAction } from '@/composables/action'
import { useConfirm } from '@/composables/confirm'

// One row per band with its SSID and an on/off switch, then the mesh
// backhaul. Wi-Fi switches apply with rollback (see setWifiAp). The mesh row
// links to the Mesh page instead of switching: mesh "off" is a role change
// in aw1000-mesh, and turning it back on means re-running its setup.
const props = defineProps<{
  aps: WifiAp[] | null
  radios: Record<string, WirelessRadio> | null
  mesh: MeshStatus | null
}>()
const emit = defineEmits<{ changed: [] }>()
const { busy, run } = useAction()
const { ask } = useConfirm()

const BAND: Record<string, string> = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz' }
const ORDER: Record<string, number> = { '6g': 0, '5g': 1, '2g': 2 }

const rows = computed(() =>
  (props.aps ?? [])
    .filter((a) => a.main)
    .sort((a, b) => (ORDER[a.band] ?? 9) - (ORDER[b.band] ?? 9))
    .map((a) => ({
      ...a,
      title: BAND[a.band] ?? a.band,
      channel: props.radios?.[a.radio]?.config.channel ?? '—',
    })),
)

async function toggle(ap: WifiAp & { title: string }, on: boolean): Promise<void> {
  if (!on) {
    const ok = await ask({
      title: `Turn off ${ap.title} Wi-Fi?`,
      text: `Devices on "${ap.ssid}" will disconnect.\n\nIf this browser is connected over it, the router can't hear back from you and puts it back on after 30 seconds.`,
      confirm: 'Turn off',
    })
    if (!ok) return
  }
  const done = await run(ap.section, () => setWifiAp(ap.section, on), `${ap.title} Wi-Fi turned ${on ? 'on' : 'off'}`)
  if (done) emit('changed')
}

const meshLine = computed(() => {
  const m = props.mesh
  if (!m) return ''
  const band = m.config.band === '5g' ? '5 GHz' : m.config.band === '2g' ? '2.4 GHz' : m.config.band
  return `802.11s over ${band}${m.offload?.nss_offload ? ' · NSS offloaded' : ''}`
})
const meshOn = computed(() => !!props.mesh && props.mesh.config.applied_role !== 'off' && props.mesh.live.present)
</script>

<template>
  <section class="hk-card" aria-label="Wi-Fi" style="padding-bottom: 12px; gap: 4px">
    <h2 class="hk-h2" style="margin-bottom: 6px">Wi-Fi</h2>
    <template v-if="aps">
      <template v-for="(r, i) in rows" :key="r.section">
        <div v-if="i > 0" class="hk-divider" />
        <div class="hk-row">
          <div class="hk-row__text">
            <span class="hk-row__title">{{ r.title }}</span>
            <span class="hk-row__sub">{{ r.ssid }} · channel {{ r.channel }}</span>
          </div>
          <M3Switch :model-value="!r.disabled" :label="`${r.title} Wi-Fi`" :busy="busy[r.section]" @update:model-value="toggle(r, $event)" />
        </div>
      </template>
      <template v-if="mesh">
        <div class="hk-divider" />
        <router-link to="/mesh" class="hk-row hk-row--link">
          <div class="hk-row__text">
            <span class="hk-row__title">Mesh backhaul</span>
            <span class="hk-row__sub">{{ meshLine }}</span>
          </div>
          <span class="hk-chip" :class="meshOn && mesh.live.peers_estab ? 'hk-chip--tonal' : 'hk-chip--outline'">
            <HkIcon v-if="meshOn && mesh.live.peers_estab" name="check" :size="14" />{{ !meshOn ? 'Off' : mesh.live.peers_estab ? `${mesh.live.peers_estab} ${mesh.live.peers_estab === 1 ? 'node' : 'nodes'}` : 'No nodes yet' }}
          </span>
          <HkIcon name="arrowRight" :size="18" class="text-muted" />
        </router-link>
      </template>
    </template>
    <v-skeleton-loader v-else type="list-item-two-line, list-item-two-line" bg-color="transparent" />
  </section>
</template>

<style scoped>
.hk-row {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 60px;
  color: inherit;
  text-decoration: none;
}
.hk-row--link {
  gap: 10px;
  margin: 0 -12px;
  padding: 0 12px;
  border-radius: 16px;
}
.hk-row--link:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.hk-row__text {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-width: 0;
}
.hk-row__title {
  font-weight: 600;
  font-size: 15px;
}
.hk-row__sub {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-muted));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hk-divider {
  height: 1px;
  background: rgb(var(--v-theme-outline-variant));
}
</style>
