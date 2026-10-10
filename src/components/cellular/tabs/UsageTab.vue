<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import DailyBars from '@/components/m3/DailyBars.vue'
import M3Switch from '@/components/m3/M3Switch.vue'
import ProgressRing from '@/components/m3/ProgressRing.vue'
import * as modem from '@/api/modem'
import type { UsageInfo } from '@/api/modem'
import { useAction } from '@/composables/action'
import { useConfirm } from '@/composables/confirm'
import { bytes } from '@/utils/format'

// 5G data usage from aw1000-modem-usage (sampled on the router, so it counts
// every device, not just this browser). Every usage write answers with the
// full usage reply, which replaces ours. The daily history is kept on the
// router's storage or a drive; saves append, so even the internal flash only
// sees a short line per save.
const { busy, run } = useAction()
const { ask } = useConfirm()

const u = ref<UsageInfo | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    u.value = await modem.usageinfo()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

const form = reactive({
  enabled: true,
  limit: '',
  unit: 'GB',
  reset_day: 1,
  warn_percent: 80,
  action: 'none' as 'none' | 'disconnect',
  sms_notify: false,
  sms_number: '',
  retain_days: 400,
  persist_target: 'router',
  flush_interval: 1800,
})
watch(
  u,
  (v) => {
    if (!v) return
    const s = v.settings
    Object.assign(form, {
      enabled: v.enabled,
      limit: s.limit_value ? String(s.limit_value) : '',
      unit: s.unit || 'GB',
      reset_day: s.reset_day,
      warn_percent: s.warn_percent,
      action: s.action === 'disconnect' ? 'disconnect' : 'none',
      sms_notify: s.sms_notify,
      sms_number: s.sms_number ?? '',
      retain_days: s.retain_days,
      persist_target: v.persist?.target ?? 'router',
      flush_interval: s.flush_interval ?? 1800,
    })
  },
  { immediate: true },
)

// Where the history can go: the router's storage and any mounted drive; a
// chosen drive that's unplugged right now stays the choice.
const SAVE_EVERY = [
  { value: 1800, title: 'Every 30 minutes' },
  { value: 3600, title: 'Every hour' },
  { value: 21600, title: 'Every 6 hours' },
  { value: 43200, title: 'Every 12 hours' },
  { value: 86400, title: 'Once a day' },
]
const places = computed(() => {
  const list = (u.value?.storage ?? []).map((s) => ({ value: s.id, title: s.label, kind: s.kind as string }))
  const t = u.value?.persist?.target
  if (t && !list.some((p) => p.value === t)) list.push({ value: t, title: `${t} (not mounted)`, kind: 'drive' })
  return list
})
const everyItems = computed(() =>
  SAVE_EVERY.some((e) => e.value === form.flush_interval)
    ? SAVE_EVERY
    : [...SAVE_EVERY, { value: form.flush_interval, title: `Every ${Math.round(form.flush_interval / 60)} minutes` }],
)
const onFlash = computed(() => places.value.find((p) => p.value === form.persist_target)?.kind === 'flash')

const limited = computed(() => (u.value?.settings.limit ?? 0) > 0)
// Days of this billing period, oldest first (the reply is newest first).
const days = computed(() => {
  const v = u.value
  if (!v?.days) return []
  return v.days.filter((d) => d.date >= v.period.start && d.date <= v.period.end).reverse()
})
const TOTALS = [
  { k: 'today', label: 'Today' },
  { k: 'week', label: 'This week' },
  { k: 'cycle', label: 'This period' },
  { k: 'days30', label: 'Last 30 days' },
  { k: 'all', label: 'All recorded' },
] as const
const period = computed(() => {
  const p = u.value?.period
  if (!p) return ''
  const f = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return `${f(p.start)} – ${f(p.end)} · ${p.left} ${p.left === 1 ? 'day' : 'days'} left`
})

function take(r: UsageInfo & { error?: string }): UsageInfo & { error?: string } {
  if (r.ok) u.value = r
  return r
}

async function save(): Promise<void> {
  const lim = form.limit.trim()
  if (lim && !/^[0-9]+(\.[0-9]+)?$/.test(lim)) return void run('save', async () => ({ ok: false, error: 'The allowance is a number, like 100 or 12.5.' }))
  if (form.sms_notify && !/^[+]?[0-9][0-9 -]{2,}$/.test(form.sms_number.trim()))
    return void run('save', async () => ({ ok: false, error: 'Enter the number to text, or turn off SMS alerts.' }))
  if (form.action === 'disconnect' && lim && lim !== '0') {
    const ok = await ask({
      title: 'Cut 5G at the allowance?',
      text: 'When the period’s usage reaches the allowance, the router takes the 5G uplink down until the period resets or you resume it here.',
      confirm: 'Save',
    })
    if (!ok) return
  }
  // the history settings go back as the router has them: they're saved (and
  // a move confirmed) from the History card
  const v = u.value
  await run(
    'save',
    async () =>
      take(
        await modem.usageSet({
          ...form,
          limit: lim,
          sms_number: form.sms_number.trim(),
          retain_days: v?.settings.retain_days ?? form.retain_days,
          persist_target: v?.persist?.target,
          flush_interval: v?.settings.flush_interval,
        }),
      ),
    'Usage settings saved',
  )
}

