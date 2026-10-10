<script setup lang="ts">
import { computed } from 'vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import WanMacField from '@/components/internet/WanMacField.vue'
import M3Switch from '@/components/m3/M3Switch.vue'
import SecretField from '@/components/m3/SecretField.vue'
import SegmentedButton from '@/components/m3/SegmentedButton.vue'
import type { SetupState } from '@/composables/setup'

// How the router gets online - the ISP's cable with 5G as backup, or 5G on
// its own - then the wired WAN and the 5G SIM, each with its IP version.
// Only the essentials: DNS, MTU and the finer IPv6 settings stay on the
// Internet and Cellular pages for later.
const props = defineProps<{ s: SetupState }>()
const e = computed(() => props.s.wanErrors.value)
const m = computed(() => props.s.orig.modem)
const carriers = computed(() => props.s.carriers.value.map((c) => ({ value: c.id, title: `${c.name} · ${c.apn}` })))
const operator = computed(() => m.value?.operator ?? '')
const standalone = computed(() => props.s.hasUsage.value && props.s.draft.usage === 'standalone')

const USAGE = [
  { value: 'failover', icon: 'ethernet', title: 'Wired, with 5G as backup', text: 'The ISP’s cable carries your internet. 5G takes over by itself when the cable goes down.' },
  { value: 'standalone', icon: 'cellular', title: '5G router', text: 'The 5G SIM is your internet, and the WAN port can become a fifth LAN port.' },
] as const

// Wired: IPv6 is asked of the ISP or not. 5G: the PDP type of the data call.
// "split" (two contexts, one per family) is an advanced arrangement set on the
// Cellular page; it is kept as it is and shown as IPv4 + IPv6.
const v6 = computed({
  get: () => (props.s.draft.v6style === 'split' ? 'dual' : props.s.draft.v6style),
  set: (v: string) => {
    if (!(v === 'dual' && props.s.draft.v6style === 'split')) props.s.draft.v6style = v
  },
})
</script>

