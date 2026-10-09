<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useMainStore } from '../stores/main'

const store = useMainStore()

// 三时限用量: 只统计当前激活 Key (切 Key 时随 active:changed 立即切换)
// 未设置激活 Key 时回退为全量最大值
const usage = computed(() => {
  const target = store.activeSeatId
    ? store.snapshots.filter(s => s.seatId === store.activeSeatId)
    : store.snapshots
  let five = 0, weekly = 0, monthly = 0
  for (const snap of target) {
    if (snap.error) continue
    if (snap.afpFiveHour?.quota > 0) five = Math.max(five, (snap.afpFiveHour.used / snap.afpFiveHour.quota) * 100)
    if (snap.afpWeekly?.quota > 0) weekly = Math.max(weekly, (snap.afpWeekly.used / snap.afpWeekly.quota) * 100)
    if (snap.afpMonthly?.quota > 0) monthly = Math.max(monthly, (snap.afpMonthly.used / snap.afpMonthly.quota) * 100)
    if (snap.shortTermUsage != null) five = Math.max(five, snap.shortTermUsage)
    if (snap.weeklyUsage != null) weekly = Math.max(weekly, snap.weeklyUsage)
    if (snap.monthlyUsage != null) monthly = Math.max(monthly, snap.monthlyUsage)
  }
  return { five: Math.min(100, five), weekly: Math.min(100, weekly), monthly: Math.min(100, monthly) }
})

const maxPct = computed(() => Math.max(usage.value.five, usage.value.weekly, usage.value.monthly))

function ringColor(pct: number): string {
  if (pct >= 90) return '#ef4444'
  if (pct >= 70) return '#f59e0b'
  if (pct > 0) return '#22c55e'
  return '#d1d5db'
}

// SVG 环参数
const rings = [
  { r: 36, label: '月', key: 'monthly' as const },
  { r: 30, label: '周', key: 'weekly' as const },
  { r: 24, label: '5h', key: 'five' as const },
]
const circ = (r: number) => 2 * Math.PI * r

// 球体主色
const ballColor = computed(() => {
  if (maxPct.value >= 90) return { main: '#ef4444', light: '#fca5a5' }
  if (maxPct.value >= 70) return { main: '#f59e0b', light: '#fcd34d' }
  if (maxPct.value > 0) return { main: '#22c55e', light: '#86efac' }
  return { main: '#94a3b8', light: '#cbd5e1' }
})

const blinking = ref(false)
const wobbling = ref(false)
let blinkTimer: NodeJS.Timeout
let wobbleTimer: NodeJS.Timeout

function startBlink() {
  const next = 2500 + Math.random() * 3000
  blinkTimer = setTimeout(() => {
    blinking.value = true
    setTimeout(() => { blinking.value = false; startBlink() }, 150)
  }, next)
}

let mouseDown = false, dragging = false, lastPos = { x: 0, y: 0 }
function onPointerDown(e: PointerEvent) { mouseDown = true; dragging = false; lastPos = { x: e.screenX, y: e.screenY } }
function onPointerMove(e: PointerEvent) {
  if (!mouseDown) return
  const dx = e.screenX - lastPos.x, dy = e.screenY - lastPos.y
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) { dragging = true; wobbling.value = true; window.volc.moveBall(dx, dy); lastPos = { x: e.screenX, y: e.screenY } }
}
function onPointerUp() {
  if (mouseDown && !dragging) window.volc.togglePanel()
  mouseDown = false; dragging = false
  clearTimeout(wobbleTimer); wobbleTimer = setTimeout(() => { wobbling.value = false }, 300)
}
onMounted(() => { startBlink(); store.loadAll(); document.addEventListener('pointerdown', onPointerDown); document.addEventListener('pointermove', onPointerMove); document.addEventListener('pointerup', onPointerUp) })
onUnmounted(() => { clearTimeout(blinkTimer); clearTimeout(wobbleTimer); document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('pointermove', onPointerMove); document.removeEventListener('pointerup', onPointerUp) })
</script>

