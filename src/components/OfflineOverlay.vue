<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import BrandMark from '@/components/BrandMark.vue'
import { useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'
import { appWaiting } from '@/utils/app'

// Shown while the router restarts. Waits until it has gone away and come
// back (a reply from uhttpd), then sends you to sign in: rpcd sessions live
// in RAM, so the old one is gone after any reboot. The Android app is told,
// so its connection watchdog lets the router be away for those minutes.
const ui = useUi()
const session = useSession()
const seconds = ref(0)
const back = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
let wentAway = false

async function probe(): Promise<boolean> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 3000)
    const r = await fetch('/ubus', { method: 'POST', body: '{"jsonrpc":"2.0","id":0,"method":"list","params":[]}', signal: ctl.signal, cache: 'no-store' })
    clearTimeout(t)
    return r.ok
  } catch {
    return false
  }
}

watch(
  () => ui.offline,
  (o) => {
    clearInterval(timer)
    appWaiting(!!o)
    if (!o) return
    seconds.value = 0
    back.value = false
    wentAway = false
    timer = setInterval(async () => {
      seconds.value += 3
      const up = await probe()
      if (!up) wentAway = true
      // Up again after being down, or up after long enough that we missed the gap.
      if (up && (wentAway || seconds.value > 150)) {
        clearInterval(timer)
        back.value = true
        session.forget()
        setTimeout(() => {
          ui.offline = null
          window.location.hash = '#/login'
          window.location.reload()
        }, 1500)
      }
    }, 3000)
  },
)
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <v-overlay :model-value="!!ui.offline" persistent class="align-center justify-center" scrim="surface" :opacity="0.96" z-index="2000">
    <div v-if="ui.offline" class="hk-offline" role="status" aria-live="polite">
      <BrandMark :size="56" :label="false" />
      <h2 class="hk-h1" style="font-size: 30px">{{ back ? 'The router is back' : ui.offline.title }}</h2>
      <p class="text-muted">{{ back ? 'Taking you to sign in…' : ui.offline.text }}</p>
      <v-progress-linear v-if="!back" indeterminate color="primary" bg-color="secondary-container" bg-opacity="1" height="6" rounded style="width: 260px" />
      <span v-if="!back" class="hk-label">{{ Math.floor(seconds / 60) }}:{{ String(seconds % 60).padStart(2, '0') }}</span>
      <p v-if="ui.offline.expectAddress && seconds > 120" class="hk-label" style="max-width: 360px">
        Still waiting? The router may now be at <a :href="`http://${ui.offline.expectAddress}/`" class="text-primary">{{ ui.offline.expectAddress }}</a>.
      </p>
    </div>
  </v-overlay>
</template>

<style scoped>
.hk-offline {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
  padding: 24px;
}
.hk-offline p {
  margin: 0;
  max-width: 420px;
}
</style>
