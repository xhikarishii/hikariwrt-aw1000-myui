<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import M3Switch from '@/components/m3/M3Switch.vue'
import SecretField from '@/components/m3/SecretField.vue'
import SegmentedButton from '@/components/m3/SegmentedButton.vue'
import WanMacField from '@/components/internet/WanMacField.vue'
import { saveWan, saveWanMac, wanMac, type WanConfig, type WanMac } from '@/api/wan'
import type { UplinkView } from '@/utils/uplinks'
import { useAction } from '@/composables/action'
import { useConfirm } from '@/composables/confirm'
import { dnsError, ipError, macError, mtuError, netmaskError, normalizeMac, parseList } from '@/utils/validate'
import { duration } from '@/utils/format'

// Wired WAN: how it connects (DHCP, PPPoE, static) and the few extras people
// actually change (DNS, MTU, IPv6, and the MAC an ISP may insist on). Saving
// reconnects only the WAN; the LAN and this page stay up, so no rollback
// timer is needed.
const props = defineProps<{ config: WanConfig | null; link: UplinkView | null }>()
const emit = defineEmits<{ saved: [] }>()
const { busy, run } = useAction()
const { ask } = useConfirm()

const form = reactive({ proto: 'dhcp', username: '', password: '', ipaddr: '', netmask: '255.255.255.0', gateway: '', dns: '', mtu: '', ipv6: true })
const advanced = ref(false)

// The WAN port's MAC lives on its network device, not in the interface
// settings the page hands this card, so the card reads it itself.
const mac = ref<WanMac | null>(null)
const macForm = reactive({ mode: 'own' as 'own' | 'custom', value: '' })
async function loadMac(): Promise<void> {
  mac.value = await wanMac()
  resetMac()
}
function resetMac(): void {
  macForm.mode = mac.value?.mac ? 'custom' : 'own'
  macForm.value = mac.value?.mac ?? ''
  if (mac.value?.mac) advanced.value = true
}
onMounted(loadMac)
/** the MAC to save: "" for the port's own */
const macNext = computed(() => (macForm.mode === 'custom' ? (normalizeMac(macForm.value) ?? '') : ''))
const macDirty = computed(() => !!mac.value && macNext.value !== mac.value.mac)

function reset(): void {
  const c = props.config
  if (!c) return
  Object.assign(form, { ...c, dns: c.dns.join(', ') })
  advanced.value = !!(c.dns.length || c.mtu || !c.ipv6 || mac.value?.mac)
  resetMac()
}
watch(() => props.config, reset, { immediate: true })
// Static needs DNS servers, which live in the collapsed section: open it so
// the error is visible rather than just a disabled Save.
watch(
  () => form.proto,
  (p) => {
    if (p === 'static' && !form.dns.trim()) advanced.value = true
  },
)

const errors = computed(() => ({
  username: form.proto === 'pppoe' && !form.username.trim() ? 'Required' : null,
  ipaddr: form.proto === 'static' ? ipError(form.ipaddr) : null,
  netmask: form.proto === 'static' ? netmaskError(form.netmask) : null,
  gateway: form.proto === 'static' ? ipError(form.gateway) : null,
  dns: form.dns.trim() ? dnsError(form.dns) : form.proto === 'static' ? 'Static needs at least one DNS server' : null,
  mtu: mtuError(form.mtu),
  mac: macForm.mode === 'custom' && mac.value ? macError(macForm.value) : null,
}))
const valid = computed(() => Object.values(errors.value).every((e) => !e))

const next = computed<WanConfig>(() => ({
  proto: form.proto,
  username: form.username.trim(),
  password: form.password,
  ipaddr: form.ipaddr.trim(),
  netmask: form.netmask.trim(),
  gateway: form.gateway.trim(),
  dns: parseList(form.dns),
  mtu: form.mtu.trim(),
  ipv6: form.ipv6,
}))
const wanDirty = computed(() => {
  const c = props.config
  if (!c) return false
  const n = next.value
  const same = (keys: (keyof WanConfig)[]) => keys.every((k) => JSON.stringify(n[k]) === JSON.stringify(c[k]))
  const common = same(['proto', 'dns', 'mtu', 'ipv6'])
  if (n.proto === 'pppoe') return !(common && same(['username', 'password']))
  if (n.proto === 'static') return !(common && same(['ipaddr', 'netmask', 'gateway']))
  return !common
})
const dirty = computed(() => wanDirty.value || macDirty.value)