<template>
  <div class="ball-container" :style="{ '--mc': ballColor.main, '--ml': ballColor.light }">
    <!-- 脉冲光晕 -->
    <div class="pulse-glow" :style="{ background: `radial-gradient(circle, ${ballColor.main}33 0%, transparent 70%)` }"></div>

    <!-- SVG 三层环 -->
    <svg class="rings-svg" viewBox="0 0 80 80">
      <defs>
        <filter id="ringGlow">
          <feGaussianBlur stdDeviation="0.8" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <template v-for="ring in rings" :key="ring.key">
        <!-- 轨道 -->
        <circle :cx="40" :cy="40" :r="ring.r" fill="none" stroke="#e5e7eb" stroke-width="2.5" />
        <!-- 进度 -->
        <circle
          :cx="40" :cy="40" :r="ring.r" fill="none"
          :stroke="ringColor(usage[ring.key])"
          stroke-width="2.5"
          stroke-linecap="round"
          :stroke-dasharray="circ(ring.r)"
          :stroke-dashoffset="circ(ring.r) * (1 - usage[ring.key] / 100)"
          :transform="`rotate(-90 40 40)`"
          filter="url(#ringGlow)"
          class="progress-arc"
        />
      </template>
    </svg>

    <!-- 球体 -->
    <div class="ball" :class="{ wobble: wobbling }">
      <div class="ball-shine"></div>
      <!-- 眼睛 -->
      <div class="eyes" :class="{ blink: blinking }">
        <div class="eye"><span class="pupil"></span></div>
        <div class="eye"><span class="pupil"></span></div>
      </div>
      <!-- 百分比 -->
      <div class="pct" v-if="maxPct > 0">{{ Math.round(maxPct) }}<span class="pct-s">%</span></div>
      <div class="pct idle" v-else>·</div>
      <!-- 腮红 -->
      <div class="cheek cheek-l"></div>
      <div class="cheek cheek-r"></div>
    </div>

    <!-- hover 图例 -->
    <div class="legend">
      <span class="lg-item"><i :style="{ background: ringColor(usage.five) }"></i>5h {{ Math.round(usage.five) }}%</span>
      <span class="lg-item"><i :style="{ background: ringColor(usage.weekly) }"></i>周 {{ Math.round(usage.weekly) }}%</span>
      <span class="lg-item"><i :style="{ background: ringColor(usage.monthly) }"></i>月 {{ Math.round(usage.monthly) }}%</span>
    </div>
  </div>
</template>

<style scoped>
.ball-container {
  width: 80px; height: 80px;
  position: relative;
  display: flex; align-items: center; justify-content: center;
  cursor: grab;
  -webkit-user-select: none; user-select: none;
}
.ball-container:active { cursor: grabbing; }

/* 光晕 */
.pulse-glow {
  position: absolute; inset: -8px;
  border-radius: 50%;
  opacity: 0.5;
  animation: pulse 2.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.08); }
}

/* SVG 环 */
.rings-svg {
  position: absolute; inset: 0;
  width: 80px; height: 80px;
  z-index: 1;
}
.progress-arc { transition: stroke-dashoffset 0.6s ease; }

/* 球体 */
.ball {
  width: 38px; height: 38px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, var(--ml) 0%, var(--mc) 60%, color-mix(in srgb, var(--mc) 60%, #000) 100%);
  box-shadow: 0 3px 8px rgba(0,0,0,0.2), inset 0 -4px 8px rgba(0,0,0,0.2), inset 0 2px 4px rgba(255,255,255,0.3);
  position: relative; z-index: 2;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ball-container:hover .ball { transform: scale(1.08); }
.ball.wobble { animation: wob 0.25s ease-in-out infinite; }
@keyframes wob {
  0%, 100% { transform: rotate(0) scale(1.02); }
  25% { transform: rotate(-5deg) scale(1.02); }
  75% { transform: rotate(5deg) scale(1.02); }
}

/* 高光 */
.ball-shine {
  position: absolute;
  top: 3px; left: 7px;
  width: 12px; height: 9px;
  background: radial-gradient(ellipse, rgba(255,255,255,0.8) 0%, transparent 70%);
  border-radius: 50%;
}

/* 眼睛 */
.eyes {
  position: absolute;
  top: 9px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 5px;
  transition: all 0.1s;
}
.eye {
  width: 5px; height: 6px;
  background: #1e293b; border-radius: 50%;
  position: relative; overflow: hidden;
}
.pupil { position: absolute; top: 1px; left: 1px; width: 3px; height: 3px; background: #fff; border-radius: 50%; }
.eyes.blink .eye { height: 1px; }
.eyes.blink .pupil { display: none; }

/* 百分比 */
.pct {
  position: absolute;
  bottom: 5px; left: 50%; transform: translateX(-50%);
  font-size: 8px; font-weight: 800; color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.4);
  line-height: 1;
}
.pct-s { font-size: 5px; }
.pct.idle { font-size: 14px; opacity: 0.5; }

/* 腮红 */
.cheek { position: absolute; bottom: 11px; width: 5px; height: 3px; background: rgba(255,90,90,0.4); border-radius: 50%; }
.cheek-l { left: 4px; }
.cheek-r { right: 4px; }

/* 图例 */
.legend {
  position: absolute; bottom: -28px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 6px;
  font-size: 9px; white-space: nowrap; color: #475569;
  opacity: 0; transition: opacity 0.2s; pointer-events: none;
  background: rgba(255,255,255,0.95); padding: 3px 7px; border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
}
.ball-container:hover .legend { opacity: 1; }
.lg-item { display: flex; align-items: center; gap: 3px; }
.lg-item i { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
</style>
