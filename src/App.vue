<script setup lang="ts">
import { nextTick, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { onSessionExpired } from '@/api/ubus'
import { useAppearance } from '@/stores/appearance'
import { useSession } from '@/stores/session'
import { buildThemes } from '@/theme/material'
import { useNotify } from '@/composables/notify'
import { savedLogin, setBars } from '@/utils/app'
import { useAppearanceSync } from '@/composables/appearanceSync'
import ConfirmHost from '@/components/ConfirmHost.vue'
import SpeedTestDialog from '@/components/SpeedTestDialog.vue'
import OfflineOverlay from '@/components/OfflineOverlay.vue'

const theme = useTheme()
const look = useAppearance()
const session = useSession()
const router = useRouter()
const notify = useNotify()
useAppearanceSync()

// Regenerate both schemes whenever the seed, variant or contrast changes,
// and follow the chosen mode ('system' tracks prefers-color-scheme).
// Merge into the existing definitions rather than replacing them: Vuetify's
// defaults (theme-on-dark/-light and friends) must survive, it uses them to
// derive on-colours for roles we don't pair ourselves.
watchEffect(() => {
  const t = buildThemes({ seed: look.seed, variant: look.variant, contrast: look.contrast })
  for (const name of ['light', 'dark'] as const) {
    const target = theme.themes.value[name]!
    Object.assign(target.colors, t[name].colors)
    Object.assign(target.variables, t[name].variables)
  }
})
watchEffect(() => theme.change(look.mode))

// The phone's system bars follow the UI: the Android app tints them through
// its bridge, a mobile browser takes <meta name="theme-color">. Top is the app
// bar's colour; bottom is the bottom navigation's where the page has one.
const route = useRoute()
watch(
  () => [theme.current.value.colors.surface, theme.current.value.colors['surface-container'], theme.current.value.dark, route.fullPath],
  async () => {
    await nextTick()
    const c = theme.current.value.colors
    const top = String(c.surface ?? '#ffffff')
    const bottom = String(document.querySelector('.hk-bottom') ? (c['surface-container'] ?? top) : top)
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'theme-color'
      document.head.appendChild(meta)
    }
    meta.content = top
    setBars(top, bottom, theme.current.value.dark)
  },
  { immediate: true },
)

onSessionExpired(() => {
  if (!session.sid) return
  session.forget()
  // With a remembered sign-in, the login page signs straight back in.
  if (!savedLogin()) notify.show('Your session expired. Please sign in again.')
  router.replace({ name: 'login', query: { next: router.currentRoute.value.fullPath } })
})
</script>

<template>
  <v-app>
    <router-view />
    <ConfirmHost />
    <SpeedTestDialog v-if="session.loggedIn" />
    <OfflineOverlay />
    <v-snackbar v-model="notify.open.value" :timeout="notify.timeout.value" location="bottom">
      {{ notify.text.value }}
    </v-snackbar>
  </v-app>
</template>
