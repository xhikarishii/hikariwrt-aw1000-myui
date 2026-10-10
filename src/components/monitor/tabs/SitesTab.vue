<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import SegmentedButton from '@/components/m3/SegmentedButton.vue'
import LineChart, { type ChartSeries } from '@/components/monitor/LineChart.vue'
import UptimeBar from '@/components/monitor/UptimeBar.vue'
import * as monitor from '@/api/monitor'
import type { Range, SiteResult, SiteWan } from '@/api/monitor'
import { useAction } from '@/composables/action'
import { useConfirm } from '@/composables/confirm'
import { usePoll } from '@/composables/poll'
import { luciUrl } from '@/nav'
import { bucketTime, mergeBar } from '@/utils/series'
import { ago, letterOf, letterRole, meanLatency, msShort, resultText, toneOf } from '@/utils/sites'

// Monitoring -> Sites: how fast the websites people use answer over each
// WAN, laid out like the reference grid - a tile per site with its icon and
// a time per interface - then a chart that puts the interfaces side by side
// (all sites, or the tile clicked), and the restarts and reboots. Status is
// polled every 10 s, the series every minute. The checks, the watchdog and
// the site list are set on the LuCI page (the Settings button).
const status = usePoll(() => monitor.sitestatus(), 10000)
const range = ref<Range>('24h')
const only = ref<string | null>(null)
const site = ref('all')
const { busy, run } = useAction()
const { ask } = useConfirm()

const data = usePoll(async () => {
  const r = range.value
  const s = site.value
  const [series, events] = await Promise.all([monitor.sitesseries(s, r), monitor.siteevents(r)])
  return { r, s, series, events }
}, 60000)
watch([range, site], () => data.refresh())

const st = computed(() => status.data.value)
const ser = computed(() => {
  const d = data.data.value
  return d && d.r === range.value && d.s === site.value && d.series.ok ? d.series : null
})
const actions = computed(() => data.data.value?.events.actions ?? [])

const ranges = computed(() => {
  const days = st.value?.persist.enabled ? st.value.persist.days : 0
  return [
    { value: '1h' as Range, label: '1H' },
    { value: '3h' as Range, label: '3H' },
    { value: '6h' as Range, label: '6H' },
    { value: '12h' as Range, label: '12H' },
    { value: '24h' as Range, label: '24H' },
    { value: '7d' as Range, label: '7D' },
    { value: '30d' as Range, label: '30D' },
    ...(days >= 90 ? [{ value: '90d' as Range, label: '90D' }] : []),
    ...(days >= 365 ? [{ value: '365d' as Range, label: '1Y' }] : []),
  ]
})
watch(ranges, (r) => {
  if (!r.some((x) => x.value === range.value)) range.value = '30d'
})

// The Uptime tab's colours, in the same WAN order.
const COLORS = ['rgb(var(--v-theme-primary))', 'rgb(var(--v-theme-tertiary))', 'rgb(var(--v-theme-secondary))', 'rgb(var(--v-theme-info))']
const wans = computed(() => st.value?.wans.filter((w) => !w.iface_disabled) ?? [])
const colorOf = (name: string) => COLORS[Math.max(0, wans.value.findIndex((w) => w.name === name)) % COLORS.length]!
const checking = computed(() => wans.value.filter((w) => w.sites))
const shown = computed(() => checking.value.filter((w) => !only.value || w.name === only.value))

interface Tile {
  id: string
  name: string
  icon: string | null
  result: (w: SiteWan) => SiteResult | null | undefined
}
const tiles = computed<Tile[]>(() => {
  const out: Tile[] = []
  if (checking.value.some((w) => w.gateway)) out.push({ id: 'gw', name: 'Gateway', icon: null, result: (w) => w.gateway?.last })
  for (const s of st.value?.sites ?? []) out.push({ id: s.id, name: s.host, icon: s.icon, result: (w) => w.results[s.id] })
  return out
})
const failedIcons = ref(new Set<string>())

function answering(w: SiteWan): string {
  if (w.link === false) return `${w.label} link down`
  const list = Object.values(w.results)
  return `${w.label} ${list.filter((r) => r.ok).length} of ${list.length} answer`
}