async function saveHistory(): Promise<void> {
  const d = Number(form.retain_days)
  if (!Number.isInteger(d) || d < 1 || d > 3650) return void run('history', async () => ({ ok: false, error: 'Keep 1 to 3650 days.' }))
  const moving = form.persist_target !== (u.value?.persist?.target ?? 'router')
  if (moving) {
    const ok = await ask({
      title: 'Move the usage history?',
      text: 'The recorded days move to the new place, with today as counted so far, and are removed from the old one.',
      confirm: 'Move',
    })
    if (!ok) return
  }
  const s = u.value!.settings
  await run(
    'history',
    async () =>
      take(
        await modem.usageSet({
          enabled: u.value!.enabled,
          limit: s.limit_value ? String(s.limit_value) : '0',
          unit: s.unit,
          reset_day: s.reset_day,
          warn_percent: s.warn_percent,
          sms_notify: s.sms_notify,
          sms_number: s.sms_number ?? '',
          action: s.action === 'disconnect' ? 'disconnect' : 'none',
          retain_days: d,
          persist_target: form.persist_target,
          flush_interval: form.flush_interval,
        }),
      ),
    moving ? 'History moved' : 'History settings saved',
  )
}

async function reset(what: 'period' | 'all'): Promise<void> {
  const ok = await ask({
    title: what === 'period' ? 'Reset this period?' : 'Delete all usage history?',
    text: what === 'period' ? 'This period’s count starts again from zero. Earlier days are kept.' : 'Every recorded day is deleted. This can’t be undone.',
    confirm: what === 'period' ? 'Reset' : 'Delete',
    destructive: true,
  })
  if (ok) await run(what, async () => take(await modem.usageReset(what)), what === 'period' ? 'Period reset' : 'History deleted')
}

const resume = () => run('resume', async () => take(await modem.usageResume()), '5G is back on for the rest of this period')
</script>

