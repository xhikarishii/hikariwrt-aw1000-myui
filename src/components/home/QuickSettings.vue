<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import QuickTile from '@/components/m3/QuickTile.vue'
import type { RouterStatus } from '@/api/modem'
import { setAdblock, setWifiAps, vpnEnable, type VpnTunnel, type WifiAp } from '@/api/services'
import { useAction } from '@/composables/action'
import { useConfirm } from '@/composables/confirm'
import { useNotify } from '@/composables/notify'
import { luciUrl } from '@/nav'

// The design's four tiles. A tile for something that isn't set up still
// does something useful: it opens the page where it can be set up.
//   WireGuard      aw1000-vpn enable/disable (first tunnel)
//   IP passthrough shows router/bridge mode; switching modes restarts the
//                  WAN side and has its own confirm flow, so the tile hands
//                  over to the Router mode page instead of flipping it here
//   Ad blocking    adblock's adb_enabled + restart
//   Guest Wi-Fi    a guest access point's on/off, with Wi-Fi rollback
//   Wi-Fi (phone)  every non-guest band at once, with Wi-Fi rollback; the
//                  phone board shows it where desktop shows IP passthrough
const props = defineProps<{
  tunnels: VpnTunnel[] | null
  router: RouterStatus | null
  adblock: boolean | null
  guests: WifiAp[]
  aps?: WifiAp[] | null
  compact?: boolean
  hasVpn: boolean
  hasModem: boolean
}>()
const emit = defineEmits<{ changed: [] }>()
const { busy, run } = useAction()
const { ask } = useConfirm()
const notify = useNotify()
const router = useRouter()

const tunnel = computed(() => props.tunnels?.[0] ?? null)
const vpnOn = computed(() => !!tunnel.value?.enabled)
const vpnLabel = computed(() => {
  if (!props.hasVpn) return 'Not installed'
  if (!tunnel.value) return 'Not set up'
  if (!vpnOn.value) return 'Off'
  return tunnel.value.up ? 'Connected' : 'Connecting'
})

const bands = computed(() => (props.aps ?? []).filter((a) => a.main))
const bandsOn = computed(() => bands.value.filter((a) => !a.disabled).length)

async function onWifi(): Promise<void> {
  const on = bandsOn.value === 0
  if (!on) {
    const ok = await ask({
      title: 'Turn off Wi-Fi?',
      text: 'Every device on Wi-Fi disconnects, probably including this phone.\n\nIf the router can’t hear back from you within 30 seconds, it turns Wi-Fi back on.',
      confirm: 'Turn off',
    })
    if (!ok) return
  }
  const secs = bands.value.map((a) => a.section)
  if (await run('wifi', () => setWifiAps(secs, on), `Wi-Fi turned ${on ? 'on' : 'off'}`)) emit('changed')
}

const bridged = computed(() => !!props.router && props.router.mode !== 'routing')

async function onVpn(): Promise<void> {
  if (!props.hasVpn) return notify.show('The WireGuard package isn’t installed on this router.')
  if (!tunnel.value) return void router.push('/vpn')
  const t = tunnel.value
  if (await run('vpn', () => vpnEnable(t.name, !vpnOn.value), `WireGuard ${vpnOn.value ? 'off' : 'on'}`)) emit('changed')
}

async function onPassthrough(): Promise<void> {
  if (!props.hasModem) return
  const go = await ask({
    title: bridged.value ? 'Back to router mode?' : 'Switch to IP passthrough?',
    text: bridged.value
      ? 'The router takes the 5G address back and restarts its WAN side.'
      : 'The device on the WAN port gets the 5G address directly, and the router restarts its WAN side. The Router mode page walks you through it and keeps a way back.',
    confirm: 'Open Router mode',
  })
  if (go) window.location.href = luciUrl('admin/modem/router')
}

async function onAdblock(): Promise<void> {
  if (props.adblock === null) return notify.show('adblock isn’t installed on this router.')
  const on = !props.adblock
  if (await run('ad', () => setAdblock(on), `Ad blocking turned ${on ? 'on' : 'off'}`)) emit('changed')
}

// Every guest access point (one per band) switches together.
const guestOn = computed(() => props.guests.some((g) => !g.disabled))
async function onGuest(): Promise<void> {
  if (!props.guests.length) return void router.push('/wifi')
  const on = !guestOn.value
  const secs = props.guests.map((g) => g.section)
  if (await run('guest', () => setWifiAps(secs, on), `Guest Wi-Fi turned ${on ? 'on' : 'off'}`)) emit('changed')
}
</script>

<template>
  <div class="hk-qs" :class="{ 'is-compact': compact }">
    <QuickTile
      v-if="compact"
      :on="bandsOn > 0"
      title="Wi-Fi"
      :label="bandsOn ? `${bandsOn} ${bandsOn === 1 ? 'band' : 'bands'} on` : 'Off'"
      icon="wifi"
      :busy="busy.wifi"
      compact
      @click="onWifi"
    />
    <QuickTile :on="vpnOn" title="WireGuard" :label="vpnLabel" icon="shield" :busy="busy.vpn" :compact="compact" :toggle="!!tunnel" @click="onVpn" />
    <QuickTile
      v-if="!compact"
      :on="bridged"
      title="IP passthrough"
      :label="router ? (bridged ? 'Bridge mode' : 'Router mode') : hasModem ? '…' : 'Not available'"
      icon="passthrough"
      :compact="compact"
      :toggle="false"
      @click="onPassthrough"
    />
    <QuickTile :on="!!adblock" title="Ad blocking" :label="adblock === null ? 'Not installed' : adblock ? 'On' : 'Off'" icon="block" :busy="busy.ad" :compact="compact" :toggle="adblock !== null" @click="onAdblock" />
    <QuickTile :on="guestOn" title="Guest Wi-Fi" :label="guests.length ? (guestOn ? 'On' : 'Off') : 'Not set up'" icon="guest" :busy="busy.guest" :compact="compact" :toggle="guests.length > 0" @click="onGuest" />
  </div>
</template>

<style scoped>
.hk-qs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
</style>