function tip(t: Tile): string {
  return [
    t.name,
    ...shown.value.map((w) => {
      const r = t.result(w)
      if (!r) return `${w.label}: —`
      if (!r.ok) return `${w.label}: ${t.id === 'gw' ? 'no reply to ping' : 'no answer'}`
      return `${w.label}: ${msShort(r.latency)}${r.connect != null ? `, connect ${msShort(r.connect)}` : ''}${r.code ? `, HTTP ${r.code}` : ''}`
    }),
  ].join('\n')
}

function pick(id: string): void {
  site.value = site.value === id ? 'all' : id
}
const siteName = computed(() =>
  site.value === 'all' ? 'All sites' : site.value === 'gw' ? 'Gateway' : (st.value?.sites.find((s) => s.id === site.value)?.host ?? site.value),
)

// The chart: one line per interface.
const chartWans = computed(() => (ser.value?.wans ?? []).filter((w) => !only.value || w.name === only.value))
const one = computed(() => chartWans.value.length === 1)
const series = computed<ChartSeries[]>(() =>
  chartWans.value.map((w) => ({ label: w.label, color: colorOf(w.name), values: w.rtt, band: one.value ? [w.rmin, w.rmax] : undefined })),
)
const base = computed(() => ({ ts: chartWans.value[0]?.ts ?? [], step: ser.value?.step ?? 300, from: ser.value?.from ?? 0, to: ser.value?.to ?? 1 }))
function nowOf(name: string): number | null {
  const w = wans.value.find((x) => x.name === name)
  if (!w) return null
  if (site.value === 'gw') return w.gateway?.last?.ok ? w.gateway.last.latency : null
  if (site.value !== 'all') {
    const r = w.results[site.value]
    return r?.ok ? r.latency : null
  }
  return meanLatency(w.results)
}
const fmtAxis = (v: number) => `${v} ms`

// Check now: the router checks in the background; watch "checked" move on.
async function checkNow(): Promise<void> {
  const before = st.value?.checked ?? null
  await run('check', async () => {
    const r = await monitor.sitecheck()
    if (!r.ok) return r
    for (let i = 0; i < 30; i++) {
      await new Promise((ok) => setTimeout(ok, 2000))
      const s = await monitor.sitestatus()
      if (s.checked !== before) {
        status.data.value = s
        await data.refresh()
        return { ok: true }
      }
    }
    return { ok: true }
  })
}

async function restart(w: SiteWan): Promise<void> {
  const ok = await ask({
    title: `Restart ${w.label}?`,
    text: 'Its connection drops for a moment while the interface comes back up; the 5G modem redials, which takes about half a minute.',
    confirm: 'Restart',
  })
  if (ok) await run(`restart-${w.name}`, () => monitor.siteaction(w.name, 'restart'), st.value?.dryrun ? 'Dry run: only logged' : `${w.label} is restarting`)
}

async function reboot(): Promise<void> {
  const ok = await ask({
    title: 'Reboot the router?',
    text: 'Everything connected loses the network for a couple of minutes.',
    confirm: 'Reboot',
    destructive: true,
  })
  if (ok) await run('reboot', () => monitor.siteaction('', 'reboot'), st.value?.dryrun ? 'Dry run: only logged' : 'The router is rebooting')
}

const ACTION: Record<string, string> = {
  none: 'does nothing',
  restart: 'restarts the interface',
  restart_reboot: 'restarts the interface, then reboots the router',
}
const DONE: Record<string, string> = { restart: 'Restarted', reboot: 'Rebooted', recovered: 'Recovered', skipped: 'Not rebooted' }
function wanState(w: SiteWan): string {
  if (!w.sites) return 'Not checking sites.'
  if (w.link === false) return 'Link down; Uptime records this.'
  if (w.dark_since && st.value) return `No site has answered for ${Math.floor((st.value.now - w.dark_since) / 60)} min.`
  return `When no site answers for ${w.after} min, it ${ACTION[w.action]}.`
}
</script>

