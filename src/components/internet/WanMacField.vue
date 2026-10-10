<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import SegmentedButton from '@/components/m3/SegmentedButton.vue'
import { loadClients } from '@/api/clients'
import type { WanMac } from '@/api/wan'

// The WAN port's MAC, for an ISP that only lets a registered device connect:
// the port's own, or one typed in or copied from a device on the network -
// usually the computer or old router the ISP first saw. Used by the setup
// wizard and the Internet page's wired WAN card.
const props = defineProps<{ wan: WanMac; error?: string | null }>()
const mode = defineModel<'own' | 'custom'>('mode', { required: true })
const value = defineModel<string>('value', { required: true })

// The devices are read when "Custom" is first picked, not before: the list
// is only for copying from.
const devices = ref<{ value: string; title: string; subtitle?: string }[] | null>(null)
const loading = ref(false)
watch(
  mode,
  async (m) => {
    if (m !== 'custom' || devices.value || loading.value) return
    loading.value = true
    const list = await loadClients().catch(() => [])
    loading.value = false
    devices.value = list
      .filter((c) => !c.guest)
      .map((c) => {
        const mac = c.mac.toUpperCase()
        return { value: mac, title: c.name ? `${c.name} · ${mac}` : mac, subtitle: c.ip ?? undefined }
      })
  },
  { immediate: true },
)

// with no override, what the port has now is its own address
const own = computed(() => (props.wan.mac ? null : props.wan.current))
function copy(mac: string | null): void {
  if (mac) value.value = mac
}
</script>

<template>
  <div class="d-flex flex-column ga-2">
    <div class="hk-label">MAC address</div>
    <SegmentedButton
      v-model="mode"
      label="WAN MAC address"
      :options="[
        { value: 'own', label: 'Router’s own' },
        { value: 'custom', label: 'Custom' },
      ]"
    />
    <p v-if="mode === 'own'" class="hk-label" style="margin: 0">
      The WAN port uses its built-in address<template v-if="own"> ({{ own }})</template>. Right unless your ISP only lets a registered device connect.
    </p>
    <template v-else>
      <p class="hk-label" style="margin: 0">
        For an ISP that only lets a registered device connect: give the WAN port that device’s MAC, often the computer or old router the ISP first saw. Copy it
        from a device here, or type the one the ISP has on file.
      </p>
      <div class="hk-mac-two">
        <v-text-field
          v-model="value"
          label="MAC address"
          placeholder="00:11:22:AA:BB:CC"
          persistent-placeholder
          autocomplete="off"
          spellcheck="false"
          hide-details="auto"
          :error-messages="error || undefined"
        />
        <v-select
          :model-value="null"
          :items="devices ?? []"
          :loading="loading"
          label="Copy from a device"
          no-data-text="No devices seen on the network yet"
          hide-details
          @update:model-value="copy"
        />
      </div>
      <p v-if="wan.current" class="hk-label" style="margin: 0">In use now: {{ wan.current }}. The wired internet reconnects with the new address when it’s saved.</p>
    </template>
  </div>
</template>

<style scoped>
.hk-mac-two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 599.98px) {
  .hk-mac-two {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
