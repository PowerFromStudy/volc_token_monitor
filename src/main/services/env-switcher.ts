/**
 * 环境变量切换服务 (Windows)
 * 写入用户级环境变量，并广播 WM_SETTINGCHANGE 通知系统刷新
 */
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export interface EnvVars {
  ARK_API_KEY?: string
  ARK_BASE_URL?: string
  ARK_MODEL?: string
}

/** 火山方舟专属 Base URL */
export const ARK_BASE_URLS = {
  coding: 'https://ark.cn-beijing.volces.com/api/v3',
  agent: 'https://ark.cn-beijing.volces.com/api/v3'
}

export class EnvSwitcher {
  /**
   * 写入用户级环境变量
   * 使用 reg add HKCU\Environment
   */
  async setEnv(key: string, value: string): Promise<void> {
    // 避免引号问题，使用 PowerShell 转义
    const escaped = value.replace(/'/g, "''")
    const cmd = `reg add "HKCU\\Environment" /v "${key}" /t REG_EXPAND_SZ /d "${escaped}" /f`
    await execAsync(cmd)
  }

  async setEnvs(vars: EnvVars): Promise<void> {
    for (const [k, v] of Object.entries(vars)) {
      if (v !== undefined && v !== null) {
        await this.setEnv(k, v)
      }
    }
    await this.broadcastChange()
  }

  async deleteEnv(key: string): Promise<void> {
    await execAsync(`reg delete "HKCU\\Environment" /v "${key}" /f`)
    await this.broadcastChange()
  }

  /**
   * 广播 WM_SETTINGCHANGE 通知系统环境变量变更
   * 通过 PowerShell 调用 SendMessageTimeout
   */
  private async broadcastChange(): Promise<void> {
    const ps = `
      Add-Type -Namespace Win32 -Name Native -MemberDefinition '[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'
      $HWND_BROADCAST = [IntPtr]0xffff
      $WM_SETTINGCHANGE = 0x1a
      $result = [UIntPtr]::Zero
      [Win32.Native]::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result) | Out-Null
    `
    try {
      await execAsync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`)
    } catch {
      // 忽略广播失败，环境变量已写入注册表
    }
  }

  /** 读取当前用户环境变量 */
  async getEnv(key: string): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync(`reg query "HKCU\\Environment" /v "${key}"`)
      const match = stdout.match(/REG_\w+\s+(.+)/)
      return match ? match[1].trim() : undefined
    } catch {
      return undefined
    }
  }
}