<template>
  <div class="hk-mon">
    <v-alert v-if="status.error.value" type="error" variant="tonal" rounded="xl">
      {{ status.error.value instanceof Error ? status.error.value.message : status.error.value }}
    </v-alert>
    <v-alert v-else-if="st && !st.enabled" type="info" variant="tonal" rounded="xl">Site checks are switched off; turn them on in Settings.</v-alert>
    <v-alert v-else-if="st && !st.running" type="warning" variant="tonal" rounded="xl">The monitor isn’t running, so nothing is being checked.</v-alert>
    <v-alert v-if="st?.persist.enabled && st.persist.error" type="warning" variant="tonal" rounded="xl">
      Sites history couldn’t be saved: {{ st.persist.error }}. It’s kept in RAM until the storage is back.
    </v-alert>

    <div class="hk-mon-bar">
      <SegmentedButton v-model="range" :options="ranges" label="Period" class="hk-mon-range" />
      <div v-if="checking.length > 1" class="d-flex flex-wrap ga-2" role="group" aria-label="WANs shown">
        <button type="button" class="hk-filter" :class="{ 'is-on': !only }" :aria-pressed="!only" @click="only = null">
          <HkIcon v-if="!only" name="check" :size="16" :stroke="2.6" />All WANs
        </button>
        <button v-for="w in checking" :key="w.name" type="button" class="hk-filter" :class="{ 'is-on': only === w.name }" :aria-pressed="only === w.name" @click="only = w.name">
          <span class="hk-dot" :style="{ background: colorOf(w.name) }" />{{ w.label }}
        </button>
      </div>
    </div>

    <!-- The sites, a time per interface under each -->
    <section class="hk-card" aria-label="Sites" style="gap: 14px">
      <div class="hk-mon-head">
        <div class="hk-mon-live hk-label">
          <span>Checked <b>{{ st ? ago(st.checked, st.now) : '—' }}</b>, every {{ st ? Math.round(st.interval / 60) : 5 }} min</span>
          <span v-for="w in checking" :key="w.name"><span class="hk-dot hk-sites__inline" :style="{ background: colorOf(w.name) }" />{{ answering(w) }}</span>
        </div>
        <v-btn variant="flat" color="secondary-container" height="40" rounded="pill" :loading="busy.check" :disabled="!st?.enabled" @click="checkNow">
          <HkIcon name="refresh" :size="16" class="mr-2" />Check now
        </v-btn>
      </div>
      <div v-if="st && checking.length" class="hk-sites">
        <button
          v-for="t in tiles"
          :key="t.id"
          type="button"
          class="hk-site"
          :class="{ 'is-on': site === t.id }"
          :title="tip(t)"
          :aria-pressed="site === t.id"
          @click="pick(t.id)"
        >
          <span class="hk-site__icon">
            <HkIcon v-if="t.id === 'gw'" name="router" :size="30" />
            <img v-else-if="t.icon && !failedIcons.has(t.id)" :src="`/aw1000-site-icons/${t.icon}`" alt="" loading="lazy" @error="failedIcons.add(t.id)" />
            <span v-else class="hk-site__letter" :class="`is-${letterRole(t.name)}`">{{ letterOf(t.name) }}</span>
          </span>
          <span class="hk-site__name">{{ t.name }}</span>
          <span v-for="w in shown" :key="w.name" class="hk-site__ms">
            <span class="hk-dot" :style="{ background: colorOf(w.name) }" />
            <span :class="`is-${toneOf(t.result(w))}`">{{ resultText(t.result(w), t.id === 'gw') }}</span>
          </span>
        </button>
      </div>
      <span v-else-if="st" class="text-muted" style="font-size: 14px">No WAN checks sites. Turn it on for one in Settings.</span>
      <v-skeleton-loader v-else type="image" bg-color="transparent" />
    </section>

    <!-- The interfaces side by side -->
    <section class="hk-card" aria-label="Response time" style="gap: 8px">
      <div class="hk-mon-head">
        <h2 class="hk-h2">Response time · {{ siteName }}</h2>
        <div class="hk-mon-live hk-label">
          <span v-for="w in chartWans" :key="w.name">{{ w.label }} <b>{{ msShort(nowOf(w.name)) }}</b></span>
        </div>
      </div>
      <template v-if="ser">
        <LineChart v-bind="base" :series="series" :fmt-y="fmtAxis" :fmt-val="msShort" label="Response time chart" />
        <span class="text-muted" style="font-size: 13px">
          {{ site === 'all' ? 'The average over every site, per interface. Tap a tile to see one site; tap it again for all.' : 'Tap the tile again to see all sites.' }}
        </span>
        <div v-for="w in chartWans" :key="w.name" class="d-flex flex-column ga-1 mt-2">
          <span class="hk-label">
            <span class="hk-dot hk-sites__inline" :style="{ background: colorOf(w.name) }" />{{ w.label }}
            <template v-if="w.summary.uptime != null"> · {{ w.summary.uptime.toFixed(1) }}% of checks answered</template>
          </span>
          <UptimeBar :bar="mergeBar(w, ser.step, 90)" :from="ser.from" :label="`${w.label} checks over the period`" />
        </div>
      </template>
      <v-skeleton-loader v-else type="image" bg-color="transparent" />
    </section>

    <!-- Recovery -->
    <section class="hk-card" aria-label="Recovery" style="gap: 12px">
      <div class="hk-mon-head">
        <h2 class="hk-h2">Recovery</h2>
        <span v-if="st" class="hk-label">
          Reboots: at most {{ st.max_reboots }} a day, none in the first {{ Math.round(st.boot_grace / 60) }} min after boot · {{ st.reboots_24h }} in the last 24 h
        </span>
      </div>
      <v-alert v-if="st?.dryrun" type="info" variant="tonal" rounded="lg" density="compact">Dry run: restarts and reboots are only logged.</v-alert>
      <div class="hk-group">
        <div v-for="w in wans" :key="w.name" class="hk-mon-outage">
          <span class="hk-dot" :style="{ background: colorOf(w.name) }" />
          <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
            <span style="font-size: 14px">{{ w.label }}</span>
            <span class="hk-label">{{ wanState(w) }}</span>
          </div>
          <v-btn variant="text" color="primary" height="36" :loading="busy[`restart-${w.name}`]" @click="restart(w)">Restart</v-btn>
        </div>
      </div>
      <div v-if="actions.length" class="hk-group">
        <div v-for="a in actions" :key="`${a.ts}${a.wan}${a.action}`" class="hk-mon-outage">
          <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
            <span style="font-size: 14px">{{ DONE[a.action] ?? a.action }} · {{ a.label || a.wan }}</span>
            <span class="hk-label">{{ bucketTime(a.ts) }} · {{ a.detail }}</span>
          </div>
        </div>
      </div>
      <span v-else class="text-muted" style="font-size: 14px">Nothing restarted or rebooted in this period.</span>
      <div class="d-flex flex-wrap justify-end ga-2">
        <v-btn :href="luciUrl('admin/monitoring/sites')" variant="text" color="primary" height="40">Change in Settings</v-btn>
        <v-btn variant="flat" color="error" height="40" :loading="busy.reboot" @click="reboot">Reboot router</v-btn>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hk-sites {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 12px 6px;
}
.hk-site {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 8px 4px;
  border: 1px solid transparent;
  border-radius: 16px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.hk-site:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.hk-site.is-on {
  border-color: rgb(var(--v-theme-outline-variant));
  background: rgb(var(--v-theme-surface-container-high));
}
.hk-site:focus-visible {
  outline: 3px solid rgb(var(--v-theme-secondary));
  outline-offset: -3px;
}
.hk-site__icon {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: rgb(var(--v-theme-surface-container-highest));
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--v-theme-on-surface));
  flex: none;
}
.hk-site__icon img {
  width: 38px;
  height: 38px;
  object-fit: contain;
  border-radius: 8px;
}
.hk-site__letter {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 18px;
}
.hk-site__letter.is-primary {
  background: rgb(var(--v-theme-primary-container));
  color: rgb(var(--v-theme-on-primary-container));
}
.hk-site__letter.is-secondary {
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}
.hk-site__letter.is-tertiary {
  background: rgb(var(--v-theme-tertiary-container));
  color: rgb(var(--v-theme-on-tertiary-container));
}
.hk-site__letter.is-error {
  background: rgb(var(--v-theme-error-container));
  color: rgb(var(--v-theme-on-error-container));
}
.hk-site__name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}
.hk-site__ms {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.hk-site__ms .hk-dot {
  width: 7px;
  height: 7px;
}
.is-good {
  color: rgb(var(--v-theme-success));
}
.is-fair {
  color: rgb(var(--v-theme-warning));
}
.is-poor {
  color: rgb(var(--v-theme-error));
}
.is-none {
  color: rgb(var(--v-theme-on-surface-muted));
}
.hk-sites__inline {
  display: inline-block;
  margin-right: 6px;
}
@media (max-width: 599.98px) {
  .hk-sites {
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  }
  .hk-site__icon {
    width: 56px;
    height: 56px;
    border-radius: 16px;
  }
}
</style>
