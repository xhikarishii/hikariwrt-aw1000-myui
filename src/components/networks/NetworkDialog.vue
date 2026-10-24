<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import HkIcon from '@/components/icons/HkIcon.vue'
import NetworkForm from '@/components/networks/NetworkForm.vue'
import { contextFor, saveNetwork, type NetworksData } from '@/api/networks'
import { useAction } from '@/composables/action'
import { useConfirm } from '@/composables/confirm'
import { useSession } from '@/stores/session'
import { generatePassword } from '@/utils/validate'
import {
  freeId,
  isLegacyGuestFree,
  KIND_INFO,
  LAN_PORTS,
  movesPorts,
  pickFreePrefix,
  pickVid,
  preset,
  suggestedVids,
  validate,
  type NetKind,
  type NetworkSpec,
} from '@/utils/networks'

// Add or edit one network. A new one starts from what it is for (guests,
// smart home, trusted, custom), which fills in sensible settings; then the
// form. Saving explains what restarts, and applies with rollback.
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ data: NetworksData; edit: NetworkSpec | null }>()
const emit = defineEmits<{ saved: [] }>()
const { xs } = useDisplay()
const { busy, run } = useAction()
const { ask } = useConfirm()
const session = useSession()

const spec = ref<NetworkSpec | null>(null)
const isNew = computed(() => !props.edit)
const KINDS: { kind: NetKind; icon: 'guest' | 'iot' | 'shield' | 'networks' }[] = [
  { kind: 'iot', icon: 'iot' },
  { kind: 'guest', icon: 'guest' },
  { kind: 'trusted', icon: 'shield' },
  { kind: 'custom', icon: 'networks' },
]

watch(open, (o) => {
  if (!o) return
  spec.value = props.edit ? JSON.parse(JSON.stringify(props.edit)) : null
  // made before networks had a VLAN ID: saving gives it the suggested one
  if (spec.value && spec.value.vid == null) spec.value.vid = suggestedVids(props.data.model)[spec.value.id] ?? null
})

function start(kind: NetKind): void {
  const d = props.data
  const legacy = kind === 'guest' && isLegacyGuestFree(d.snapshot)
  const taken = new Set([...d.ids, ...d.model.networks.map((n) => n.id)])
  const id = legacy ? 'guest' : freeId(kind, taken)
  const used = [...d.prefixes, ...d.model.networks.map((n) => n.prefix)]
  const prefix = pickFreePrefix(used)
  const vids = [...d.model.networks.flatMap((n) => (n.vid != null ? [n.vid] : [])), ...Object.values(suggestedVids(d.model))]
  spec.value = {
    ...preset(kind, id, {
      hostname: session.board?.hostname ?? 'HikariWrt',
      radios: d.radios,
      prefix,
      password: generatePassword(),
      vid: pickVid(prefix, vids),
      trunkPorts: LAN_PORTS.filter((p) => d.model.portMeta[p].trunk),
    }),
    ...(legacy ? { legacy: true } : {}),
  }
}

const errors = computed(() => (spec.value ? validate(spec.value, props.data.model, contextFor(props.data, spec.value, isNew.value)) : {}))
const valid = computed(() => !!spec.value && Object.keys(errors.value).length === 0)

