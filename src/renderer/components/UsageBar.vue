<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label: string
  percent?: number
  reset?: string
}>()

const display = computed(() => props.percent === undefined ? '—' : props.percent.toFixed(1) + '%')

const barColor = computed(() => {
  const p = props.percent
  if (p === undefined) return '#e5e7eb'
  if (p >= 90) return 'var(--color-danger)'
  if (p >= 70) return 'var(--color-warning)'
  return 'var(--color-ok)'
})
</script>

<template>
  <div class="usage-bar">
    <div class="row">
      <span class="label">{{ label }}</span>
      <span class="value">{{ display }}</span>
    </div>
    <div class="track">
      <div class="fill" :style="{ width: Math.min(100, percent ?? 0) + '%', background: barColor }"></div>
    </div>
    <div class="reset" v-if="reset && reset !== '—'">{{ reset }}</div>
  </div>
</template>

<style scoped>
.usage-bar { font-size: 12px; }
.row { display: flex; justify-content: space-between; margin-bottom: 3px; }
.label { color: var(--text-secondary); }
.value { font-weight: 600; color: var(--text-primary); }
.track { height: 6px; background: #f3f4f6; border-radius: 3px; overflow: hidden; }
.fill { height: 100%; border-radius: 3px; transition: width 0.5s ease; }
.reset { font-size: 10px; color: var(--text-secondary); margin-top: 2px; text-align: right; }
</style>
