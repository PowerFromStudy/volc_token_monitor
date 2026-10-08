/**
 * 共享类型定义 - 主进程与渲染进程共用
 */

/** 火山账号 */
export interface VolcAccount {
  id: string
  name: string
  accessKey: string   // 加密存储的 AK
  secretKey: string   // 加密存储的 SK
  edition: 'personal' | 'team'
  remark?: string
  createdAt: number
}

/** 套餐类型 */
export type PlanType =
  | 'Lite' | 'Pro'                          // Coding Plan
  | 'Small' | 'Medium' | 'Large' | 'Max'    // Agent Plan

/** 业务场景 */
export type Scene = 'coding_plan' | 'agent_plan'

/** 席位 */
export interface Seat {
  seatId: string
  accountId: string
  apiKey: string
  apiKeySid?: string
  planType: PlanType
  scene: Scene
  expiredTime: number        // 到期时间戳 (ms)
  billingStatus: number      // 1:pending 2:running 3:expired 4:reclaimed
  userName?: string
}

/** AFP 窗口用量 (Agent Plan) */
export interface AfpWindow {
  quota: number
  used: number
  resetTime: number          // 下次重置时间戳 (ms)
  subscribeTime: number      // 窗口起始时间戳 (ms)
}

/** 用量快照 */
export interface UsageSnapshot {
  seatId: string
  accountId: string
  timestamp: number
  // Coding Plan: 百分比
  shortTermUsage?: number    // 5小时用量 %
  weeklyUsage?: number       // 周用量 %
  monthlyUsage?: number      // 月用量 %
  shortTermResetTime?: number
  weeklyResetTime?: number
  monthlyResetTime?: number
  // Agent Plan: 绝对值
  afpFiveHour?: AfpWindow
  afpDaily?: AfpWindow
  afpWeekly?: AfpWindow
  afpMonthly?: AfpWindow
  // 错误/信息
  error?: string
  info?: string  // 非错误的信息提示 (如: 套餐生效中)
  // Coding Plan token 明细 (个人版无百分比 API, 用 token 数代替)
  codingTokensUsed?: { fiveHour: number; weekly: number; monthly: number }
}

/** 监控状态 */
export type MonitorStatus = 'ok' | 'warning' | 'danger' | 'idle'

/** 环境变量配置 */
export interface EnvConfig {
  arkApiKey: string
  arkBaseUrl: string
  arkModel: string
}

/** 应用设置 */
export interface AppSettings {
  pollInterval: number       // 轮询间隔 (ms)，默认 120000
  warnThreshold: number      // 告警阈值 %，默认 70
  dangerThreshold: number    // 危险阈值 %，默认 90
  autoSwitch: boolean        // 是否自动切换
  autoSwitchThreshold: number // 自动切换阈值 %，默认 90
  expireWarnDays: number     // 到期提醒天数，默认 3
  theme: string              // 皮肤主题
}

export const DEFAULT_SETTINGS: AppSettings = {
  pollInterval: 120000,
  warnThreshold: 70,
  dangerThreshold: 90,
  autoSwitch: true,
  autoSwitchThreshold: 90,
  expireWarnDays: 3,
  theme: 'default'
}
