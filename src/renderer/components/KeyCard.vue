<script setup lang="ts">
import { computed } from 'vue'
import type { Seat, UsageSnapshot } from '../../shared/types'
import UsageBar from './UsageBar.vue'
import { useMainStore } from '../stores/main'

const props = defineProps<{
  seat: Seat
  snapshot?: UsageSnapshot
  active: boolean
}>()

const emit = defineEmits<{ remove: [] }>()

const store = useMainStore()

const expireDays = computed(() => Math.ceil((props.seat.expiredTime - Date.now()) / 86400000))

const expired = computed(() => expireDays.value < 0)

const billingText = computed(() => {
  const map: Record<number, string> = { 1: '待付款', 2: '生效中', 3: '已过期', 4: '已回收' }
  return map[props.seat.billingStatus] ?? '未知'
})

// 计算 5 小时用量百分比
const fiveHourPct = computed(() => {
  const s = props.snapshot
  if (!s) return undefined
  if (s.afpFiveHour && s.afpFiveHour.quota > 0) return (s.afpFiveHour.used / s.afpFiveHour.quota) * 100
  return s.shortTermUsage
})

const weeklyPct = computed(() => {
  const s = props.snapshot
  if (!s) return undefined
  if (s.afpWeekly && s.afpWeekly.quota > 0) return (s.afpWeekly.used / s.afpWeekly.quota) * 100
  return s.weeklyUsage
})

const monthlyPct = computed(() => {
  const s = props.snapshot
  if (!s) return undefined
  if (s.afpMonthly && s.afpMonthly.quota > 0) return (s.afpMonthly.used / s.afpMonthly.quota) * 100
  return s.monthlyUsage
})

const statusColor = computed(() => {
  const p = fiveHourPct.value
  if (p === undefined) return 'var(--color-idle)'
  if (p >= 90) return 'var(--color-danger)'
  if (p >= 70) return 'var(--color-warning)'
  return 'var(--color-ok)'
})

function formatReset(ts?: number): string {
  if (!ts || ts < 0) return '—'
  const diff = ts - Date.now()
  if (diff <= 0) return '即将重置'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  return h > 0 ? `${h}h${m}m后重置` : `${m}m后重置`
}

async function onSwitch() {
  await store.switchSeat(props.seat.seatId)
}
</script>

<template>
  <div class="card" :class="{ active, expired }">
    <div class="card-header">
      <div class="left">
        <span class="badge" :style="{ background: statusColor }"></span>
        <span class="plan">{{ seat.planType }}</span>
        <span class="scene-tag">{{ seat.scene === 'agent_plan' ? 'Agent' : 'Coding' }}</span>
      </div>
      <div class="right">
        <span class="billing" :class="'s' + seat.billingStatus">{{ billingText }}</span>
        <button class="del-seat" @click.stop="emit('remove')">✕</button>
      </div>
    </div>

    <div class="meta">
      <span :title="seat.apiKey">Key: {{ seat.apiKey.slice(0, 8) }}...{{ seat.apiKey.slice(-4) }}</span>
      <span class="expire" :class="{ warn: expireDays <= 3 && !expired }">
        {{ expired ? '已过期' : `剩 ${expireDays} 天` }}
      </span>
    </div>

    <div v-if="snapshot?.error" class="error">⚠ {{ snapshot.error }}</div>

    <div v-else-if="snapshot && (fiveHourPct !== undefined || weeklyPct !== undefined || monthlyPct !== undefined)" class="usage">
      <UsageBar label="5小时" :percent="fiveHourPct" :reset="formatReset(snapshot.shortTermResetTime || snapshot.afpFiveHour?.resetTime)" />
      <UsageBar label="周" :percent="weeklyPct" :reset="formatReset(snapshot.weeklyResetTime || snapshot.afpWeekly?.resetTime)" />
      <UsageBar label="月" :percent="monthlyPct" :reset="formatReset(snapshot.monthlyResetTime || snapshot.afpMonthly?.resetTime)" />
    </div>

    <div v-else-if="snapshot?.info" class="info">{{ snapshot.info }}</div>
    <div v-else class="no-data">暂无用量数据，点击刷新</div>

    <div class="actions">
      <button class="switch-btn" :disabled="active || expired" @click="onSwitch">
        {{ active ? '✓ 当前使用' : '切换到此 Key' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px;
  transition: all 0.2s;
}
.card.active { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.15); }
.card.expired { opacity: 0.6; }
.card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.left { display: flex; align-items: center; gap: 6px; }
.right { display: flex; align-items: center; gap: 6px; }
.del-seat {
  width: 20px; height: 20px; border: none; background: transparent;
  color: #9ca3af; cursor: pointer; font-size: 12px; border-radius: 4px;
  line-height: 1;
}
.del-seat:hover { background: #fee2e2; color: #dc2626; }
.badge { width: 8px; height: 8px; border-radius: 50%; }
.plan { font-weight: 600; font-size: 14px; color: var(--text-primary); }
.scene-tag { font-size: 10px; padding: 1px 6px; background: #f3f4f6; border-radius: 4px; color: var(--text-secondary); }
.billing { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #f3f4f6; color: var(--text-secondary); }
.billing.s2 { background: #dcfce7; color: #166534; }
.billing.s3, .billing.s4 { background: #fee2e2; color: #991b1b; }
.meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary); margin-bottom: 10px; }
.expire.warn { color: #d97706; font-weight: 600; }
.usage { display: flex; flex-direction: column; gap: 6px; }
.error { font-size: 12px; color: #dc2626; padding: 6px; background: #fef2f2; border-radius: 6px; }
.info { font-size: 12px; color: #475569; padding: 6px; background: #f0f9ff; border-radius: 6px; }
.token-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; font-size: 12px; }
.token-label { color: var(--text-secondary); }
.token-val { font-weight: 600; color: var(--text-primary); }
.no-data { font-size: 12px; color: var(--text-secondary); text-align: center; padding: 8px; }
.actions { margin-top: 10px; }
.switch-btn {
  width: 100%; padding: 7px; border: none; border-radius: 8px;
  background: #2563eb; color: white; cursor: pointer; font-size: 13px;
  transition: background 0.2s;
}
.switch-btn:hover:not(:disabled) { background: #1d4ed8; }
.switch-btn:disabled { background: #9ca3af; cursor: not-allowed; }
</style>
