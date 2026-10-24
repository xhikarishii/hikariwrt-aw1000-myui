<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import HkIcon from '@/components/icons/HkIcon.vue'
import M3Switch from '@/components/m3/M3Switch.vue'
import { savePort, type NetworksData } from '@/api/networks'
import { useAction } from '@/composables/action'
import { useConfirm } from '@/composables/confirm'
import { HOME_VID, portProfile, suggestedVids, validatePort, type LanPort, type PortProfile } from '@/utils/networks'

// One LAN port's VLANs: the network it carries untagged (Home, another
// network, or none), and the ones it carries tagged - picked one by one, or
// all of them as a trunk, which also takes networks made later. Applies with
// rollback: the port may be the one this browser is plugged into.
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ data: NetworksData; port: LanPort | null }>()
const emit = defineEmits<{ saved: [] }>()
const { xs } = useDisplay()
const { busy, run } = useAction()
const { ask } = useConfirm()

const form = ref<PortProfile>({ native: 'lan', tagged: [], trunk: false })
watch(open, (o) => {
  if (o && props.port) form.value = JSON.parse(JSON.stringify(portProfile(props.data.model, props.port)))
})

const name = computed(() => (props.port ? `LAN ${props.port.slice(3)}` : ''))
const sugg = computed(() => suggestedVids(props.data.model))
const nets = computed(() => props.data.model.networks.map((n) => ({ id: n.id, label: n.label, vid: n.vid ?? sugg.value[n.id] ?? null })))
const natives = computed(() => [
  { value: 'lan', title: 'Home', sub: `VLAN ${HOME_VID} · your main network` },
  ...nets.value.map((n) => ({ value: n.id, title: n.label, sub: `VLAN ${n.vid ?? '?'}` })),
  { value: 'none', title: 'None', sub: 'Tagged networks only, for a switch or access point that tags everything' },
])
// The untagged network can't also be tagged on the same port.
const taggable = computed(() => nets.value.filter((n) => n.id !== form.value.native))
const isTagged = (id: string) => form.value.trunk || form.value.tagged.includes(id)
function toggle(id: string): void {
  const t = form.value.tagged
  form.value.tagged = t.includes(id) ? t.filter((x) => x !== id) : [...t, id]
}
const profile = computed<PortProfile>(() => ({ ...form.value, tagged: form.value.trunk ? [] : form.value.tagged.filter((id) => id !== form.value.native) }))
const error = computed(() => (props.port ? validatePort(props.data.model, props.port, profile.value) : null))
const dirty = computed(() => !!props.port && JSON.stringify(profile.value) !== JSON.stringify(portProfile(props.data.model, props.port)))

async function save(): Promise<void> {
  const p = props.port
  if (!p) return
  const f = profile.value
  const nativeName = natives.value.find((n) => n.value === f.native)?.title ?? f.native
  const tagged = f.trunk ? taggable.value : taggable.value.filter((n) => f.tagged.includes(n.id))
  const lines = [
    f.native === 'none' ? `${name.value} carries no untagged network.` : `${name.value} carries ${nativeName} untagged.`,
    f.trunk
      ? `It carries every other network tagged (${tagged.map((n) => `VLAN ${n.vid}`).join(', ') || 'none yet'}), and new networks join it.`
      : tagged.length
        ? `It carries ${tagged.map((n) => `${n.label} as VLAN ${n.vid}`).join(', ')} tagged.`
        : '',
    'Whatever is plugged in there may get a new address. If this device is connected through that port and loses the router, it undoes the change after 90 seconds.',
  ].filter(Boolean)
  const ok = await ask({ title: `Change ${name.value}?`, text: lines.join('\n\n'), confirm: 'Apply' })
  if (!ok) return
  if (await run('port', () => savePort(props.data, p, f), `${name.value} saved`)) {
    open.value = false
    emit('saved')
  }
}
</script>

<template>
  <v-dialog v-model="open" :fullscreen="xs" max-width="560" scrollable>
    <v-card color="surface-container-high" :rounded="xs ? 0 : 'xl'">
      <v-card-title class="d-flex align-center ga-3 pa-5 pb-3">
        <span class="hk-h2 flex-grow-1" style="font-size: 22px">{{ name }}</span>
        <v-btn icon variant="text" aria-label="Close" @click="open = false"><HkIcon name="close" /></v-btn>
      </v-card-title>

      <v-card-text class="pa-5 pt-1 d-flex flex-column ga-4">
        <section class="hk-pd__sec" aria-label="Untagged network">
          <div class="d-flex flex-column">
            <span class="hk-pd__title">Untagged network</span>
            <span class="hk-label">What a computer, printer or plain switch plugged in here joins</span>
          </div>
          <v-radio-group v-model="form.native" hide-details density="comfortable">
            <v-radio v-for="n in natives" :key="n.value" :value="n.value">
              <template #label>
                <span class="d-flex flex-column">
                  <span style="font-size: 14px">{{ n.title }}</span>
                  <span class="hk-label">{{ n.sub }}</span>
                </span>
              </template>
            </v-radio>
          </v-radio-group>
        </section>

        <section class="hk-pd__sec" aria-label="Tagged networks">
          <div class="d-flex align-center ga-3">
            <div class="d-flex flex-column flex-grow-1">
              <span class="hk-pd__title">All networks (trunk)</span>
              <span class="hk-label">Carries every other network tagged, including ones made later: for a managed switch or access point</span>
            </div>
            <M3Switch v-model="form.trunk" label="All networks (trunk)" />
          </div>
          <div v-if="taggable.length">
            <div class="hk-label mb-2">{{ form.trunk ? 'Carried tagged' : 'Tagged networks' }}</div>
            <div class="d-flex flex-wrap ga-2" role="group" aria-label="Tagged networks">
              <button
                v-for="n in taggable"
                :key="n.id"
                type="button"
                class="hk-filter"
                :class="{ 'is-on': isTagged(n.id) }"
                :aria-pressed="isTagged(n.id) ? 'true' : 'false'"
                :disabled="form.trunk"
                @click="toggle(n.id)"
              >
                <HkIcon v-if="isTagged(n.id)" name="check" :size="16" :stroke="2.6" />{{ n.label }} · VLAN {{ n.vid ?? '?' }}
              </button>
            </div>
          </div>
          <span v-else class="hk-label">No other networks yet. Add one on the Networks page and it can be carried here.</span>
        </section>

        <p v-if="error" class="text-error" style="font-size: 13px; margin: 0">{{ error }}</p>
      </v-card-text>

      <v-card-actions class="pa-5 pt-2">
        <v-spacer />
        <v-btn variant="text" height="40" @click="open = false">Cancel</v-btn>
        <v-btn variant="flat" color="primary" height="40" :disabled="!dirty || !!error" :loading="busy.port" @click="save">Apply</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.hk-pd__sec {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 20px;
  background: rgb(var(--v-theme-surface-container-low));
}
.hk-pd__title {
  font-size: 15px;
  font-weight: 600;
}
.hk-filter {
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid rgb(var(--v-theme-outline));
  background: transparent;
  color: rgb(var(--v-theme-on-surface-muted));
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.hk-filter.is-on {
  padding-left: 8px;
  border-color: rgb(var(--v-theme-secondary-container));
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}
.hk-filter:disabled {
  cursor: default;
  opacity: 0.8;
}
</style>
