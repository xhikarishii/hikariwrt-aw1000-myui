<script setup lang="ts">
import { computed } from 'vue'
import HkIcon from '@/components/icons/HkIcon.vue'
import M3Switch from '@/components/m3/M3Switch.vue'
import SecretField from '@/components/m3/SecretField.vue'
import SegmentedButton from '@/components/m3/SegmentedButton.vue'
import { generatePassword } from '@/utils/validate'
import { LAN_PORTS, type Errors, type LanPort, type Model, type NetworkSpec, type PortMode } from '@/utils/networks'

// One network's settings: name and range, its Wi-Fi, which LAN ports carry
// it (untagged: the port leaves Home and joins this network; tagged: the
// port stays on Home and carries this network as VLAN <id> too, for a
// managed switch or an access point), what it may reach, and - for a smart
// home network - the settings IoT devices connect best with. Edits the spec
// in place; the dialog or wizard step around it saves.
const spec = defineModel<NetworkSpec>({ required: true })
const props = defineProps<{
  errors: Errors
  radios: { name: string; band: string; disabled: boolean }[]
  model: Model | null
  /** the wizard's shorter form: no range or advanced access */
  compact?: boolean
}>()

const BAND: Record<string, string> = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz' }
const SECURITY = [
  { value: 'sae-mixed', title: 'WPA2 / WPA3' },
  { value: 'psk2', title: 'WPA2' },
  { value: 'sae', title: 'WPA3' },
  { value: 'none', title: 'None (open)' },
]
const iot = computed(() => spec.value.kind === 'iot')
const compatLocked = computed(() => iot.value && spec.value.iot.compat)
const security = computed(() => (compatLocked.value ? SECURITY.filter((s) => s.value === 'psk2' || s.value === 'none') : SECURITY))

const PORT_OPTS: { value: PortMode; label: string }[] = [
  { value: 'off', label: 'Not used' },
  { value: 'untagged', label: 'Untagged' },
  { value: 'tagged', label: 'Tagged' },
]
/** Where a port is now, other than this network: "Home", "Guest", a foreign bridge. */
function ownerOf(p: LanPort): string {
  const m = props.model
  if (!m) return ''
  const other = m.networks.find((n) => n.id !== spec.value.id && n.ports[p] === 'untagged')
  if (other) return other.label
  const foreign = m.foreign.find((b) => b.ports.includes(p))
  if (foreign) return foreign.name
  return 'Home'
}
function portLine(p: LanPort): string {
  const mode = spec.value.ports[p]
  const owner = ownerOf(p)
  if (mode === 'untagged') return owner === 'Home' ? 'Leaves Home: whatever is plugged in joins this network' : `Moves here from ${owner}`
  if (mode === 'tagged') return `Stays on ${owner}, and carries this network as VLAN ${spec.value.vid ?? '?'} for a switch or access point`
  return `On ${owner}`
}
const anyTagged = computed(() => LAN_PORTS.some((p) => spec.value.ports[p] === 'tagged'))
const vidText = computed({
  get: () => (spec.value.vid == null ? '' : String(spec.value.vid)),
  set: (v: string) => (spec.value.vid = v.trim() === '' ? null : Number(v)),
})

function toggleRadio(name: string): void {
  const r = spec.value.wifi.radios
  spec.value.wifi.radios = r.includes(name) ? r.filter((x) => x !== name) : [...r, name]
}
// WPA2 for old IoT radios: switching compat on brings the security with it.
function setCompat(on: boolean): void {
  spec.value.iot.compat = on
  if (on && spec.value.wifi.encryption !== 'none') spec.value.wifi.encryption = 'psk2'
}
</script>

