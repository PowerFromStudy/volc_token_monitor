"use strict";
const electron = require("electron");
const api = {
  // 账号
  listAccounts: () => electron.ipcRenderer.invoke("account:list"),
  addAccount: (account) => electron.ipcRenderer.invoke("account:add", account),
  updateAccount: (id, patch) => electron.ipcRenderer.invoke("account:update", id, patch),
  removeAccount: (id) => electron.ipcRenderer.invoke("account:remove", id),
  // 席位
  listSeats: () => electron.ipcRenderer.invoke("seat:list"),
  syncSeats: (accountId) => electron.ipcRenderer.invoke("seat:sync", accountId),
  addSeat: (seat) => electron.ipcRenderer.invoke("seat:add", seat),
  removeSeat: (seatId) => electron.ipcRenderer.invoke("seat:remove", seatId),
  // 用量
  listUsage: () => electron.ipcRenderer.invoke("usage:list"),
  refreshUsage: () => electron.ipcRenderer.invoke("usage:refresh"),
  // 切换 Key (写入 ~/.claude/settings.json)
  switchEnv: (seatId) => electron.ipcRenderer.invoke("env:switch", seatId),
  // 模型
  listModels: () => electron.ipcRenderer.invoke("model:list"),
  switchModel: (model) => electron.ipcRenderer.invoke("model:switch", model),
  getCurrentModel: () => electron.ipcRenderer.invoke("model:current"),
  // 设置
  getSettings: () => electron.ipcRenderer.invoke("settings:get"),
  setSettings: (settings) => electron.ipcRenderer.invoke("settings:set", settings),
  // 激活席位
  getActiveSeat: () => electron.ipcRenderer.invoke("active:get"),
  // 悬浮球: 移动窗口 (增量)
  moveBall: (dx, dy) => electron.ipcRenderer.send("ball:move", dx, dy),
  // 面板: 切换/关闭
  togglePanel: () => electron.ipcRenderer.send("panel:toggle"),
  closePanel: () => electron.ipcRenderer.send("panel:close"),
  // 事件监听
  onStatusUpdate: (cb) => {
    electron.ipcRenderer.removeAllListeners("status:update");
    electron.ipcRenderer.on("status:update", (_e, s) => cb(s));
  },
  onUsageUpdate: (cb) => {
    electron.ipcRenderer.removeAllListeners("usage:update");
    electron.ipcRenderer.on("usage:update", (_e, snaps) => cb(snaps));
  },
  onActiveChanged: (cb) => {
    electron.ipcRenderer.removeAllListeners("active:changed");
    electron.ipcRenderer.on("active:changed", (_e, id) => cb(id));
  }
};
electron.contextBridge.exposeInMainWorld("volc", api);
