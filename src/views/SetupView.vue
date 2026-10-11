<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SetupFrame from '@/components/setup/SetupFrame.vue'
import StepApply from '@/components/setup/StepApply.vue'
import StepInternet from '@/components/setup/StepInternet.vue'
import StepPassword from '@/components/setup/StepPassword.vue'
import StepReview from '@/components/setup/StepReview.vue'
import StepStorage from '@/components/setup/StepStorage.vue'
import StepSystem from '@/components/setup/StepSystem.vue'
import StepWelcome from '@/components/setup/StepWelcome.vue'
import StepWifi from '@/components/setup/StepWifi.vue'
import { STEPS, useSetup, type StepId } from '@/composables/setup'
import { useSession } from '@/stores/session'

// First-run wizard. The step lives in the URL (?step=wifi) so browser Back
// works; the draft lives here, in memory, until "Set up" on the last step.
const route = useRoute()
const router = useRouter()
const session = useSession()
const s = useSetup()
onMounted(s.load)

type Stage = StepId | 'apply'
const stage = computed<Stage>(() => {
  const q = route.query.step
  return q === 'apply' || STEPS.some((x) => x.id === q) ? (q as Stage) : 'welcome'
})
const index = computed(() => (stage.value === 'apply' ? STEPS.length - 1 : STEPS.findIndex((x) => x.id === stage.value)))
const step = computed(() => STEPS[index.value]!)
const title = computed(() => (stage.value === 'apply' ? (s.finished.value ? 'You’re all set' : 'Setting up') : step.value.title))
const lead = computed(() =>
  stage.value === 'apply'
    ? s.finished.value
      ? 'Your router is ready.'
      : 'This takes a minute. Keep this page open.'
    : step.value.lead,
)

// The password step can't be skipped while the router has no password.
const optional = computed(() => stage.value !== 'welcome' && stage.value !== 'review' && !(stage.value === 'password' && session.noPassword))
const canLater = computed(() => !session.noPassword && stage.value !== 'apply')

function go(to: Stage, push = true): void {
  const q = { step: to }
  if (push) router.push({ query: q })
  else router.replace({ query: q })
}
function next(): void {
  if (stage.value === 'review') {
    go('apply', false)
    s.apply()
    return
  }
  go(STEPS[index.value + 1]!.id)
}
function back(): void {
  if (index.value === 0) return
  go(STEPS[index.value - 1]!.id)
}
// Skip discards this step's edits: back to what the router has now.
function skip(): void {
  if (stage.value !== 'apply') s.fill(stage.value)
  next()
}
function later(): void {
  session.setupDismissed = true
  router.replace('/')
}
function onKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement
  if (e.key !== 'Enter' || e.shiftKey || t.tagName === 'TEXTAREA' || t.closest('.v-overlay')) return
  if (stage.value !== 'apply' && s.valid.value[stage.value as StepId]) {
    e.preventDefault()
    next()
  }
}
</script>

<template>
  <SetupFrame :index="index" :total="STEPS.length" :title="title" :lead="lead" :can-later="canLater" @later="later" @keydown="onKey">
    <v-alert v-if="s.loadError.value" type="error" variant="tonal">{{ s.loadError.value }}</v-alert>
    <v-skeleton-loader v-if="s.loading.value" type="text@4" bg-color="transparent" />
    <template v-else>
      <StepWelcome v-if="stage === 'welcome'" :s="s" />
      <StepPassword v-else-if="stage === 'password'" :s="s" />
      <StepSystem v-else-if="stage === 'system'" :s="s" />
      <StepInternet v-else-if="stage === 'internet'" :s="s" />
      <StepWifi v-else-if="stage === 'wifi'" :s="s" />
      <StepStorage v-else-if="stage === 'storage'" :s="s" />
      <StepReview v-else-if="stage === 'review'" :s="s" @go="go" />
      <StepApply v-else :s="s" @back="go('review', false)" @home="router.replace('/')" />
    </template>

    <template #actions>
      <template v-if="stage !== 'apply'">
        <v-btn v-if="index > 0" variant="text" color="primary" height="48" @click="back">Back</v-btn>
        <v-spacer />
        <v-btn v-if="optional" variant="text" color="primary" height="48" @click="skip">Skip</v-btn>
        <v-btn variant="flat" color="primary" height="48" min-width="140" :disabled="s.loading.value || !s.valid.value[stage as StepId]" @click="next">
          {{ stage === 'welcome' ? 'Get started' : stage === 'review' ? 'Set up' : 'Continue' }}
        </v-btn>
      </template>
    </template>
  </SetupFrame>
</template>