<template>
  <v-alert v-if="error" type="error" variant="tonal" rounded="xl">{{ error }}</v-alert>
  <v-alert v-if="u?.persist && !u.persist.available" type="error" variant="tonal" rounded="xl">
    The drive the history is kept on ({{ u.persist.target }}) isn’t mounted, so nothing can be saved and the days before today are missing from these figures.
    Counting carries on in memory until it’s back, or until the router restarts. Plug it back in, or choose another place under History.
  </v-alert>

  <div class="hk-grid-3 hk-usage">
    <section class="hk-card hk-usage__main" aria-label="This period">
      <div class="d-flex align-center flex-wrap ga-3">
        <div class="d-flex flex-column flex-grow-1">
          <h2 class="hk-h2">This period</h2>
          <span class="text-muted" style="font-size: 13px">{{ period }}</span>
        </div>
        <span class="hk-legend"><i class="rx" />Download</span>
        <span class="hk-legend"><i class="tx" />Upload</span>
      </div>

      <v-alert v-if="u?.state?.blocked" type="warning" variant="tonal" density="comfortable">
        The allowance is used up, so 5G is off until {{ u.period.next }}.
        <template #append>
          <v-btn variant="flat" color="primary" height="36" :loading="busy.resume" @click="resume">Turn 5G back on</v-btn>
        </template>
      </v-alert>

      <template v-if="u?.ok">
        <div class="d-flex align-center flex-wrap ga-6">
          <ProgressRing v-if="limited" :value="u.cycle.percent" label="Allowance used" :size="120">
            <span class="hk-display" style="font-size: 24px; font-weight: 600">{{ u.cycle.percent }}%</span>
          </ProgressRing>
          <div class="d-flex flex-column ga-1">
            <span class="hk-display" style="font-size: 40px">{{ bytes(u.cycle.total) }}</span>
            <span class="text-muted" style="font-size: 14px">
              {{ bytes(u.cycle.rx) }} down · {{ bytes(u.cycle.tx) }} up<template v-if="limited"> · of {{ u.cycle.limit_human }}</template>
            </span>
            <span class="text-muted" style="font-size: 14px">About {{ bytes(u.cycle.projected) }} by the end of the period at this rate</span>
          </div>
        </div>
        <DailyBars v-if="days.length" :days="days" :height="140" />
        <p v-else class="text-muted">No days recorded in this period yet.</p>
        <div class="hk-totals">
          <div v-for="t in TOTALS" :key="t.k" class="hk-tile">
            <span class="hk-label">{{ t.label }}</span>
            <span class="font-weight-medium" style="font-size: 16px">{{ bytes(u.totals?.[t.k]?.total) }}</span>
          </div>
        </div>
      </template>
      <v-skeleton-loader v-else-if="!error" type="heading, image, text" bg-color="transparent" />
    </section>

    <section class="hk-card" aria-label="Allowance" style="gap: 14px">
      <div class="d-flex align-center ga-3">
        <h2 class="hk-h2 flex-grow-1">Allowance</h2>
        <M3Switch v-model="form.enabled" label="Track 5G data usage" />
      </div>
      <div class="d-flex ga-3">
        <v-text-field v-model="form.limit" label="Monthly allowance" placeholder="No limit" inputmode="decimal" hide-details />
        <v-select v-model="form.unit" :items="['MB', 'GB', 'TB']" label="Unit" hide-details style="max-width: 104px" />
      </div>
      <div class="d-flex ga-3">
        <v-select v-model="form.reset_day" :items="Array.from({ length: 31 }, (_, i) => i + 1)" label="Resets on day" hide-details />
        <v-text-field v-model.number="form.warn_percent" type="number" min="0" max="100" label="Warn at %" hide-details />
      </div>
      <v-select
        v-model="form.action"
        :items="[
          { value: 'none', title: 'Just warn' },
          { value: 'disconnect', title: 'Turn 5G off' },
        ]"
        label="When the allowance is used up"
        hide-details
      />
      <div class="d-flex align-center ga-3">
        <span class="flex-grow-1" style="font-size: 14px">Text me warnings</span>
        <M3Switch v-model="form.sms_notify" label="Send SMS warnings" />
      </div>
      <v-text-field v-if="form.sms_notify" v-model="form.sms_number" label="Phone number" inputmode="tel" hide-details />
      <div class="d-flex flex-wrap justify-end ga-2">
        <v-btn variant="text" color="primary" height="40" :loading="busy.period" @click="reset('period')">Reset period</v-btn>
        <v-btn variant="text" color="error" height="40" :loading="busy.all" @click="reset('all')">Delete history</v-btn>
        <v-btn variant="flat" color="primary" height="40" :loading="busy.save" :disabled="!u" @click="save">Save</v-btn>
      </div>
    </section>

    <section class="hk-card hk-usage__wide" aria-label="History" style="gap: 14px">
      <div class="d-flex flex-column">
        <h2 class="hk-h2">History</h2>
        <span class="text-muted" style="font-size: 13px">
          <template v-if="u?.recorded?.days">{{ u.recorded.days }} days recorded, {{ u.recorded.first }} to {{ u.recorded.last }}. </template>
          <template v-if="u?.persist?.path">Kept in {{ u.persist.path }}.</template>
        </span>
      </div>
      <div class="hk-usage__form">
        <v-select v-model="form.persist_target" :items="places" item-value="value" item-title="title" label="Where" hide-details :disabled="!u" />
        <v-select v-model="form.flush_interval" :items="everyItems" item-value="value" item-title="title" label="Save" hide-details :disabled="!u" />
        <v-text-field v-model.number="form.retain_days" type="number" min="1" max="3650" label="Keep (days)" hide-details :disabled="!u" />
      </div>
      <v-alert v-if="onFlash" type="warning" variant="tonal" rounded="lg" density="compact">
        This writes to the router’s internal flash, which wears with writes. Each save adds one short line and the file is rewritten once a week, so even every
        30 minutes is a few kilobytes a day. Whatever was counted since the last save is lost if the power fails; a reboot or shutdown saves it first.
      </v-alert>
      <span class="text-muted" style="font-size: 13px">
        The router’s storage survives reboots and firmware upgrades; a factory reset clears it. A USB drive, SD card or NVMe mounted on the router is listed too,
        but if it’s missing when the router starts, the earlier days are missing from the allowance until it’s back. A busy link saves sooner, after every
        gigabyte.
      </span>
      <div class="d-flex justify-end">
        <v-btn variant="flat" color="primary" height="40" :loading="busy.history" :disabled="!u" @click="saveHistory">Save</v-btn>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hk-usage__main {
  grid-column: span 2;
}
.hk-usage__wide {
  grid-column: 1 / -1;
}
.hk-usage__form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 839.98px) {
  .hk-usage__form {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 1279.98px) {
  .hk-usage {
    grid-template-columns: minmax(0, 1fr);
  }
  .hk-usage__main,
  .hk-usage__wide {
    grid-column: auto;
  }
}
.hk-legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-muted));
}
.hk-legend i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
.hk-legend .rx {
  background: rgb(var(--v-theme-primary));
}
.hk-legend .tx {
  background: rgb(var(--v-theme-tertiary));
}
.hk-totals {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}
@media (max-width: 839.98px) {
  .hk-totals {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
