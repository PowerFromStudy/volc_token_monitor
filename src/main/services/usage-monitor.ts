/**
 * 用量监控服务
 * 定时轮询所有账号/席位的用量，生成快照
 */
import { VolcApiClient } from './volc-api'
import { KeyManager } from './key-manager'
import type { UsageSnapshot, Seat, AppSettings } from '../../shared/types'

export class UsageMonitor {
  private keyManager: KeyManager
  private seats: Seat[]
  private settings: AppSettings
  private timer: NodeJS.Timeout | null = null
  private snapshots: Map<string, UsageSnapshot> = new Map()
  private lastError: Map<string, string> = new Map()
  private onRefresh?: (snaps: UsageSnapshot[]) => void

  constructor(keyManager: KeyManager, seats: Seat[], settings: AppSettings) {
    this.keyManager = keyManager
    this.seats = seats
    this.settings = settings
  }

  setSettings(settings: AppSettings) {
    this.settings = settings
    if (this.timer) { this.stop(); this.start() }
  }

  setSeats(seats: Seat[]) {
    this.seats = seats
  }

  /** 注册每次刷新完成后的回调 (告警评估 / 快照推送) */
  setOnRefresh(cb: (snaps: UsageSnapshot[]) => void) {
    this.onRefresh = cb
  }

  getSnapshots(): UsageSnapshot[] {
    return Array.from(this.snapshots.values())
  }

  getSnapshot(seatId: string): UsageSnapshot | undefined {
    return this.snapshots.get(seatId)
  }

