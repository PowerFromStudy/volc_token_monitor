/**
 * 预加载脚本 - 暴露安全的 IPC API 给渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // 账号
  listAccounts: () => ipcRenderer.invoke('account:list'),
  addAccount: (account: any) => ipcRenderer.invoke('account:add', account),
  updateAccount: (id: string, patch: any) => ipcRenderer.invoke('account:update', id, patch),
  removeAccount: (id: string) => ipcRenderer.invoke('account:remove', id),
  // 席位
  listSeats: () => ipcRenderer.invoke('seat:list'),
  syncSeats: (accountId: string) => ipcRenderer.invoke('seat:sync', accountId),
  addSeat: (seat: { accountId: string; apiKey: string; scene: 'coding_plan' | 'agent_plan'; remark?: string }) => ipcRenderer.invoke('seat:add', seat),
  removeSeat: (seatId: string) => ipcRenderer.invoke('seat:remove', seatId),
  // 用量
  listUsage: () => ipcRenderer.invoke('usage:list'),
  refreshUsage: () => ipcRenderer.invoke('usage:refresh'),
  // 环境变量
  switchEnv: (seatId: string) => ipcRenderer.invoke('env:switch', seatId),
  getEnv: (key: string) => ipcRenderer.invoke('env:get', key),
  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: any) => ipcRenderer.invoke('settings:set', settings),
  // 激活席位
  getActiveSeat: () => ipcRenderer.invoke('active:get'),
  // 悬浮球: 移动窗口 (增量)
  moveBall: (dx: number, dy: number) => ipcRenderer.send('ball:move', dx, dy),
  // 面板: 切换/关闭
  togglePanel: () => ipcRenderer.send('panel:toggle'),
  closePanel: () => ipcRenderer.send('panel:close'),
  // 事件监听
  onStatusUpdate: (cb: (status: string) => void) => {
    ipcRenderer.removeAllListeners('status:update')
    ipcRenderer.on('status:update', (_e, s) => cb(s))
  },
  onActiveChanged: (cb: (seatId: string) => void) => {
    ipcRenderer.removeAllListeners('active:changed')
    ipcRenderer.on('active:changed', (_e, id) => cb(id))
  }
}

contextBridge.exposeInMainWorld('volc', api)

export type VolcApi = typeof api
