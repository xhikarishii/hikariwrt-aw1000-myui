<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import M3Switch from '@/components/m3/M3Switch.vue'
import BandCard from '@/components/wifi/BandCard.vue'
import GuestCard from '@/components/wifi/GuestCard.vue'
import SharedWifiCard from '@/components/wifi/SharedWifiCard.vue'
import WifiJoin from '@/components/wifi/WifiJoin.vue'
import { wifiRadios, type WifiRadio } from '@/api/wifi'
import { guestState, type GuestState } from '@/api/guest'

// Wireless: one card per band. Loaded on open and after each save (not
// polled: a refresh while you type would overwrite the form).
//
// "Same name on both bands" isn't a setting of its own - the setup wizard
// writes the same name, password and security to every band - so it is read
// back the same way: all main networks alike means shared. Then one Wi-Fi
// card holds the name and password, and the band cards keep only channel,
// width and on/off. The switch splits them again (or joins them), and the
// choice only reaches the router when a card is saved.
const radios = ref<WifiRadio[] | null>(null)
const gstate = ref<GuestState | null>(null)
const error = ref('')

async function load(): Promise<void> {
  try {
    const [r, g] = await Promise.all([wifiRadios(), guestState()])
    radios.value = r
    gstate.value = g
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
onMounted(load)

const ORDER: Record<string, number> = { '6g': 0, '5g': 1, '2g': 2 }
// Home's bands only: guest and the networks made on the Networks page have
// their own cards.
const bands = computed(() =>
  (radios.value ?? [])
    .flatMap((r) => r.networks.filter((n) => n.main).map((n) => ({ radio: r, net: n })))
    .sort((a, b) => (ORDER[a.radio.band] ?? 9) - (ORDER[b.radio.band] ?? 9)),
)
const guest = computed(() => (radios.value ?? []).flatMap((r) => r.networks.filter((n) => n.guest && n.network === 'guest').map((n) => ({ radio: r, net: n }))))
// Wi-Fi of the other networks (smart home, a second guest network, ...):
// listed here, set on the Networks page.
const BAND: Record<string, string> = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz' }
const others = computed(() => {
  const by = new Map<string, { network: string; ssid: string; bands: string[]; clients: number; disabled: boolean }>()
  for (const r of radios.value ?? [])
    for (const n of r.networks) {
      if (n.main || n.network === 'guest') continue
      const e = by.get(n.network) ?? { network: n.network, ssid: n.ssid, bands: [], clients: 0, disabled: true }
      e.bands.push(BAND[r.band] ?? r.band)
      e.clients += n.clients
      e.disabled &&= n.disabled
      by.set(n.network, e)
    }
  return [...by.values()]
})
const devices = computed(() => bands.value.reduce((a, b) => a + b.net.clients, 0))

const alike = (a: { net: { ssid: string; key: string; encryption: string; hidden: boolean } }, b: typeof a) =>
  a.net.ssid === b.net.ssid && a.net.key === b.net.key && a.net.encryption === b.net.encryption && a.net.hidden === b.net.hidden
const sameNow = computed(() => bands.value.length > 1 && bands.value.every((b) => alike(b, bands.value[0]!)))
// What the switch says: the config, until someone flips it.
const choice = ref<boolean | null>(null)
const shared = computed(() => bands.value.length > 1 && (choice.value ?? sameNow.value))
// The join tile shows what is saved, so only once the bands really are alike.
const joinNet = computed(() => (sameNow.value ? (bands.value.find((b) => b.radio.band === '5g') ?? bands.value[0])!.net : null))

function afterSave(): void {
  // Give hostapd a moment to come back before reading the state again. The
  // saved config decides the layout from here on.
  choice.value = null
  setTimeout(load, 4000)
}
</script>

<template>
  <PageHeader :overline="radios ? `${bands.length} networks · ${devices} devices connected` : 'Wi-Fi networks'" title="Wireless" />

  <v-alert v-if="error" type="error" variant="tonal" rounded="xl">{{ error }}</v-alert>

  <section v-if="radios && bands.length > 1" class="hk-card hk-same" aria-label="Same name on both bands">
    <div class="d-flex align-center ga-3">
      <div class="d-flex flex-column flex-grow-1">
        <span style="font-size: 15px; font-weight: 500">Same name on both bands</span>
        <span class="hk-label">{{ shared ? 'Devices move between 2.4 and 5 GHz by themselves' : 'Each band has its own name and password' }}</span>
      </div>
      <M3Switch :model-value="shared" label="Same name on both bands" @update:model-value="choice = $event" />
    </div>
    <span v-if="choice !== null && choice !== sameNow" class="hk-label">
      {{ choice ? 'Set the name and password below and save to put them on every band.' : 'Change a band’s name or password and save it to give it its own.' }}
    </span>
  </section>

  <WifiJoin v-if="shared && joinNet && !joinNet.disabled" :ssid="joinNet.ssid" :password="joinNet.key" :encryption="joinNet.encryption" />

  <div class="hk-grid-3 hk-wifi">
    <template v-if="radios">
      <SharedWifiCard v-if="shared" :bands="bands" @saved="afterSave" />
      <BandCard v-for="b in bands" :key="b.net.section" :radio="b.radio" :net="b.net" :shared="shared" @saved="afterSave" />
      <!-- A guest setup made elsewhere (LuCI) keeps plain band cards. -->
      <template v-if="gstate?.foreign">
        <BandCard v-for="g in guest" :key="g.net.section" :radio="g.radio" :net="g.net" @saved="afterSave" />
      </template>
      <GuestCard v-else-if="gstate" :state="gstate" :radios="radios" @changed="afterSave" />
      <section v-if="others.length" class="hk-card" aria-label="Other networks" style="gap: 12px">
        <div class="d-flex align-center ga-3">
          <div class="d-flex flex-column flex-grow-1">
            <h2 class="hk-h2">Other networks</h2>
            <span class="hk-label">Set on the Networks page</span>
          </div>
          <v-btn to="/networks" variant="flat" color="secondary-container" height="40">Networks</v-btn>
        </div>
        <div v-for="o in others" :key="o.network" class="d-flex align-center ga-3">
          <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
            <span style="font-size: 15px; font-weight: 600">{{ o.ssid }}</span>
            <span class="hk-label">{{ o.bands.join(' + ') }} · {{ o.disabled ? 'Off' : `${o.clients} ${o.clients === 1 ? 'device' : 'devices'}` }}</span>
          </div>
        </div>
      </section>
    </template>
    <template v-else-if="!error">
      <v-skeleton-loader v-for="i in 3" :key="i" type="heading, text@5" class="hk-card" />
    </template>
  </div>
</template>

<style scoped>
.hk-wifi {
  align-items: start;
}
.hk-same {
  padding-top: 16px;
  padding-bottom: 16px;
  gap: 6px;
}
</style>
