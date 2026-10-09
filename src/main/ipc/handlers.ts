/**
 * IPC 处理器 - 渲染进程与主进程通信
 */
import { ipcMain, BrowserWindow } from 'electron'
import type { AppStore } from '../store/app-store'
import type { UsageMonitor } from '../services/usage-monitor'
import type { AlertEngine } from '../services/alert-engine'
import { ClaudeSettings } from '../services/claude-settings'
import { VolcApiClient } from '../services/volc-api'
import type { Seat, AppSettings } from '../../shared/types'

export function registerIpcHandlers(
  store: AppStore,
  monitor: UsageMonitor,
  alertEngine: AlertEngine,
  getMainWindow: () => BrowserWindow | null,
  getAllWindows: () => BrowserWindow[]
) {
  const claudeSettings = new ClaudeSettings()

  /** 广播事件到悬浮球/面板两个窗口 */
  function broadcast(channel: string, payload: any) {
    for (const win of getAllWindows()) {
      win.webContents.send(channel, payload)
    }
  }

  // ---------- 账号管理 ----------
  ipcMain.handle('account:list', () => {
    return store.listAccounts().map(a => ({ ...a, accessKey: mask(a.accessKey), secretKey: '***' }))
  })

  ipcMain.handle('account:add', (_e, account) => {
    const a = store.addAccount(account)
    return { ...a, accessKey: mask(a.accessKey), secretKey: '***' }
  })

  ipcMain.handle('account:update', (_e, id, patch) => {
    const a = store.updateAccount(id, patch)
    if (!a) return null
    return { ...a, accessKey: mask(a.accessKey), secretKey: '***' }
  })

  ipcMain.handle('account:remove', (_e, id) => {
    store.removeSeatsByAccount(id)
    return store.removeAccount(id)
  })

  // ---------- 席位管理 ----------
  ipcMain.handle('seat:list', () => store.getSeats())

  /** 从火山引擎同步席位列表 (企业版) */
  ipcMain.handle('seat:sync', async (_e, accountId: string) => {
    const account = store.keyManager.get(accountId)
    if (!account) throw new Error('账号不存在')
    const client = new VolcApiClient({ accessKey: account.accessKey, secretKey: account.secretKey })
    const seats: Seat[] = []

    // Coding Plan 企业版
    try {
      const resp = await client.listSeatInfos('coding_plan_enterprise')
      for (const s of resp.Data || []) {
        seats.push({
          seatId: s.SeatID,
          accountId,
          apiKey: s.ApiKey,
          apiKeySid: s.ApiKeySID,
          planType: s.BizInfo as any,
          scene: 'coding_plan',
          expiredTime: s.ExpiredTime,
          billingStatus: s.BillingStatus,
          userName: s.IdentityDetail
        })
      }
    } catch { /* 可能未开通企业版 */ }

    // Agent Plan 企业版
    try {
      const resp = await client.listSeatInfos('agent_plan_enterprise')
      for (const s of resp.Data || []) {
        seats.push({
          seatId: s.SeatID,
          accountId,
          apiKey: s.ApiKey,
          apiKeySid: s.ApiKeySID,
          planType: s.BizInfo as any,
          scene: 'agent_plan',
          expiredTime: s.ExpiredTime,
          billingStatus: s.BillingStatus,
          userName: s.IdentityDetail
        })
      }
    } catch { /* 可能未开通 */ }

    // 写入存储
    for (const seat of seats) {
      store.upsertSeat(seat)
    }
    // 更新监控的席位列表
    monitor.setSeats(store.getSeats())
    return seats
  })

  /** 手动添加 Key/席位 (个人版用户直接录入 ARK_API_KEY) */
  ipcMain.handle('seat:add', async (_e, seat: {
    accountId: string
    apiKey: string
    scene: 'coding_plan' | 'agent_plan'
    remark?: string
  }) => {
    const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // 自动查询套餐信息 (到期时间+套餐档次)
    let planType = 'Unknown'
    let expiredTime = Date.now() + 30 * 86400000 // 默认30天

    try {
      const account = store.keyManager.list().find(a => a.id === seat.accountId)
      if (account) {
        const client = new VolcApiClient({ accessKey: account.accessKey, secretKey: account.secretKey })
        const planName = seat.scene === 'coding_plan' ? 'CodingPlan' : 'AgentPlan'
        const plan = await client.getPersonalPlan(planName as any)
        if (plan.PlanType) planType = plan.PlanType
        if (plan.EndTime) {
          const t = new Date(plan.EndTime).getTime()
          if (!isNaN(t)) expiredTime = t
        }
      }
    } catch (e: any) {
      console.error('[ipc] auto-fetch plan info failed:', e.message)
    }

    const newSeat: Seat = {
      seatId: id,
      accountId: seat.accountId,
      apiKey: seat.apiKey,
      planType: planType as any,
      scene: seat.scene,
      expiredTime,
      billingStatus: 2,
      userName: seat.remark
    }
    store.upsertSeat(newSeat)
    monitor.setSeats(store.getSeats())
    return newSeat
  })

  /** 删除席位 */
  ipcMain.handle('seat:remove', (_e, seatId: string) => {
    const seats = store.getSeats().filter(s => s.seatId !== seatId)
    store.setSeats(seats)
    monitor.setSeats(seats)
    return true
  })

  // ---------- 用量 ----------
  ipcMain.handle('usage:list', () => monitor.getSnapshots())

  // 手动刷新与定时轮询共用 monitor.tick 链路，后处理在 onRefresh 回调里
  ipcMain.handle('usage:refresh', async () => {
    return await monitor.tick()
  })

  // 轮询/手动刷新共用的后处理链路: 告警评估 -> 自动切换 -> 推送快照到两个窗口
  monitor.setOnRefresh(snaps => {
    try {
      const decision = alertEngine.evaluate(snaps, store.getSeats())
      broadcast('status:update', decision.status)
      if (decision.needAutoSwitch && decision.switchFromSeatId) {
        const next = alertEngine.pickNextSeat(snaps, store.getSeats(), decision.switchFromSeatId)
        if (next) switchToSeat(next)
      }
    } catch (e: any) {
      console.error('[monitor] alertEngine error:', e.message)
    }
    broadcast('usage:update', snaps)
  })

  // ---------- 切换 Key ----------
  ipcMain.handle('env:switch', async (_e, seatId: string) => {
    const seat = store.getSeats().find(s => s.seatId === seatId)
    if (!seat) throw new Error('席位不存在')
    await switchToSeat(seat)
    // 切换后立即刷新用量; status:update / usage:update 由 onRefresh 回调统一广播
    await monitor.tick()
    return true
  })

  // ---------- 模型 ----------
  /** 可用模型列表 (来自火山 ListModelRateLimit，返回账号可用的基础模型名) */
  ipcMain.handle('model:list', async () => {
    const accounts = store.listAccounts()
    if (accounts.length === 0) throw new Error('请先添加火山账号')
    // 优先用激活席位所属账号，否则第一个
    const activeSeat = store.getSeats().find(s => s.seatId === store.getActiveSeatId())
    const account = accounts.find(a => a.id === activeSeat?.accountId) ?? accounts[0]
    const client = new VolcApiClient({ accessKey: account.accessKey, secretKey: account.secretKey })
    const resp = await client.listModelRateLimit()
    return resp.Items.map(i => i.FoundationModelName)
  })

  /** 切换模型: 保存到应用设置并写入 ~/.claude/settings.json */
  ipcMain.handle('model:switch', (_e, model: string) => {
    store.setSettings({ model })
    claudeSettings.setModel(model)
    return true
  })

  /** 当前 settings.json 实际生效的模型名 */
  ipcMain.handle('model:current', () => claudeSettings.getCurrentModel() ?? '')

  // ---------- 设置 ----------
  ipcMain.handle('settings:get', () => store.getSettings())

  ipcMain.handle('settings:set', (_e, settings: Partial<AppSettings>) => {
    store.setSettings(settings)
    const s = store.getSettings()
    alertEngine.setSettings(s)
    monitor.setSettings(s)
    return s
  })

  // ---------- 激活席位 ----------
  ipcMain.handle('active:get', () => store.getActiveSeatId())

  // ---------- 窗口控制 ----------
  ipcMain.handle('window:toggle', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isVisible()) win.hide()
    else { win.show(); win.focus() }
  })

  /**
   * 切换激活 Key: 按 scene 选火山接入地址，写 ~/.claude/settings.json 的 env 块
   * 模型优先用应用设置里选的，没选过则保留 settings.json 现有模型
   */
  function switchToSeat(seat: Seat) {
    const model = store.getSettings().model || claudeSettings.getCurrentModel()
    claudeSettings.switchKey(seat.scene, seat.apiKey, model)
    store.setActiveSeatId(seat.seatId)
    broadcast('active:changed', seat.seatId)
  }
}

function mask(s: string): string {
  if (!s || s.length <= 8) return '****'
  return s.slice(0, 4) + '****' + s.slice(-4)
}
