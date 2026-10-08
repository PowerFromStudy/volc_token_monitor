<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { MonitorStatus } from '../../shared/types'

const props = defineProps<{ status: MonitorStatus }>()
const emit = defineEmits<{ click: [] }>()

const pos = ref({ x: window.innerWidth - 100, y: window.innerHeight - 100 })
const dragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })

const color = computed(() => {
  switch (props.status) {
    case 'danger': return 'var(--color-danger)'
    case 'warning': return 'var(--color-warning)'
    case 'ok': return 'var(--color-ok)'
    default: return 'var(--color-idle)'
  }
})

const face = computed(() => {
  switch (props.status) {
    case 'danger': return '😱'
    case 'warning': return '😟'
    case 'ok': return '😊'
    default: return '😴'
  }
})

function onMouseDown(e: MouseEvent) {
  dragging.value = true
  dragOffset.value = { x: e.clientX - pos.value.x, y: e.clientY - pos.value.y }
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  if (!dragging.value) return
  pos.value = {
    x: Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dragOffset.value.x)),
    y: Math.max(0, Math.min(window.innerHeight - 80, e.clientY - dragOffset.value.y))
  }
}

function onMouseUp() {
  dragging.value = false
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
}

function onClick(e: MouseEvent) {
  if (dragging.value) return
  emit('click')
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <div
    class="ball"
    :style="{ left: pos.x + 'px', top: pos.y + 'px', '--ball-color': color }"
    @mousedown="onMouseDown"
    @click="onClick"
  >
    <span class="face">{{ face }}</span>
    <span class="ring"></span>
  </div>
</template>

<style scoped>
.ball {
  position: fixed;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), var(--ball-color) 60%, var(--ball-color));
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  box-shadow: 0 4px 16px rgba(0,0,0,0.2), inset 0 -4px 8px rgba(0,0,0,0.15);
  transition: transform 0.2s, box-shadow 0.2s;
  z-index: 9999;
}
.ball:active { cursor: grabbing; transform: scale(0.95); }
.ball:hover { transform: scale(1.1); box-shadow: 0 6px 24px rgba(0,0,0,0.3); }
.face { font-size: 28px; pointer-events: none; }
.ring {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid var(--ball-color);
  opacity: 0.4;
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0% { transform: scale(1); opacity: 0.4; }
  50% { transform: scale(1.15); opacity: 0; }
  100% { transform: scale(1); opacity: 0; }
}
</style>
