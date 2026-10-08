/**
 * IPC 处理器 - 渲染进程与主进程通信
 */
import { ipcMain, BrowserWindow } from 'electron'
import type { AppStore } from '../store/app-store'
import type { UsageMonitor } from '../services/usage-monitor'
import type { AlertEngine } from '../services/alert-engine'
import { EnvSwitcher } from '../services/env-switcher'
import { VolcApiClient } from '../services/volc-api'
import type { Seat, AppSettings } from '../../shared/types'

export function registerIpcHandlers(
  store: AppStore,
  monitor: UsageMonitor,
  alertEngine: AlertEngine,
  getMainWindow: () => BrowserWindow | null
) {
  const envSwitcher = new EnvSwitcher()

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

  ipcMain.handle('usage:refresh', async () => {
    try {
      const snaps = await monitor.refreshAll()
      console.log('[ipc] refreshAll returned', snaps.length, 'snapshots')
      for (const s of snaps) {
        if (s.error) console.log('[ipc] seat', s.seatId, 'error:', s.error)
      }

      let status = 'idle' as any
      try {
        const decision = alertEngine.evaluate(snaps, store.getSeats())
        status = decision.status
        if (decision.needAutoSwitch && decision.switchFromSeatId) {
          const next = alertEngine.pickNextSeat(snaps, store.getSeats(), decision.switchFromSeatId)
          if (next) await switchToSeat(next)
        }
      } catch (e: any) {
        console.error('[ipc] alertEngine error:', e.message)
      }

      getMainWindow()?.webContents.send('status:update', status)
      return snaps
    } catch (e: any) {
      console.error('[ipc] usage:refresh failed:', e)
      throw e
    }
  })

  // ---------- 环境变量 / 切换 ----------
  ipcMain.handle('env:switch', async (_e, seatId: string) => {
    const seat = store.getSeats().find(s => s.seatId === seatId)
    if (!seat) throw new Error('席位不存在')
    await switchToSeat(seat)
    return true
  })

  ipcMain.handle('env:get', (_e, key: string) => envSwitcher.getEnv(key))

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

  async function switchToSeat(seat: Seat) {
    const baseUrl = seat.scene === 'agent_plan'
      ? 'https://ark.cn-beijing.volces.com/api/v3'
      : 'https://ark.cn-beijing.volces.com/api/v3'
    await envSwitcher.setEnvs({
      ARK_API_KEY: seat.apiKey,
      ARK_BASE_URL: baseUrl,
      ARK_MODEL: 'ark-code-latest'
    })
    store.setActiveSeatId(seat.seatId)
    getMainWindow()?.webContents.send('active:changed', seat.seatId)
  }
}

function mask(s: string): string {
  if (!s || s.length <= 8) return '****'
  return s.slice(0, 4) + '****' + s.slice(-4)
}
