/**
 * 告警引擎
 * 根据用量快照计算状态，触发桌面通知，判断是否需要自动切换
 */
import { Notification } from 'electron'
import type { UsageSnapshot, Seat, AppSettings, MonitorStatus } from '../../shared/types'

export interface AlertDecision {
  status: MonitorStatus
  needAutoSwitch: boolean
  switchFromSeatId?: string
  message: string
}

export class AlertEngine {
  private settings: AppSettings
  private notified: Set<string> = new Set() // 已通知的 seatId+维度，避免重复

  constructor(settings: AppSettings) {
    this.settings = settings
  }

  setSettings(settings: AppSettings) {
    this.settings = settings
  }

  /** 计算单个席位的 5 小时用量百分比 */
  private getFiveHourPercent(snap: UsageSnapshot): number | undefined {
    if (snap.afpFiveHour && snap.afpFiveHour.quota > 0) {
      return (snap.afpFiveHour.used / snap.afpFiveHour.quota) * 100
    }
    return snap.shortTermUsage
  }

  /** 获取席位的过期时间 (需要 seat 信息) */
  private getExpireDays(seat: Seat): number {
    return Math.ceil((seat.expiredTime - Date.now()) / (1000 * 60 * 60 * 24))
  }

  /**
   * 评估所有席位，返回整体状态和决策
   */
  evaluate(snapshots: UsageSnapshot[], seats: Seat[]): AlertDecision {
    let worstStatus: MonitorStatus = 'ok'
    let needSwitch = false
    let switchFrom: string | undefined
    let messages: string[] = []

    for (const snap of snapshots) {
      if (snap.error) {
        worstStatus = 'danger'
        messages.push(`${snap.seatId} 查询失败: ${snap.error}`)
        continue
      }
      const seat = seats.find(s => s.seatId === snap.seatId)
      const pct = this.getFiveHourPercent(snap)

      // 用量告警
      if (pct !== undefined) {
        if (pct >= this.settings.dangerThreshold) {
          worstStatus = 'danger'
          this.notify(`${seat?.planType ?? ''} 席位 5h 用量已达 ${pct.toFixed(1)}%`, 'danger')
          if (this.settings.autoSwitch && pct >= this.settings.autoSwitchThreshold) {
            needSwitch = true
            switchFrom = snap.seatId
          }
        } else if (pct >= this.settings.warnThreshold) {
          if (worstStatus === 'ok') worstStatus = 'warning'
          this.notify(`${seat?.planType ?? ''} 席位 5h 用量 ${pct.toFixed(1)}%`, 'warning')
        }
      }

      // 到期告警
      if (seat) {
        const days = this.getExpireDays(seat)
        if (days <= this.settings.expireWarnDays && days >= 0) {
          if (worstStatus !== 'danger') worstStatus = 'warning'
          this.notify(`${seat.planType} 席位将在 ${days} 天后到期`, 'warning')
        } else if (days < 0 && seat.billingStatus !== 2) {
          worstStatus = 'danger'
        }
      }
    }

    return {
      status: worstStatus,
      needAutoSwitch: needSwitch,
      switchFromSeatId: switchFrom,
      message: messages.join('\n')
    }
  }

  /** 选择下一个可切换的席位 (5h 余量充足且未过期) */
  pickNextSeat(snapshots: UsageSnapshot[], seats: Seat[], excludeSeatId?: string): Seat | undefined {
    const candidates = seats.filter(s => {
      if (s.seatId === excludeSeatId) return false
      if (s.billingStatus !== 2) return false // 仅 running
      if (s.expiredTime < Date.now()) return false
      const snap = snapshots.find(x => x.seatId === s.seatId)
      if (!snap || snap.error) return false
      const pct = this.getFiveHourPercent(snap)
      if (pct === undefined) return true // 无用量数据也可选
      return pct < 50 // 余量 > 50%
    })
    // 按 5h 余量从多到少排序
    candidates.sort((a, b) => {
      const sa = snapshots.find(x => x.seatId === a.seatId)
      const sb = snapshots.find(x => x.seatId === b.seatId)
      const pa = this.getFiveHourPercent(sa!) ?? 0
      const pb = this.getFiveHourPercent(sb!) ?? 0
      return pa - pb
    })
    return candidates[0]
  }

  private notify(message: string, level: 'warning' | 'danger') {
    const key = `${level}:${message}`
    if (this.notified.has(key)) return
    this.notified.add(key)
    // 1 小时后重置，允许再次通知
    setTimeout(() => this.notified.delete(key), 3600000)

    if (Notification.isSupported()) {
      new Notification({
        title: level === 'danger' ? '火山 Token 告警' : '火山 Token 提醒',
        body: message,
        silent: false
      }).show()
    }
  }
}