  start() {
    this.stop()
    this.tick().catch(() => {})
    this.timer = setInterval(() => {
      this.tick().catch(() => {})
    }, this.settings.pollInterval)
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  /** 刷新一次并触发 onRefresh 回调 (定时轮询与手动刷新共用同一条链路) */
  async tick(): Promise<UsageSnapshot[]> {
    const snaps = await this.refreshAll()
    this.onRefresh?.(snaps)
    return snaps
  }

  /** 刷新所有用量 */
  async refreshAll(): Promise<UsageSnapshot[]> {
    const accounts = this.keyManager.list()
    const results: UsageSnapshot[] = []

    for (const account of accounts) {
      const client = new VolcApiClient({ accessKey: account.accessKey, secretKey: account.secretKey })
      const accountSeats = this.seats.filter(s => s.accountId === account.id)
      const manualSeats = accountSeats.filter(s => s.seatId.startsWith('manual-'))
      const enterpriseSeats = accountSeats.filter(s => !s.seatId.startsWith('manual-'))

      // ============ 个人版: 账号级查询 ============
      if (account.edition === 'personal') {
        // Agent Plan AFP 用量 (账号级，无需 seatId)
        let agentAfp = null
        let afpError = ''
        try {
          agentAfp = await client.getAFPUsage()
          console.log('[monitor] getAFPUsage OK:', JSON.stringify(agentAfp).slice(0, 200))
        } catch (e: any) {
          afpError = e.message
          console.error('[monitor] getAFPUsage failed:', afpError)
        }

        // Coding Plan 套餐信息
        let codingPlan = null
        try {
          codingPlan = await client.getPersonalPlan('CodingPlan')
          console.log('[monitor] getPersonalPlan(Coding) OK:', codingPlan?.Status)
        } catch (e: any) {
          console.error('[monitor] getPersonalPlan(Coding) failed:', e.message)
        }

        // 将账号级用量分配给个人版 Key
        for (const seat of manualSeats) {
          if (seat.scene === 'agent_plan') {
            if (agentAfp) {
              results.push({
                seatId: seat.seatId,
                accountId: account.id,
                timestamp: Date.now(),
                afpFiveHour: parseAfpWindow(agentAfp.AFPFiveHour),
                afpDaily: parseAfpWindow(agentAfp.AFPDaily),
                afpWeekly: parseAfpWindow(agentAfp.AFPWeekly),
                afpMonthly: parseAfpWindow(agentAfp.AFPMonthly)
              })
            } else {
              results.push({
                seatId: seat.seatId,
                accountId: account.id,
                timestamp: Date.now(),
                error: `Agent Plan 查询失败: ${afpError}`
              })
            }
          } else if (seat.scene === 'coding_plan') {
            const snap: UsageSnapshot = {
              seatId: seat.seatId,
              accountId: account.id,
              timestamp: Date.now()
            }
            if (codingPlan && codingPlan.Status === 'Running') {
              snap.info = `${codingPlan.PlanType} 套餐生效中`
              // 个人版 Coding Plan 用量 (未公开文档 API)
              try {
                const usage = await client.getCodingPlanUsage()
                for (const q of usage.QuotaUsage ?? []) {
                  const lv = (q.Level || '').toLowerCase()
                  const resetMs = q.ResetTimestamp > 0 ? q.ResetTimestamp * 1000 : undefined
                  if (['session', '5-hour', 'five_hour', '5h'].includes(lv)) {
                    snap.shortTermUsage = q.Percent
                    snap.shortTermResetTime = resetMs
                  } else if (['weekly', 'week'].includes(lv)) {
                    snap.weeklyUsage = q.Percent
                    snap.weeklyResetTime = resetMs
                  } else if (['monthly', 'month'].includes(lv)) {
                    snap.monthlyUsage = q.Percent
                    snap.monthlyResetTime = resetMs
                  }
                }
                console.log('[monitor] coding plan usage:', JSON.stringify(usage))
              } catch (e: any) {
                console.error('[monitor] GetCodingPlanUsage failed:', e.message)
                snap.info = `${codingPlan.PlanType} 套餐生效中（用量查询暂不可用）`
              }
            } else if (codingPlan) {
              snap.info = `${codingPlan.PlanType} 套餐已过期`
            } else {
              snap.info = '未开通 Coding Plan'
            }
            results.push(snap)
          }
        }
        continue
      }

      // ============ 企业版: 席位级查询 ============
      // Coding Plan 席位
      const codingSeats = enterpriseSeats.filter(s => s.scene === 'coding_plan')
      if (codingSeats.length > 0) {
        try {
          // 批量查询
          const seatIds = codingSeats.map(s => s.seatId)
          const resp = await client.listSeatInfoUsages(seatIds, 'coding_plan')
          for (const item of resp.Items || []) {
            results.push({
              seatId: item.SeatID,
              accountId: account.id,
              timestamp: Date.now(),
              shortTermUsage: item.ShortTermUsage,
              weeklyUsage: item.WeeklyUsage,
              monthlyUsage: item.MonthlyUsage,
              shortTermResetTime: item.ShortTermResetMilestone,
              weeklyResetTime: item.WeeklyResetMilestone,
              monthlyResetTime: item.MonthlyResetMilestone
            })
          }
        } catch (e: any) {
          // 批量失败，逐个尝试
          for (const seat of codingSeats) {
            try {
              const usage = await client.getSeatInfoUsage(seat.seatId, 'coding_plan')
              results.push({
                seatId: seat.seatId,
                accountId: account.id,
                timestamp: Date.now(),
                shortTermUsage: usage.ShortTermUsage,
                weeklyUsage: usage.WeeklyUsage,
                monthlyUsage: usage.MonthlyUsage,
                shortTermResetTime: usage.ShortTermResetMilestone,
                weeklyResetTime: usage.WeeklyResetMilestone,
                monthlyResetTime: usage.MonthlyResetMilestone
              })
            } catch (e2: any) {
              results.push({ seatId: seat.seatId, accountId: account.id, timestamp: Date.now(), error: e2.message })
            }
          }
        }
      }

      // Agent Plan 席位
      const agentSeats = enterpriseSeats.filter(s => s.scene === 'agent_plan')
      if (agentSeats.length > 0) {
        try {
          const seatIds = agentSeats.map(s => s.seatId)
          const resp = await client.getSeatAFPUsage(seatIds)
          for (const item of resp.SeatAFPUsages || []) {
            results.push({
              seatId: item.SeatID,
              accountId: account.id,
              timestamp: Date.now(),
              afpFiveHour: parseAfpWindow(item.AFPFiveHour),
              afpDaily: parseAfpWindow(item.AFPDaily),
              afpWeekly: parseAfpWindow(item.AFPWeekly),
              afpMonthly: parseAfpWindow(item.AFPMonthly)
            })
          }
        } catch (e: any) {
          for (const seat of agentSeats) {
            results.push({ seatId: seat.seatId, accountId: account.id, timestamp: Date.now(), error: e.message })
          }
        }
      }
    }

    // 更新缓存
    for (const snap of results) {
      this.snapshots.set(snap.seatId, snap)
    }
    return results
  }

  getError(seatId: string): string | undefined {
    return this.lastError.get(seatId)
  }
}

function parseAfpWindow(w: { Quota: string; Used: string; ResetTime: number; SubscribeTime: number }) {
  return {
    quota: parseFloat(w.Quota) || 0,
    used: parseFloat(w.Used) || 0,
    resetTime: w.ResetTime,
    subscribeTime: w.SubscribeTime
  }
}