async function save(): Promise<void> {
  const ok = await ask({
    title: 'Save wired WAN settings?',
    text:
      'The wired WAN reconnects with the new settings. If 5G is set up as a backup, multi-WAN switches to it until the wired link is back.' +
      (form.proto !== props.config?.proto ? `\n\nSwitching to ${form.proto.toUpperCase()}: make sure your ISP expects it, or the wired link won't come up.` : '') +
      (macDirty.value
        ? macNext.value
          ? `\n\nThe WAN port takes the MAC ${macNext.value}. If your ISP only accepts a registered address, this has to be the one it has on file.`
          : '\n\nThe WAN port goes back to its own MAC. If your ISP only accepts a registered address, the wired link may not come up.'
        : ''),
    confirm: 'Save',
  })
  if (!ok) return
  // The MAC first, so the WAN asks for its lease (or dials) with the address
  // the ISP expects.
  const done = await run(
    'save',
    async () => {
      if (macDirty.value && mac.value) await saveWanMac(mac.value, macNext.value)
      if (wanDirty.value) await saveWan(next.value)
    },
    'Wired WAN settings saved; reconnecting',
  )
  // re-read only on success: a refused save keeps what was typed
  if (done) {
    await loadMac()
    emit('saved')
  }
}
</script>

<template>
  <section class="hk-card" aria-label="Wired WAN settings" style="gap: 14px">
    <div class="d-flex align-center flex-wrap ga-2">
      <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
        <h2 class="hk-h2">Wired WAN</h2>
        <span class="text-muted" style="font-size: 13px">
          <template v-if="link && link.state !== 'down'">{{ link.proto }} · {{ link.ipv4 }} · gateway {{ link.gateway ?? '—' }} · up {{ duration(link.uptime) }}</template>
          <template v-else>Not connected</template>
        </span>
      </div>
      <template v-if="link">
        <span v-if="link.state !== 'down'" class="hk-chip hk-chip--tonal"><HkIcon name="check" :size="14" />Connected</span>
        <span v-else class="hk-chip hk-chip--error">Down</span>
      </template>
    </div>

    <template v-if="config">
      <SegmentedButton
        v-model="form.proto"
        label="Connection type"
        :options="[
          { value: 'dhcp', label: 'Automatic (DHCP)' },
          { value: 'pppoe', label: 'PPPoE' },
          { value: 'static', label: 'Static IP' },
        ]"
      />
      <p v-if="form.proto === 'dhcp'" class="text-muted" style="font-size: 14px; margin: 0">The ISP’s equipment hands out the address. Right for most fibre and cable boxes.</p>

      <div v-if="form.proto === 'pppoe'" class="hk-two">
        <v-text-field v-model="form.username" label="PPPoE username" autocomplete="off" spellcheck="false" hide-details="auto" :error-messages="errors.username || undefined" />
        <SecretField v-model="form.password" label="PPPoE password" />
      </div>

      <template v-if="form.proto === 'static'">
        <div class="hk-two">
          <v-text-field v-model="form.ipaddr" label="IP address" hide-details="auto" :error-messages="errors.ipaddr || undefined" />
          <v-text-field v-model="form.netmask" label="Netmask" hide-details="auto" :error-messages="errors.netmask || undefined" />
        </div>
        <v-text-field v-model="form.gateway" label="Gateway" hide-details="auto" :error-messages="errors.gateway || undefined" />
      </template>

      <button type="button" class="hk-disclose" :aria-expanded="advanced ? 'true' : 'false'" @click="advanced = !advanced">
        <HkIcon name="arrowRight" :size="18" :style="{ transform: advanced ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }" />
        DNS, MTU, IPv6 and MAC address
      </button>
      <v-expand-transition>
        <div v-show="advanced" class="d-flex flex-column ga-3">
          <v-text-field
            v-model="form.dns"
            label="DNS servers"
            :placeholder="form.proto === 'static' ? '1.1.1.1, 9.9.9.9' : 'From your ISP'"
            persistent-placeholder
            hide-details="auto"
            :error-messages="errors.dns || undefined"
          />
          <div class="hk-two">
            <v-text-field v-model="form.mtu" label="MTU" :placeholder="form.proto === 'pppoe' ? '1492' : '1500'" persistent-placeholder inputmode="numeric" hide-details="auto" :error-messages="errors.mtu || undefined" />
            <div class="d-flex align-center ga-3">
              <span class="flex-grow-1" style="font-size: 14px">IPv6 on this WAN</span>
              <M3Switch v-model="form.ipv6" label="IPv6 on the wired WAN" />
            </div>
          </div>
          <WanMacField v-if="mac" v-model:mode="macForm.mode" v-model:value="macForm.value" :wan="mac" :error="errors.mac" />
        </div>
      </v-expand-transition>

      <div class="d-flex justify-end ga-2">
        <v-btn variant="text" color="primary" height="40" :disabled="!dirty" @click="reset">Undo changes</v-btn>
        <v-btn variant="flat" color="primary" height="40" :disabled="!dirty || !valid" :loading="busy.save" @click="save">Save</v-btn>
      </div>
    </template>
    <v-skeleton-loader v-else type="text@4" bg-color="transparent" />
  </section>
</template>

<style scoped>
.hk-two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 599.98px) {
  .hk-two {
    grid-template-columns: minmax(0, 1fr);
  }
}
.hk-disclose {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 12px 0 8px;
  margin-left: -8px;
  border: 0;
  border-radius: 20px;
  background: transparent;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
}
.hk-disclose:hover {
  background: rgba(var(--v-theme-primary), 0.08);
}
</style>
