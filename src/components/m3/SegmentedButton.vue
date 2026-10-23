<script setup lang="ts" generic="T extends string">
import HkIcon from '@/components/icons/HkIcon.vue'

// M3 segmented button (single select): outlined, the chosen segment in
// secondary-container with a leading check.
defineProps<{ modelValue: T; options: { value: T; label: string; disabled?: boolean; title?: string }[]; label: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<template>
  <div role="group" :aria-label="label" class="hk-seg">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      class="hk-seg__btn"
      :class="{ 'is-on': o.value === modelValue }"
      :aria-pressed="o.value === modelValue ? 'true' : 'false'"
      :disabled="disabled || o.disabled"
      :title="o.title"
      @click="o.value !== modelValue && emit('update:modelValue', o.value)"
    >
      <HkIcon v-if="o.value === modelValue" name="check" :size="16" :stroke="2.6" />
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.hk-seg {
  display: flex;
  height: 40px;
  border: 1px solid rgb(var(--v-theme-outline));
  border-radius: 20px;
  overflow: hidden;
}
.hk-seg__btn {
  flex: 1 1 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  white-space: nowrap;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.hk-seg__btn + .hk-seg__btn {
  border-left: 1px solid rgb(var(--v-theme-outline));
}
.hk-seg__btn.is-on {
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}
.hk-seg__btn:focus-visible {
  outline: 3px solid rgb(var(--v-theme-secondary));
  outline-offset: -3px;
}
.hk-seg__btn:disabled {
  cursor: progress;
}
</style>
