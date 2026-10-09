/**
 * Claude Code 配置写入服务
 * 切换 Key/模型时改写 ~/.claude/settings.json 的 env 块，保留其余所有字段
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Scene } from '../../shared/types'

/** 套餐对应的 Claude Code 接入地址 */
export const PLAN_BASE_URLS: Record<Scene, string> = {
  coding_plan: 'https://ark.cn-beijing.volces.com/api/coding',
  agent_plan: 'https://ark.cn-beijing.volces.com/api/plan'
}

/** 模型档位变量: 切换模型时同步全部档位，避免某档位落到别的模型 */
const MODEL_TIERS = ['OPUS', 'SONNET', 'HAIKU', 'FABLE'] as const

export class ClaudeSettings {
  private get filePath(): string {
    return join(homedir(), '.claude', 'settings.json')
  }

  /** 读取 settings.json；文件不存在返回空对象，格式异常直接抛错 (绝不覆盖坏文件) */
  private load(): Record<string, any> {
    if (!existsSync(this.filePath)) return {}
    const settings = JSON.parse(readFileSync(this.filePath, 'utf-8'))
    if (typeof settings !== 'object' || settings === null) {
      throw new Error('settings.json 格式异常，已中止写入')
    }
    return settings
  }

  private save(settings: Record<string, any>): void {
    writeFileSync(this.filePath, JSON.stringify(settings, null, 2))
  }

  /**
   * 切换激活 Key: 写 token、按套餐选接入地址，模型有值时同步模型变量
   * @param scene 席位套餐类型，决定 ANTHROPIC_BASE_URL
   * @param apiKey 新 Key
   * @param model 可选模型名，空则保留 settings.json 现有模型
   * @since 2026-10-08
   */
  switchKey(scene: Scene, apiKey: string, model?: string): void {
    const settings = this.load()
    const env = (settings.env ??= {})
    env.ANTHROPIC_AUTH_TOKEN = apiKey
    env.ANTHROPIC_BASE_URL = PLAN_BASE_URLS[scene]
    if (model) this.applyModel(env, model)
    this.save(settings)
  }

  /** 只切换模型 (保留当前 token / 接入地址) */
  setModel(model: string): void {
    const settings = this.load()
    this.applyModel((settings.env ??= {}), model)
    this.save(settings)
  }

  /** 当前 settings.json 生效的模型名 */
  getCurrentModel(): string | undefined {
    try {
      return this.load().env?.ANTHROPIC_MODEL
    } catch {
      return undefined
    }
  }

  private applyModel(env: Record<string, any>, model: string): void {
    env.ANTHROPIC_MODEL = model
    for (const tier of MODEL_TIERS) {
      env[`ANTHROPIC_DEFAULT_${tier}_MODEL`] = model
      env[`ANTHROPIC_DEFAULT_${tier}_MODEL_NAME`] = model
    }
  }
}