const BAND: Record<string, string> = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz' }
async function save(): Promise<void> {
  const s = spec.value
  if (!s) return
  const moves = movesPorts(props.data.model, s)
  const bands = s.wifi.enabled ? s.wifi.radios.map((r) => BAND[props.data.radios.find((x) => x.name === r)?.band ?? ''] ?? r).join(' and ') : ''
  const untagged = LAN_PORTS.filter((p) => s.ports[p] === 'untagged').map((p) => `LAN ${p.slice(3)}`)
  const tagged = LAN_PORTS.filter((p) => s.ports[p] === 'tagged').map((p) => `LAN ${p.slice(3)}`)
  const lines = [
    isNew.value ? `Creates “${s.label}” as VLAN ${s.vid}, with addresses ${s.prefix}.x.` : `Saves “${s.label}” (VLAN ${s.vid}).`,
    tagged.length ? `${tagged.join(', ')} ${tagged.length === 1 ? 'carries' : 'carry'} it tagged as VLAN ${s.vid}: set the same on the switch or access point there.` : '',
    s.wifi.enabled ? `Wi-Fi “${s.wifi.ssid}” on ${bands}: Wi-Fi on those bands restarts, and devices on it drop for a few seconds.` : '',
    untagged.length ? `${untagged.join(', ')} ${untagged.length === 1 ? 'joins' : 'join'} this network: whatever is plugged in there gets a new address.` : '',
    moves
      ? 'Ports change. If this device is plugged into one of them, it loses its connection; unless the router hears back from you within 90 seconds, it undoes the whole change.'
      : 'If the router can’t hear back from you within a minute, it undoes the whole change.',
  ].filter(Boolean)
  const ok = await ask({ title: isNew.value ? `Create ${s.label}?` : `Save ${s.label}?`, text: lines.join('\n\n'), confirm: isNew.value ? 'Create' : 'Save' })
  if (!ok) return
  if (await run('save', () => saveNetwork(props.data, s), isNew.value ? `${s.label} is set up` : `${s.label} saved`)) {
    open.value = false
    emit('saved')
  }
}
</script>

<template>
  <v-dialog v-model="open" :fullscreen="xs" max-width="680" scrollable>
    <v-card color="surface-container-high" :rounded="xs ? 0 : 'xl'">
      <v-card-title class="d-flex align-center ga-3 pa-5 pb-3">
        <span class="hk-h2 flex-grow-1" style="font-size: 22px">{{ !spec ? 'Add a network' : isNew ? `New network: ${KIND_INFO[spec.kind].title}` : spec.label }}</span>
        <v-btn icon variant="text" aria-label="Close" @click="open = false"><HkIcon name="close" /></v-btn>
      </v-card-title>

      <v-card-text class="pa-5 pt-1">
        <!-- What it is for -->
        <div v-if="!spec" class="hk-kinds" role="list">
          <p class="text-muted" style="font-size: 14px; margin: 0 0 4px">What is the network for? It sets everything up to suit, and you can change any of it next.</p>
          <button v-for="k in KINDS" :key="k.kind" type="button" class="hk-kind" role="listitem" @click="start(k.kind)">
            <span class="hk-kind__icon"><HkIcon :name="k.icon" /></span>
            <span class="d-flex flex-column flex-grow-1" style="min-width: 0">
              <span style="font-size: 15px; font-weight: 600">{{ KIND_INFO[k.kind].title }}</span>
              <span class="hk-label">{{ KIND_INFO[k.kind].text }}</span>
            </span>
            <HkIcon name="chevronRight" :size="18" />
          </button>
        </div>
        <NetworkForm v-else v-model="spec" :errors="errors" :radios="data.radios" :model="data.model" :fresh="isNew" />
      </v-card-text>

      <v-card-actions v-if="spec" class="pa-5 pt-2">
        <v-btn v-if="isNew" variant="text" height="40" @click="spec = null">Back</v-btn>
        <v-spacer />
        <v-btn variant="text" height="40" @click="open = false">Cancel</v-btn>
        <v-btn variant="flat" color="primary" height="40" :disabled="!valid" :loading="busy.save" @click="save">{{ isNew ? 'Create' : 'Save' }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.hk-kinds {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hk-kind {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 20px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  background: rgb(var(--v-theme-surface-container-low));
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.hk-kind:hover {
  background: rgb(var(--v-theme-secondary-container), 0.5);
}
.hk-kind:focus-visible {
  outline: 3px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}
.hk-kind__icon {
  width: 44px;
  height: 44px;
  border-radius: 22px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}
</style>
