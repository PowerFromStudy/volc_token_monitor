<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useMainStore } from './stores/main'
import BallApp from './views/BallApp.vue'
import PanelApp from './views/PanelApp.vue'
import type { UsageSnapshot } from '../shared/types'

const store = useMainStore()

const mode = computed<'ball' | 'panel'>(() => {
  return window.location.hash.startsWith('#ball') ? 'ball' : 'panel'
})

onMounted(async () => {
  if (mode.value === 'panel') {
    await store.loadAll()
  }
  window.volc.onStatusUpdate((s: string) => store.setStatus(s as any))
  window.volc.onActiveChanged((id: string) => { store.activeSeatId = id })
  window.volc.onUsageUpdate((snaps: UsageSnapshot[]) => { store.snapshots = snaps })
})
</script>

<template>
  <BallApp v-if="mode === 'ball'" />
  <PanelApp v-else />
</template>

<style>
html, body, #app {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  margin: 0;
  padding: 0;
}
</style>
