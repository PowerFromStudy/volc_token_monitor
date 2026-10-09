/**
 * 主进程入口 - 双窗口架构
 * ballWindow: 80x80 桌面全局悬浮球 (透明/无边框/置顶)
 * panelWindow: 380x520 展开面板 (透明/无边框/置顶)
 */
import { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain } from 'electron'
import { join } from 'path'
import { AppStore } from './store/app-store'
import { UsageMonitor } from './services/usage-monitor'
import { AlertEngine } from './services/alert-engine'
import { registerIpcHandlers } from './ipc/handlers'

let ballWindow: BrowserWindow | null = null
let panelWindow: BrowserWindow | null = null
let tray: Tray | null = null
let monitor: UsageMonitor
let alertEngine: AlertEngine
let store: AppStore

const BALL_SIZE = 80

function createBallWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize

  ballWindow = new BrowserWindow({
    width: BALL_SIZE,
    height: BALL_SIZE,
    x: sw - BALL_SIZE - 20,
    y: sh - BALL_SIZE - 20,
    show: true,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 置顶级别: 悬浮在所有窗口之上
  ballWindow.setAlwaysOnTop(true, 'screen-saver')

  if (process.env['ELECTRON_RENDERER_URL']) {
    ballWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#ball')
  } else {
    ballWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'ball' })
  }

  // 鼠标穿透: 只对透明区域生效
  ballWindow.setIgnoreMouseEvents(false)

  ballWindow.on('closed', () => { ballWindow = null })
}

function createPanelWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize

  panelWindow = new BrowserWindow({
    width: 380,
    height: 520,
    x: sw - 380 - 20,
    y: sh - 520 - BALL_SIZE - 30,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  panelWindow.setAlwaysOnTop(true, 'screen-saver')

  if (process.env['ELECTRON_RENDERER_URL']) {
    panelWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#panel')
  } else {
    panelWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'panel' })
  }

  // 失焦时自动隐藏面板
  panelWindow.on('blur', () => {
    panelWindow?.hide()
  })

  panelWindow.on('closed', () => { panelWindow = null })
}

/** 将面板定位到悬浮球旁边 */
function positionPanel() {
  if (!ballWindow || !panelWindow) return
  const [bx, by] = ballWindow.getPosition()
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize

  let px = bx - 380 + BALL_SIZE  // 面板在球左侧
  let py = by - 520 + BALL_SIZE   // 面板在球上方

  // 边界检查: 不够空间就翻到另一侧
  if (px < 10) px = bx + BALL_SIZE + 10       // 球右侧
  if (py < 10) py = by + BALL_SIZE + 10       // 球下方
  if (py + 520 > sh) py = sh - 520 - 10       // 不超出底部
  if (px + 380 > sw) px = sw - 380 - 10        // 不超出右侧

  panelWindow.setPosition(px, py)
}

function togglePanel() {
  if (!panelWindow || !ballWindow) return
  if (panelWindow.isVisible()) {
    panelWindow.hide()
  } else {
    positionPanel()
    panelWindow.show()
    panelWindow.focus()
  }
}

function createTray() {
  const iconPng = 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAIGNIUk0AAHolAACAgwAA+f8AAIDpAAB1MAAA6mAAADqYAAAXb5Lf3gAAABVJREFUGNNjYBgJo4JgQAELxjAJRiUAARIMAVMcBpRTGTsAAAAASUVORK5CYII='
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${iconPng}`)
  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示面板', click: () => togglePanel() },
    { label: '立即刷新用量', click: () => monitor.refreshAll() },
    { type: 'separator' },
    { label: '退出', click: () => { app.exit() } }
  ])
  tray.setToolTip('火山 Token 监控')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => togglePanel())
}

// 悬浮球拖拽: 接收渲染进程的移动增量
ipcMain.on('ball:move', (_e, dx: number, dy: number) => {
  if (!ballWindow) return
  const [x, y] = ballWindow.getPosition()
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const nx = Math.max(0, Math.min(sw - BALL_SIZE, x + dx))
  const ny = Math.max(0, Math.min(sh - BALL_SIZE, y + dy))
  ballWindow.setPosition(nx, ny)
  // 如果面板可见，跟随移动
  if (panelWindow?.isVisible()) positionPanel()
})

// 切换面板
ipcMain.on('panel:toggle', () => togglePanel())

// 关闭面板
ipcMain.on('panel:close', () => panelWindow?.hide())

app.whenReady().then(() => {
  store = new AppStore()
  const settings = store.getSettings()
  alertEngine = new AlertEngine(settings)
  monitor = new UsageMonitor(store.keyManager, store.getSeats(), settings)

  createBallWindow()
  createPanelWindow()
  createTray()
  registerIpcHandlers(
    store,
    monitor,
    alertEngine,
    () => panelWindow,
    () => [ballWindow, panelWindow].filter((w): w is BrowserWindow => !!w)
  )

  monitor.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createBallWindow()
      createPanelWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Windows 下不退出，保持托盘运行
})

app.on('before-quit', () => {
  monitor.stop()
})