<template>
  <div v-if="s.hasUsage.value" class="hk-use" role="radiogroup" aria-label="How the router gets online">
    <button
      v-for="u in USAGE"
      :key="u.value"
      type="button"
      role="radio"
      class="hk-use__opt"
      :class="{ 'is-on': s.draft.usage === u.value }"
      :aria-checked="s.draft.usage === u.value"
      @click="s.draft.usage = u.value"
    >
      <span class="hk-sec__icon"><HkIcon :name="u.icon" /></span>
      <span class="d-flex flex-column" style="min-width: 0">
        <span class="font-weight-bold" style="font-size: 15px">{{ u.title }}</span>
        <span class="hk-label">{{ u.text }}</span>
      </span>
      <HkIcon v-if="s.draft.usage === u.value" name="check" :size="20" class="hk-use__check" />
    </button>
  </div>

  <!-- 5G router: the WAN port has no uplink to carry, so it can be a LAN port. -->
  <div v-if="standalone && s.orig.wanPort" class="hk-sec">
    <div class="d-flex align-center ga-3">
      <span class="hk-sec__icon"><HkIcon name="ethernet" /></span>
      <div class="d-flex flex-column flex-grow-1">
        <span class="hk-h2" style="font-size: 18px">Use the WAN port as a LAN port</span>
        <span class="hk-label">{{ s.draft.wanAsLan ? 'Five LAN ports: plug a computer, switch or access point into any of them' : 'The WAN port stays unused' }}</span>
      </div>
      <M3Switch v-model="s.draft.wanAsLan" label="Use the WAN port as a LAN port" />
    </div>
    <v-alert v-if="s.draft.wanAsLan && s.carrier.value === true" type="warning" variant="tonal" density="compact">
      A cable is plugged into the WAN port. If it comes from your ISP’s box or another router, unplug it before you finish: as a LAN port it would join your network, and a second DHCP server there hands out addresses that don’t reach the internet.
    </v-alert>
    <span v-else-if="s.draft.wanAsLan" class="hk-label">The wired internet settings are kept, turned off, for the day you go back to a cable.</span>
  </div>

  <div v-if="!standalone" class="hk-sec">
    <div class="d-flex align-center ga-3">
      <span class="hk-sec__icon"><HkIcon name="ethernet" /></span>
      <div class="d-flex flex-column flex-grow-1">
        <span class="hk-h2" style="font-size: 18px">Cable from your ISP</span>
        <span class="hk-label">The router’s WAN port</span>
      </div>
      <span v-if="s.carrier.value === true" class="hk-chip hk-chip--tonal"><HkIcon name="check" :size="14" />Cable detected</span>
      <span v-else-if="s.carrier.value === false" class="hk-chip hk-chip--outline">No cable</span>
    </div>
    <SegmentedButton
      v-model="s.draft.wan.proto"
      label="Connection type"
      :options="[
        { value: 'dhcp', label: 'Automatic' },
        { value: 'pppoe', label: 'PPPoE' },
        { value: 'static', label: 'Static IP' },
      ]"
    />
    <p v-if="s.draft.wan.proto === 'dhcp'" class="hk-label" style="margin: 0">Right for most fibre boxes and cable modems. Not using the cable? Leave this as it is.</p>
    <template v-if="s.draft.wan.proto === 'pppoe'">
      <p class="hk-label" style="margin: 0">Your ISP gave you a username and password for this, often on a sticker or in the welcome letter.</p>
      <div class="hk-two">
        <v-text-field v-model="s.draft.wan.username" label="PPPoE username" autocomplete="off" hide-details="auto" :error-messages="e.username || undefined" />
        <SecretField v-model="s.draft.wan.password" label="PPPoE password" />
      </div>
    </template>
    <template v-if="s.draft.wan.proto === 'static'">
      <div class="hk-two">
        <v-text-field v-model="s.draft.wan.ipaddr" label="IP address" hide-details="auto" :error-messages="e.ipaddr || undefined" />
        <v-text-field v-model="s.draft.wan.netmask" label="Netmask" hide-details="auto" :error-messages="e.netmask || undefined" />
      </div>
      <div class="hk-two">
        <v-text-field v-model="s.draft.wan.gateway" label="Gateway" hide-details="auto" :error-messages="e.gateway || undefined" />
        <v-text-field v-model="s.draft.wan.dns" label="DNS servers" placeholder="1.1.1.1, 9.9.9.9" persistent-placeholder hide-details="auto" :error-messages="e.dns || undefined" />
      </div>
    </template>
    <div>
      <div class="hk-label mb-2">IP version</div>
      <SegmentedButton
        :model-value="s.draft.wan.ipv6 ? 'dual' : 'v4'"
        label="Wired IP version"
        :options="[
          { value: 'v4', label: 'IPv4' },
          { value: 'dual', label: 'IPv4 + IPv6' },
        ]"
        @update:model-value="s.draft.wan.ipv6 = $event === 'dual'"
      />
      <p class="hk-label mt-2" style="margin: 0">{{ s.draft.wan.ipv6 ? 'Asks the ISP for IPv6 as well; nothing is lost if it has none.' : 'IPv4 only, for an ISP whose IPv6 causes trouble.' }}</p>
    </div>
    <WanMacField v-if="s.orig.wanMac" v-model:mode="s.draft.mac.mode" v-model:value="s.draft.mac.value" :wan="s.orig.wanMac" :error="e.mac" />
  </div>

  <div v-if="s.hasModem.value" class="hk-sec">
    <div class="d-flex align-center ga-3">
      <span class="hk-sec__icon"><HkIcon name="cellular" /></span>
      <div class="d-flex flex-column flex-grow-1">
        <span class="hk-h2" style="font-size: 18px">5G SIM</span>
        <span class="hk-label">
          <template v-if="m?.sim === 'ready'">{{ operator || 'SIM ready' }}<template v-if="m.mode_label"> · {{ m.mode_label }}</template></template>
          <template v-else>Used as a backup, or on its own</template>
        </span>
      </div>
      <span v-if="m?.sim === 'ready'" class="hk-chip hk-chip--tonal"><HkIcon name="check" :size="14" />SIM ready</span>
      <span v-else class="hk-chip hk-chip--outline">{{ m ? 'No SIM' : 'Checking…' }}</span>
    </div>
    <SegmentedButton
      v-model="s.draft.apn.mode"
      label="Access point (APN)"
      :options="[
        { value: 'auto', label: 'Automatic' },
        { value: 'list', label: 'Choose carrier' },
        { value: 'custom', label: 'Custom APN' },
      ]"
    />
    <p v-if="s.draft.apn.mode === 'auto'" class="hk-label" style="margin: 0">The SIM and network pick the APN. Works for most carriers.</p>
    <v-select
      v-else-if="s.draft.apn.mode === 'list'"
      v-model="s.draft.apn.carrier"
      :items="carriers"
      label="Your carrier"
      no-data-text="No carriers listed for this country"
      hide-details="auto"
      :error-messages="s.apnError.value || undefined"
    />
    <template v-else>
      <v-text-field v-model="s.draft.apn.apn" label="APN" autocomplete="off" hide-details="auto" :error-messages="s.draft.apn.apn ? s.apnError.value || undefined : undefined" />
      <div class="hk-two">
        <v-select v-model="s.draft.apn.auth" :items="[{ value: 'none', title: 'No login' }, { value: 'pap', title: 'PAP' }, { value: 'chap', title: 'CHAP' }]" label="Login" hide-details />
        <v-text-field v-if="s.draft.apn.auth !== 'none'" v-model="s.draft.apn.username" label="Username" hide-details />
      </div>
      <SecretField v-if="s.draft.apn.auth !== 'none'" v-model="s.draft.apn.password" label="Password" />
    </template>
    <div v-if="s.orig.ipv6">
      <div class="hk-label mb-2">IP version (PDP type)</div>
      <SegmentedButton
        v-model="v6"
        label="5G IP version"
        :options="[
          { value: 'v4only', label: 'IPv4' },
          { value: 'dual', label: 'IPv4 + IPv6' },
          { value: 'v6only', label: 'IPv6' },
        ]"
      />
      <p class="hk-label mt-2" style="margin: 0">
        <template v-if="v6 === 'dual'">One data call carrying both. What nearly every carrier supports.</template>
        <template v-else-if="v6 === 'v4only'">No IPv6 on the 5G line. For a carrier that has none, where asking only slows the connection.</template>
        <template v-else>IPv6 only. IPv4 sites are reached through the carrier’s NAT64; only choose this if your carrier says so.</template>
        <template v-if="s.draft.v6style === 'split'"> Two data calls, one per family, as set on the Cellular page.</template>
      </p>
    </div>
  </div>
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
.hk-use {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.hk-use__opt {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 40px 16px 16px;
  border: 2px solid rgb(var(--v-theme-outline-variant));
  border-radius: 20px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.hk-use__opt.is-on {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}
.hk-use__opt.is-on .hk-label {
  color: inherit;
  opacity: 0.85;
}
.hk-use__check {
  position: absolute;
  top: 14px;
  right: 14px;
  color: rgb(var(--v-theme-primary));
}
.hk-use__opt:focus-visible {
  outline: 3px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}
.hk-two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 599.98px) {
  .hk-two,
  .hk-use {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
