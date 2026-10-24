<script setup lang="ts">
import { computed } from 'vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import ArcGauge from '@/components/m3/ArcGauge.vue'
import M3Progress from '@/components/m3/M3Progress.vue'
import type { LockInfo, ModemDiag, ModemStatus, ProfileInfo } from '@/api/modem'
import { bandDescription, gnbId, qualityHeadline, RANGES, scale } from '@/utils/cellular'
import { bitrate, signed } from '@/utils/format'

const props = defineProps<{ modem: ModemStatus | null; diag: ModemDiag | null; lock: LockInfo | null; profile: ProfileInfo | null }>()

const s = computed(() => props.modem?.signal ?? null)
const operator = computed(() => props.modem?.operator ?? '')
const pcc = computed(() => props.modem?.bands?.find((b) => b.role === 'PCC') ?? props.modem?.bands?.[0] ?? null)
const temp = computed(() => {
  const t = props.diag?.temperatures
  return t?.length ? Math.max(...t.map((x) => x.celsius)) : null
})
const locked = computed(() => {
  const c = props.lock?.cell_lock
  return !!(c && (c.nr?.pci != null || (c.lte?.count ?? 0) > 0))
})
const ims = computed(() => props.diag?.registration?.ims_reg === 1)
const nr = computed(() => s.value?.tech === 'NR')

const facts = computed(() => {
  const m = props.modem
  const ca = m?.ca
  const bands = m?.bands?.map((b) => b.band) ?? []
  return [
    { k: 'PCI', v: s.value?.pci ?? '—' },
    { k: nr.value ? 'NR-ARFCN' : 'EARFCN', v: s.value?.arfcn ?? '—' },
    { k: 'TAC', v: m?.tac ?? '—' },
    nr.value
      ? { k: 'gNB ID', v: gnbId(s.value?.cell_id, m?.gnb_id_bits) ?? '—' }
      : { k: 'Cell ID', v: s.value?.cell_id ?? '—' },
    { k: 'Carrier aggregation', v: ca && ca.total > 1 ? bands.join(' + ') : bands[0] ? `${bands[0]} only` : '—', strong: true },
    { k: 'IMS', v: props.diag ? (ims.value ? 'Registered' : 'Not registered') : '—', strong: true },
    { k: 'Data session', v: m?.link?.ipv4 ? `IPv4 · ${m.link.ipv4}` : m?.link?.up ? 'Up' : 'Down', strong: true },
    { k: 'APN', v: props.profile?.apn.value || '—' },
    // the network's ceiling on this data session, per direction
    { k: 'Max speed (AMBR)', v: m?.ambr ? `↓ ${bitrate(m.ambr.dl)} · ↑ ${bitrate(m.ambr.ul)}` : '—', strong: true },
  ]
})
</script>

<template>
  <section class="hk-card hk-signal" aria-label="Signal">
    <template v-if="modem && s">
      <div class="hk-signal__top">
        <ArcGauge :fraction="scale(s.rsrp, ...RANGES.rsrp)" label="RSRP">
          <span class="hk-display" style="font-size: 48px; letter-spacing: -1px">{{ signed(s.rsrp) }}</span>
          <span class="text-muted" style="font-size: 13px; font-weight: 600">dBm · RSRP</span>
        </ArcGauge>
        <div class="d-flex flex-column ga-3 flex-grow-1" style="min-width: 0">
          <span class="hk-display" style="font-size: 44px; line-height: 1.05; letter-spacing: -0.5px">{{ qualityHeadline(s.quality) }}</span>
          <span class="text-muted" style="font-size: 16px">
            {{ operator }} · {{ bandDescription(s.band) }}<template v-if="pcc?.bandwidth"> · {{ pcc.bandwidth }} MHz</template>
          </span>
          <div class="d-flex flex-wrap ga-2">
            <span v-if="modem.mode_label" class="hk-chip hk-chip--filled" style="height: 32px; font-size: 13px; padding: 0 14px">{{ modem.mode_label.replace('-', ' ') }}</span>
            <span v-if="locked" class="hk-chip hk-chip--tonal" style="height: 32px; font-size: 13px"><HkIcon name="lock" :size="16" />Cell locked</span>
            <span v-if="ims" class="hk-chip hk-chip--outline" style="height: 32px; font-size: 13px">IMS registered</span>
          </div>
        </div>
      </div>

      <div class="hk-signal__tiles">
        <div class="hk-tile">
          <span class="hk-label font-weight-bold">RSRP</span>
          <span class="hk-mv">{{ signed(s.rsrp) }} <small>dBm</small></span>
          <M3Progress :value="scale(s.rsrp, ...RANGES.rsrp) * 100" label="RSRP" :height="6" :stop="false" />
        </div>
        <div class="hk-tile">
          <span class="hk-label font-weight-bold">RSRQ</span>
          <span class="hk-mv">{{ signed(s.rsrq) }} <small>dB</small></span>
          <M3Progress :value="scale(s.rsrq, ...RANGES.rsrq) * 100" label="RSRQ" :height="6" :stop="false" />
        </div>
        <div class="hk-tile">
          <span class="hk-label font-weight-bold">SINR</span>
          <span class="hk-mv">{{ signed(s.sinr) }} <small>dB</small></span>
          <M3Progress :value="scale(s.sinr, ...RANGES.sinr) * 100" label="SINR" :height="6" :stop="false" />
        </div>
        <div class="hk-tile">
          <span class="hk-label font-weight-bold">Temperature</span>
          <span class="hk-mv">{{ temp ?? '—' }} <small>°C</small></span>
          <M3Progress :value="scale(temp, ...RANGES.temp) * 100" label="Modem temperature" tone="tertiary" :height="6" :stop="false" />
        </div>
      </div>

      <dl class="hk-signal__facts">
        <div v-for="f in facts" :key="f.k">
          <dt class="hk-label">{{ f.k }}</dt>
          <dd :class="{ 'font-weight-bold': f.strong }">{{ f.v }}</dd>
        </div>
      </dl>
      <div class="d-flex justify-end">
        <v-btn to="/engineering" variant="tonal" height="40"><HkIcon name="antenna" :size="18" class="mr-2" />Engineering mode</v-btn>
      </div>
    </template>
    <div v-else-if="modem" class="py-6">
      <div class="hk-display" style="font-size: 32px">{{ modem.sim !== 'ready' ? 'No SIM ready' : 'No signal' }}</div>
      <p class="text-muted mt-2">{{ modem.sim !== 'ready' ? `SIM state: ${modem.sim}` : modem.error || 'The modem is not registered on a network.' }}</p>
    </div>
    <v-skeleton-loader v-else type="heading, text, text, text" bg-color="transparent" />
  </section>
</template>

<style scoped>
.hk-signal {
  border-radius: var(--hk-r-hero);
  padding: 28px 32px;
  gap: 24px;
}
.hk-signal__top {
  display: flex;
  align-items: center;
  gap: 32px;
  flex-wrap: wrap;
}
.hk-signal__tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.hk-signal__tiles .hk-tile {
  border-radius: 20px;
  padding: 14px 16px;
  gap: 8px;
}
.hk-mv {
  font-size: 20px;
  font-weight: 500;
  white-space: nowrap;
}
.hk-mv small {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-muted));
}
.hk-signal__facts {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  font-size: 14px;
}
.hk-signal__facts > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.hk-signal__facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
@media (max-width: 839.98px) {
  .hk-signal {
    padding: 22px 20px;
    border-radius: var(--hk-r-card);
  }
  .hk-signal__tiles,
  .hk-signal__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
