import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UsageSnapshot, Seat, AppSettings, MonitorStatus } from '../../shared/types'

declare global {
  interface Window { volc: any }
}

export const useMainStore = defineStore('main', () => {
  const accounts = ref<any[]>([])
  const seats = ref<Seat[]>([])
  const snapshots = ref<UsageSnapshot[]>([])
  const settings = ref<AppSettings>({} as AppSettings)
  const activeSeatId = ref<string>()
  const status = ref<MonitorStatus>('idle')
  const loading = ref(false)

  const activeSeat = computed(() => seats.value.find((s: Seat) => s.seatId === activeSeatId.value))

  async function loadAll() {
    loading.value = true
    try {
      const [accs, sts, snaps, sets, active] = await Promise.all([
        window.volc.listAccounts(),
        window.volc.listSeats(),
        window.volc.listUsage(),
        window.volc.getSettings(),
        window.volc.getActiveSeat()
      ])
      accounts.value = accs
      seats.value = sts
      snapshots.value = snaps
      settings.value = sets
      activeSeatId.value = active
    } finally {
      loading.value = false
    }
  }

  const refreshError = ref('')

  async function refreshUsage() {
    loading.value = true
    refreshError.value = ''
    try {
      snapshots.value = await window.volc.refreshUsage()
      seats.value = await window.volc.listSeats()
      activeSeatId.value = await window.volc.getActiveSeat()
    } catch (e: any) {
      refreshError.value = e.message || String(e)
      console.error('[store] refreshUsage error:', e)
    } finally {
      loading.value = false
    }
  }

  async function switchSeat(seatId: string) {
    await window.volc.switchEnv(seatId)
    activeSeatId.value = seatId
    // 切换后立即刷新用量，让悬浮球更新
    await refreshUsage()
  }

  async function syncSeats(accountId: string) {
    seats.value = await window.volc.syncSeats(accountId)
  }

  async function addSeat(seat: { accountId: string; apiKey: string; scene: 'coding_plan' | 'agent_plan'; remark?: string }) {
    await window.volc.addSeat(seat)
    seats.value = await window.volc.listSeats()
  }

  async function removeSeat(seatId: string) {
    await window.volc.removeSeat(seatId)
    seats.value = await window.volc.listSeats()
  }

  function setStatus(s: MonitorStatus) {
    status.value = s
  }

  return {
    accounts, seats, snapshots, settings, activeSeatId, status, loading, refreshError,
    activeSeat,
    loadAll, refreshUsage, switchSeat, syncSeats, addSeat, removeSeat, setStatus
  }
})
