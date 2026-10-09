/**
 * 火山引擎 API 客户端
 * 实现火山引擎标准 HMAC-SHA256 签名算法
 */
import crypto from 'node:crypto'
import axios, { AxiosInstance } from 'axios'

const SERVICE = 'ark'
const REGION = 'cn-beijing'
const HOST = 'ark.cn-beijing.volcengineapi.com'
const VERSION = '2024-01-01'

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest()
}

function hmacSha256Hex(key: string | Buffer, data: string): string {
  return hmacSha256(key, data).toString('hex')
}

function toHex(buf: Buffer): string {
  return buf.toString('hex')
}

export interface VolcApiConfig {
  accessKey: string
  secretKey: string
}

export class VolcApiClient {
  private ak: string
  private sk: string
  private http: AxiosInstance

  constructor(config: VolcApiConfig) {
    this.ak = config.accessKey
    this.sk = config.secretKey
    this.http = axios.create({
      baseURL: `https://${HOST}`,
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  /**
   * 生成火山引擎签名并发起请求
   * 签名算法: HMAC-SHA256 (Volcengine V4)
   */
  async request<T = any>(action: string, body: Record<string, any> = {}): Promise<T> {
    const bodyStr = JSON.stringify(body)
    const contentSha256 = sha256Hex(bodyStr)

    // X-Date: ISO8601 UTC, e.g. 20260101T120000Z
    const now = new Date()
    const xDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const shortDate = xDate.slice(0, 8) // YYYYMMDD

    // 查询参数 (必须参与签名)
    const queryParams: Record<string, string> = {
      Action: action,
      Version: VERSION
    }
    // 规范查询字符串: 按 key 排序, URL 编码
    const sortedKeys = Object.keys(queryParams).sort()
    const canonicalQueryString = sortedKeys
      .map(k => `${k}=${encodeURIComponent(queryParams[k])}`)
      .join('&')

    // 1. 规范请求
    const canonicalHeaders = `content-type:application/json\nhost:${HOST}\nx-content-sha256:${contentSha256}\nx-date:${xDate}\n`
    const signedHeaders = 'content-type;host;x-content-sha256;x-date'
    const canonicalRequest = [
      'POST',
      '/',
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      contentSha256
    ].join('\n')

    // 2. 待签名字符串
    const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`
    const hashedCanonicalRequest = sha256Hex(canonicalRequest)
    const stringToSign = `HMAC-SHA256\n${xDate}\n${credentialScope}\n${hashedCanonicalRequest}`

    // 3. 签名密钥派生
    const kDate = hmacSha256(this.sk, shortDate)
    const kRegion = hmacSha256(kDate, REGION)
    const kService = hmacSha256(kRegion, SERVICE)
    const kSigning = hmacSha256(kService, 'request')

    // 4. 签名
    const signature = toHex(hmacSha256(kSigning, stringToSign))

    // 5. Authorization
    const authorization = `HMAC-SHA256 Credential=${this.ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

    const resp = await this.http.post(`/?${canonicalQueryString}`, bodyStr, {
      headers: {
        'Content-Type': 'application/json',
        'X-Date': xDate,
        'X-Content-Sha256': contentSha256,
        'Authorization': authorization
      }
    })

    const data = resp.data
    if (data.ResponseMetadata?.Error) {
      const err = data.ResponseMetadata.Error
      throw new Error(`[${err.Code}] ${err.Message}`)
    }
    return data.Result ?? data
  }

  // ============ 套餐与席位 ============

  /** 查询个人版套餐信息 (AgentPlan / CodingPlan) */
  getPersonalPlan(plan: 'AgentPlan' | 'CodingPlan') {
    return this.request<{
      PlanType: string
      Status: string
      StartTime: string
      EndTime: string
      AutoRenew: boolean
    }>('GetPersonalPlan', { Plan: plan })
  }

  /**
   * 查询个人版 Coding Plan 用量 (未公开文档 API, 社区已验证)
   * 返回 5h/周/月 已用百分比和重置时间
   */
  getCodingPlanUsage() {
    return this.request<{
      Status?: string
      QuotaUsage?: Array<{
        Level: string          // "session"/"5-hour"/"five_hour"/"5h" | "weekly"/"week" | "monthly"/"month"
        Percent: number        // 已用百分比 0-100
        ResetTimestamp: number // epoch 秒; <=0 表示无重置
      }>
    }>('GetCodingPlanUsage', {})
  }

  /** 查询席位列表 (企业版) */
  listSeatInfos(scene: 'coding_plan_enterprise' | 'agent_plan_enterprise' = 'coding_plan_enterprise') {
    return this.request<{
      Data: Array<{
        SeatID: string
        ApiKey: string
        ApiKeySID?: string
        BizInfo: string
        ExpiredTime: number
        BillingStatus: number
        SeatStatus: number
        IdentityDetail?: string
      }>
      Total: number
    }>('ListSeatInfos', {
      Scene: scene,
      Filter: {},
      PageSize: 100,
      PageNum: 1
    })
  }

  // ============ Coding Plan 用量 ============

  /** 查询单个席位用量 (Coding Plan) - 返回百分比 */
  getSeatInfoUsage(seatId: string, scene?: string) {
    const body: Record<string, any> = { SeatID: seatId, ProjectName: 'default' }
    if (scene) body.Scene = scene
    return this.request<{
      SeatID: string
      ShortTermUsage: number       // 5小时用量 %
      WeeklyUsage: number          // 周用量 %
      MonthlyUsage: number         // 月用量 %
      ShortTermResetMilestone: number
      WeeklyResetMilestone: number
      MonthlyResetMilestone: number
    }>('GetSeatInfoUsage', body)
  }

  /** 批量查询席位用量 (Coding Plan) */
  listSeatInfoUsages(seatIds: string[], scene?: string) {
    const body: Record<string, any> = { SeatIDs: seatIds, ProjectName: 'default' }
    if (scene) body.Scene = scene
    return this.request<{
      Items: Array<{
        SeatID: string
        ShortTermUsage: number
        WeeklyUsage: number
        MonthlyUsage: number
        ShortTermResetMilestone: number
        WeeklyResetMilestone: number
        MonthlyResetMilestone: number
      }>
    }>('ListSeatInfoUsages', body)
  }

  // ============ Agent Plan 用量 (AFP) ============

  /** 个人版 AFP 额度用量 */
  getAFPUsage() {
    return this.request<{
      AFPFiveHour: { Quota: string; Used: string; ResetTime: number; SubscribeTime: number }
      AFPDaily: { Quota: string; Used: string; ResetTime: number; SubscribeTime: number }
      AFPWeekly: { Quota: string; Used: string; ResetTime: number; SubscribeTime: number }
      AFPMonthly: { Quota: string; Used: string; ResetTime: number; SubscribeTime: number }
    }>('GetAFPUsage', {})
  }

  /** 企业版席位 AFP 额度用量 */
  getSeatAFPUsage(seatIds: string[]) {
    return this.request<{
      SeatAFPUsages: Array<{
        SeatID: string
        PlanType: string
        AFPFiveHour: { Quota: string; Used: string; ResetTime: number; SubscribeTime: number }
        AFPDaily: { Quota: string; Used: string; ResetTime: number; SubscribeTime: number }
        AFPWeekly: { Quota: string; Used: string; ResetTime: number; SubscribeTime: number }
        AFPMonthly: { Quota: string; Used: string; ResetTime: number; SubscribeTime: number }
      }>
    }>('GetSeatAFPUsage', { SeatIDs: seatIds })
  }

  // ============ 模型调用明细 ============

  /** 个人版模型调用明细 */
  getUsageDetails(startDate: string, endDate: string, interval: 'Day' | 'Hour' = 'Day') {
    return this.request<{
      Details: Array<{
        Time: number
        ObjectName: string
        Usage: number
        Unit: string
        BillingType: string
      }>
    }>('GetUsageDetails', {
      QueryInterval: interval,
      Filter: { StartTime: startDate, EndTime: endDate }
    })
  }

  // ============ 模型限流 ============

  /** 查询模型限流 */
  listModelRateLimit(names?: string[]) {
    return this.request<{
      Items: Array<{
        FoundationModelName: string
        CurrentRateLimit: { Rpm: number; Tpm: number }
        CurrentTpd: number
        DefaultTpd: number
      }>
    }>('ListModelRateLimit', { FoundationModelNames: names ?? [] })
  }
}
