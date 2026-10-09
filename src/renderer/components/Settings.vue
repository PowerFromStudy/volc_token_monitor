<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useMainStore } from '../stores/main'

const store = useMainStore()

const showAddAccount = ref(false)
const form = reactive({
  name: '',
  accessKey: '',
  secretKey: '',
  edition: 'personal' as 'personal' | 'team',
  remark: ''
})

const saving = ref(false)

// ---------- 模型 ----------
const models = ref<string[]>([])
const modelsLoading = ref(false)

async function loadModels() {
  modelsLoading.value = true
  try {
    models.value = await window.volc.listModels()
  } catch (e: any) {
    alert('模型列表获取失败: ' + (e.message || e))
  } finally {
    modelsLoading.value = false
  }
}

async function onModelChange() {
  if (!store.settings.model) return
  await window.volc.switchModel(store.settings.model)
  alert(`已切换模型: ${store.settings.model}（新开 Claude Code 会话生效）`)
}

onMounted(async () => {
  // 没选过模型时，默认选中 settings.json 当前生效的模型
  if (!store.settings.model) {
    store.settings.model = await window.volc.getCurrentModel()
  }
  await loadModels()
})

async function addAccount() {
  if (!form.name || !form.accessKey || !form.secretKey) return
  saving.value = true
  try {
    await window.volc.addAccount({ ...form })
    await store.loadAll()
    Object.assign(form, { name: '', accessKey: '', secretKey: '', edition: 'personal', remark: '' })
    showAddAccount.value = false
  } finally {
    saving.value = false
  }
}

async function removeAccount(id: string) {
  if (!confirm('确定删除该账号？关联的席位也会被移除。')) return
  await window.volc.removeAccount(id)
  await store.loadAll()
}

async function syncSeats(accountId: string) {
  await store.syncSeats(accountId)
}

async function saveSettings() {
  await window.volc.setSettings(store.settings)
  alert('设置已保存')
}
</script>

<template>
  <div class="settings">
    <!-- 账号管理 -->
    <section class="block">
      <div class="block-header">
        <h3>账号管理</h3>
        <button class="add-btn" @click="showAddAccount = !showAddAccount">
          {{ showAddAccount ? '取消' : '+ 添加账号' }}
        </button>
      </div>

      <div v-if="showAddAccount" class="form">
        <input v-model="form.name" placeholder="账号别名 (如: 主号)" />
        <input v-model="form.accessKey" placeholder="Access Key ID" />
        <input v-model="form.secretKey" type="password" placeholder="Secret Access Key" />
        <select v-model="form.edition">
          <option value="personal">个人版</option>
          <option value="team">企业版</option>
        </select>
        <button class="save-btn" @click="addAccount" :disabled="saving">
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>

      <div class="account-list">
        <div v-for="acc in store.accounts" :key="acc.id" class="account-item">
          <div class="acc-info">
            <span class="acc-name">{{ acc.name }}</span>
            <span class="acc-edition">{{ acc.edition === 'personal' ? '个人版' : '企业版' }}</span>
            <span class="acc-ak">{{ acc.accessKey }}</span>
          </div>
          <div class="acc-actions">
            <button v-if="acc.edition === 'team'" class="sync-btn" @click="syncSeats(acc.id)">同步席位</button>
            <button class="del-btn" @click="removeAccount(acc.id)">删除</button>
          </div>
        </div>
        <div v-if="store.accounts.length === 0" class="empty-tip">暂无账号，请添加</div>
      </div>
    </section>

    <!-- 监控设置 -->
    <section class="block">
      <h3>监控设置</h3>
      <div class="setting-row">
        <label>轮询间隔 (秒)</label>
        <input type="number" :value="store.settings.pollInterval / 1000"
               @input="store.settings.pollInterval = Number(($event.target as HTMLInputElement).value) * 1000" />
      </div>
      <div class="setting-row">
        <label>告警阈值 (%)</label>
        <input type="number" v-model.number="store.settings.warnThreshold" />
      </div>
      <div class="setting-row">
        <label>危险阈值 (%)</label>
        <input type="number" v-model.number="store.settings.dangerThreshold" />
      </div>
      <div class="setting-row">
        <label>自动切换</label>
        <input type="checkbox" v-model="store.settings.autoSwitch" />
      </div>
      <div class="setting-row">
        <label>自动切换阈值 (%)</label>
        <input type="number" v-model.number="store.settings.autoSwitchThreshold" />
      </div>
      <div class="setting-row">
        <label>到期提醒 (天)</label>
        <input type="number" v-model.number="store.settings.expireWarnDays" />
      </div>
      <button class="save-btn" @click="saveSettings">保存设置</button>
    </section>

    <!-- 模型设置 -->
    <section class="block">
      <h3>模型设置</h3>
      <div class="setting-row">
        <label>模型</label>
        <div class="model-controls">
          <select v-model="store.settings.model" @change="onModelChange">
            <option value="" disabled>选择模型</option>
            <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
          </select>
          <button class="sync-btn" @click="loadModels" :disabled="modelsLoading">
            {{ modelsLoading ? '加载中...' : '刷新' }}
          </button>
        </div>
      </div>
      <p class="model-hint">切换后写入 ~/.claude/settings.json，新开 Claude Code 会话生效</p>
    </section>
  </div>
</template>

<style scoped>
.settings { display: flex; flex-direction: column; gap: 16px; }
.block { background: #f9fafb; border-radius: 10px; padding: 12px; }
.block-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
h3 { font-size: 14px; color: var(--text-primary); }
.add-btn { padding: 4px 10px; border: 1px solid #2563eb; background: white; color: #2563eb; border-radius: 6px; cursor: pointer; font-size: 12px; }
.form { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.form input, .form select { padding: 7px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; }
.save-btn { padding: 7px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; }
.account-list { display: flex; flex-direction: column; gap: 8px; }
.account-item { display: flex; justify-content: space-between; align-items: center; padding: 8px; background: white; border-radius: 8px; }
.acc-info { display: flex; flex-direction: column; gap: 2px; }
.acc-name { font-weight: 600; font-size: 13px; }
.acc-edition { font-size: 11px; color: var(--text-secondary); }
.acc-ak { font-size: 10px; color: var(--text-secondary); font-family: monospace; }
.acc-actions { display: flex; gap: 6px; }
.sync-btn, .del-btn { padding: 4px 10px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; }
.sync-btn { background: #dbeafe; color: #1e40af; }
.del-btn { background: #fee2e2; color: #991b1b; }
.empty-tip { text-align: center; color: var(--text-secondary); font-size: 12px; padding: 12px; }
.setting-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.setting-row label { font-size: 13px; color: var(--text-primary); }
.setting-row input[type="number"] { width: 80px; padding: 5px 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; text-align: right; }
.setting-row input[type="checkbox"] { width: 18px; height: 18px; }
.model-controls { display: flex; gap: 6px; align-items: center; }
.model-controls select { padding: 5px 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 12px; max-width: 150px; }
.model-hint { font-size: 10px; color: var(--text-secondary); margin: 0; }
</style>