<template>
  <div class="hk-nf">
    <!-- Name and range -->
    <div class="hk-nf__row">
      <v-text-field v-model="spec.label" label="Name" hide-details="auto" :error-messages="errors.label || undefined" />
      <v-text-field
        v-if="!compact"
        v-model="spec.prefix"
        label="Address range"
        suffix=".0/24"
        hide-details="auto"
        :error-messages="errors.prefix || undefined"
        :hint="`The router is ${spec.prefix}.1, devices get ${spec.prefix}.100 – .249`"
        persistent-hint
      />
    </div>

    <!-- Wi-Fi -->
    <section class="hk-nf__sec" aria-label="Wi-Fi">
      <div class="d-flex align-center ga-3">
        <HkIcon name="wifi" :size="20" />
        <div class="d-flex flex-column flex-grow-1">
          <span class="hk-nf__title">Its own Wi-Fi</span>
          <span class="hk-label">A Wi-Fi name that puts devices on this network</span>
        </div>
        <M3Switch v-model="spec.wifi.enabled" label="Its own Wi-Fi" />
      </div>
      <template v-if="spec.wifi.enabled">
        <v-text-field v-model="spec.wifi.ssid" label="Wi-Fi name" hide-details="auto" :error-messages="errors.ssid || undefined" />
        <v-select v-model="spec.wifi.encryption" :items="security" label="Security" hide-details :hint="compatLocked ? 'WPA2 only: many smart-home devices can’t join WPA3' : undefined" :persistent-hint="compatLocked" />
        <div v-if="spec.wifi.encryption !== 'none'" class="d-flex align-start ga-2">
          <SecretField v-model="spec.wifi.key" label="Password" :error-messages="errors.key" class="flex-grow-1" />
          <v-btn icon variant="text" width="56" height="56" aria-label="Make a new password" title="Make a new password" @click="spec.wifi.key = generatePassword()">
            <HkIcon name="refresh" />
          </v-btn>
        </div>
        <div>
          <div class="hk-label mb-2">Bands</div>
          <div class="d-flex flex-wrap ga-2" role="group" aria-label="Bands">
            <button
              v-for="r in radios"
              :key="r.name"
              type="button"
              class="hk-filter"
              :class="{ 'is-on': spec.wifi.radios.includes(r.name) }"
              :aria-pressed="spec.wifi.radios.includes(r.name) ? 'true' : 'false'"
              @click="toggleRadio(r.name)"
            >
              <HkIcon v-if="spec.wifi.radios.includes(r.name)" name="check" :size="16" :stroke="2.6" />{{ BAND[r.band] ?? r.band }}
            </button>
          </div>
          <div v-if="errors.radios" class="text-error mt-1" style="font-size: 12px">{{ errors.radios }}</div>
          <div v-else-if="iot" class="hk-label mt-1">Most smart-home devices only have 2.4 GHz.</div>
        </div>
        <div class="d-flex align-center ga-3">
          <div class="d-flex flex-column flex-grow-1">
            <span style="font-size: 14px">Keep devices apart</span>
            <span class="hk-label">Wi-Fi devices on this network can’t reach each other{{ iot ? ' (leave off if your devices talk to a hub or to each other)' : '' }}</span>
          </div>
          <M3Switch v-model="spec.wifi.isolate" label="Keep devices apart" />
        </div>
      </template>
    </section>

    <!-- Wired ports -->
    <section class="hk-nf__sec" aria-label="Wired ports">
      <div class="d-flex align-center ga-3">
        <HkIcon name="ethernet" :size="20" />
        <div class="d-flex flex-column flex-grow-1">
          <span class="hk-nf__title">Wired ports</span>
          <span class="hk-label">Untagged: the port joins this network. Tagged: it stays on its network and carries this one as a VLAN too.</span>
        </div>
      </div>
      <div v-for="p in LAN_PORTS" :key="p" class="hk-nf__port">
        <div class="d-flex flex-column" style="min-width: 0; flex: 1 1 160px">
          <span style="font-size: 14px; font-weight: 600">LAN {{ p.slice(3) }}</span>
          <span class="hk-label">{{ portLine(p) }}</span>
        </div>
        <SegmentedButton v-model="spec.ports[p]" :options="PORT_OPTS" :label="`LAN ${p.slice(3)}`" class="hk-nf__seg" />
      </div>
      <v-text-field
        v-if="anyTagged || spec.vid != null"
        v-model="vidText"
        label="VLAN ID"
        inputmode="numeric"
        hide-details="auto"
        style="max-width: 200px"
        :error-messages="errors.vid || undefined"
        hint="2 – 4094; set the same on your switch or access point"
        persistent-hint
      />
      <div v-if="errors.ports" class="text-error" style="font-size: 13px">{{ errors.ports }}</div>
    </section>

    <!-- What it may reach -->
    <section class="hk-nf__sec" aria-label="Access">
      <div class="d-flex align-center ga-3">
        <HkIcon name="shield" :size="20" />
        <span class="hk-nf__title flex-grow-1">What it may reach</span>
      </div>
      <div class="hk-nf__sw">
        <div class="d-flex flex-column flex-grow-1">
          <span style="font-size: 14px">Internet</span>
          <span class="hk-label">{{ iot ? 'Off keeps local-only devices (cameras, sensors) from talking to the cloud' : 'Devices can go online' }}</span>
        </div>
        <M3Switch v-model="spec.access.internet" label="Internet" />
      </div>
      <div class="hk-nf__sw">
        <div class="d-flex flex-column flex-grow-1">
          <span style="font-size: 14px">Home can reach it</span>
          <span class="hk-label">Phones and computers on Home can open and control these devices</span>
        </div>
        <M3Switch v-model="spec.access.fromHome" label="Home can reach it" />
      </div>
      <div class="hk-nf__sw">
        <div class="d-flex flex-column flex-grow-1">
          <span style="font-size: 14px">It can reach Home</span>
          <span class="hk-label">Devices here can open anything on Home{{ iot ? ': usually best left off' : '' }}</span>
        </div>
        <M3Switch v-model="spec.access.toHome" label="It can reach Home" />
      </div>
      <div v-if="!compact" class="hk-nf__sw">
        <div class="d-flex flex-column flex-grow-1">
          <span style="font-size: 14px">Router settings</span>
          <span class="hk-label">Devices here can open this router’s pages and SSH. Off still lets them get an address and look up names.</span>
        </div>
        <M3Switch v-model="spec.access.router" label="Router settings" />
      </div>
    </section>

    <!-- IoT tuning -->
    <section v-if="iot" class="hk-nf__sec hk-nf__iot" aria-label="Smart-home settings">
      <div class="d-flex align-center ga-3">
        <HkIcon name="iot" :size="20" />
        <div class="d-flex flex-column flex-grow-1">
          <span class="hk-nf__title">Tuned for smart-home devices</span>
          <span class="hk-label">What cheap Wi-Fi chips and battery devices connect and stay connected best with</span>
        </div>
      </div>
      <div class="hk-nf__sw">
        <div class="d-flex flex-column flex-grow-1">
          <span style="font-size: 14px">Works with older devices</span>
          <span class="hk-label">WPA2 only, no protected management frames, no fast roaming (802.11r): the features older chips fail to join with</span>
        </div>
        <M3Switch :model-value="spec.iot.compat" label="Works with older devices" @update:model-value="setCompat" />
      </div>
      <div class="hk-nf__sw">
        <div class="d-flex flex-column flex-grow-1">
          <span style="font-size: 14px">Keep sleepy devices connected</span>
          <span class="hk-label">Battery sensors that wake now and then aren’t dropped for being quiet or slow to answer</span>
        </div>
        <M3Switch v-model="spec.iot.keepAwake" label="Keep sleepy devices connected" />
      </div>
      <div class="hk-nf__sw">
        <div class="d-flex flex-column flex-grow-1">
          <span style="font-size: 14px">Keep the same address</span>
          <span class="hk-label">Day-long DHCP leases, so apps and hubs find devices where they left them</span>
        </div>
        <M3Switch v-model="spec.iot.longLeases" label="Keep the same address" />
      </div>
      <div class="hk-nf__sw">
        <div class="d-flex flex-column flex-grow-1">
          <span style="font-size: 14px">Router keeps their clocks</span>
          <span class="hk-label">The router answers time requests (NTP), so devices without internet keep the right time</span>
        </div>
        <M3Switch v-model="spec.iot.ntp" label="Router keeps their clocks" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.hk-nf {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.hk-nf__row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  align-items: start;
  gap: 12px;
}
.hk-nf__sec {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 20px;
  background: rgb(var(--v-theme-surface-container-low));
}
.hk-nf__title {
  font-size: 15px;
  font-weight: 600;
}
.hk-nf__port {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.hk-nf__seg {
  flex: 0 1 auto;
}
.hk-nf__sw {
  display: flex;
  align-items: center;
  gap: 12px;
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
.hk-nf__iot {
  background: rgb(var(--v-theme-secondary-container), 0.45);
}
</style>
