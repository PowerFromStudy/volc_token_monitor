<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import KeyCard from './KeyCard.vue'
import Settings from './Settings.vue'
import { useMainStore } from '../stores/main'
import type { UsageSnapshot } from '../../shared/types'

const store = useMainStore()
const tab = ref<'keys' | 'settings'>('keys')
const showAddKey = ref(false)
const savingKey = ref(false)

const keyForm = reactive({
  accountId: '',
  apiKey: '',
  scene: 'coding_plan' as 'coding_plan' | 'agent_plan',
  remark: ''
})

async function refresh() {
  await store.refreshUsage()
}

function close() {
  window.volc.closePanel()
}

async function addKey() {
  if (!keyForm.accountId || !keyForm.apiKey) return
  savingKey.value = true
  try {
    await store.addSeat({
      accountId: keyForm.accountId,
      apiKey: keyForm.apiKey,
      scene: keyForm.scene,
      remark: keyForm.remark
    })
    Object.assign(keyForm, { apiKey: '', scene: 'coding_plan', remark: '' })
    showAddKey.value = false
  } finally {
    savingKey.value = false
  }
}

async function removeSeat(seatId: string) {
  if (!confirm('确定删除该 Key？')) return
  await store.removeSeat(seatId)
}

onMounted(async () => {
  await store.loadAll()
  // 默认选第一个账号
  if (store.accounts.length > 0) {
    keyForm.accountId = store.accounts[0].id
  }
})
</script>

<template>
  <div class="panel">
    <div class="header">
      <span class="title">🌋 火山 Token 监控</span>
      <button class="close-btn" @click="close">×</button>
    </div>

    <div class="tabs">
      <button :class="{ active: tab === 'keys' }" @click="tab = 'keys'">Key 列表</button>
      <button :class="{ active: tab === 'settings' }" @click="tab = 'settings'">设置</button>
    </div>

    <div class="content">
      <template v-if="tab === 'keys'">
        <div class="toolbar">
          <button class="refresh-btn" @click="refresh" :disabled="store.loading">
            {{ store.loading ? '刷新中...' : '🔄 刷新' }}
          </button>
          <span class="count">共 {{ store.seats.length }} 个 Key</span>
          <button class="add-key-btn" @click="showAddKey = !showAddKey">
            {{ showAddKey ? '取消' : '+ 添加 Key' }}
          </button>
        </div>
        <div v-if="store.refreshError" class="error-bar">
          ⚠ {{ store.refreshError }}
        </div>

        <!-- 添加 Key 表单 -->
        <div v-if="showAddKey" class="add-form">
          <select v-model="keyForm.accountId" class="form-select">
            <option value="" disabled>选择账号</option>
            <option v-for="acc in store.accounts" :key="acc.id" :value="acc.id">
              {{ acc.name }} ({{ acc.edition === 'personal' ? '个人版' : '企业版' }})
            </option>
          </select>
          <input v-model="keyForm.apiKey" placeholder="ARK_API_KEY" class="form-input" />
          <select v-model="keyForm.scene" class="form-select">
            <option value="coding_plan">Coding Plan</option>
            <option value="agent_plan">Agent Plan</option>
          </select>
          <input v-model="keyForm.remark" placeholder="备注(可选)" class="form-input" />
          <button class="save-btn" @click="addKey" :disabled="savingKey || !keyForm.apiKey || !keyForm.accountId">
            {{ savingKey ? '保存中(自动获取套餐信息)...' : '保存 Key' }}
          </button>
          <p class="form-hint">套餐档次和到期时间会自动从 API 获取，无需手动填写</p>
        </div>

        <div class="key-list">
          <KeyCard
            v-for="seat in store.seats"
            :key="seat.seatId"
            :seat="seat"
            :snapshot="store.snapshots.find((s: UsageSnapshot) => s.seatId === seat.seatId)"
            :active="store.activeSeatId === seat.seatId"
            @remove="removeSeat(seat.seatId)"
          />
          <div v-if="store.seats.length === 0 && !showAddKey" class="empty">
            <p>暂无 Key</p>
            <p class="hint">点击「+ 添加 Key」录入你的 ARK_API_KEY</p>
          </div>
        </div>
      </template>
      <Settings v-else />
    </div>
  </div>
</template>

<style scoped>
.panel {
  width: 100%;
  height: 100%;
  background: var(--panel-bg);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.25);
  backdrop-filter: blur(20px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.25s ease;
}
@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}
.title { font-weight: 600; font-size: 15px; color: var(--text-primary); }
.close-btn {
  width: 28px; height: 28px;
  border: none; background: #f3f4f6;
  border-radius: 50%; cursor: pointer;
  font-size: 18px; color: var(--text-secondary);
  line-height: 1;
}
.close-btn:hover { background: #e5e7eb; }
.tabs { display: flex; padding: 0 16px; gap: 8px; }
.tabs button {
  flex: 1; padding: 8px; border: none; background: transparent;
  cursor: pointer; color: var(--text-secondary); font-size: 13px;
  border-bottom: 2px solid transparent;
}
.tabs button.active { color: #2563eb; border-bottom-color: #2563eb; font-weight: 600; }
.content { flex: 1; overflow-y: auto; padding: 12px 16px; }
.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.refresh-btn {
  padding: 6px 12px; border: none; border-radius: 8px;
  background: #2563eb; color: white; cursor: pointer; font-size: 12px;
}
.refresh-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.count { font-size: 11px; color: var(--text-secondary); flex: 1; text-align: center; }
.add-key-btn {
  padding: 6px 12px; border: 1px solid #2563eb; border-radius: 8px;
  background: white; color: #2563eb; cursor: pointer; font-size: 12px;
}
.error-bar {
  background: #fef2f2; color: #dc2626; padding: 6px 10px;
  border-radius: 6px; font-size: 11px; margin-bottom: 8px;
  word-break: break-all;
}
.add-form {
  background: #f9fafb; border-radius: 10px; padding: 10px;
  display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px;
}
.form-input, .form-select {
  padding: 7px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 12px;
  width: 100%; box-sizing: border-box;
}
.form-row { display: flex; gap: 8px; }
.form-row > * { flex: 1; }
.save-btn {
  padding: 8px; background: #2563eb; color: white; border: none; border-radius: 6px;
  cursor: pointer; font-size: 13px;
}
.save-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.form-hint { font-size: 10px; color: var(--text-secondary); line-height: 1.4; }
.key-list { display: flex; flex-direction: column; gap: 10px; }
.empty { text-align: center; padding: 40px 20px; color: var(--text-secondary); }
.empty .hint { font-size: 12px; margin-top: 8px; }
</style>
