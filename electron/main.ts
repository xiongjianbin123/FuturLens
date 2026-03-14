import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  Menu,
  Tray,
  nativeImage
} from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

// ─── 窗口状态 ───────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let isMousePassThrough = true   // 默认"观察模式"（鼠标穿透）
let tray: Tray | null = null

// ─── 创建主窗口 ──────────────────────────────────────────────────────────────
function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,

    // ── 透明浮层核心配置 ──
    transparent: true,          // 窗口透明
    frame: false,               // 无边框
    alwaysOnTop: true,          // 始终置顶
    backgroundColor: '#00000000', // 完全透明背景（Windows 关键）
    hasShadow: false,           // 无阴影

    // ── 安全与性能 ──
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },

    // ── 初始状态 ──
    skipTaskbar: false,
    resizable: true,
    focusable: true,            // 画图模式需要焦点
    show: false                 // 先隐藏，等 ready-to-show
  })

  // 初始化为观察模式（穿透）
  mainWindow.setIgnoreMouseEvents(true, { forward: true })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // 开发环境加载 Vite 开发服务器
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../../index.html'))
  }

  // 注册全局快捷键
  registerShortcuts()

  // 创建系统托盘
  setupTray()
}

// ─── 快捷键注册 ──────────────────────────────────────────────────────────────
function registerShortcuts(): void {
  // Alt+S：切换鼠标穿透模式
  globalShortcut.register('Alt+S', () => {
    toggleMousePassThrough()
  })

  // Alt+Q：退出程序
  globalShortcut.register('Alt+Q', () => {
    app.quit()
  })

  // Alt+H：隐藏/显示窗口
  globalShortcut.register('Alt+H', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
    }
  })
}

// ─── 切换鼠标穿透 ────────────────────────────────────────────────────────────
function toggleMousePassThrough(): void {
  if (!mainWindow) return

  isMousePassThrough = !isMousePassThrough

  if (isMousePassThrough) {
    // 观察模式：鼠标穿透，点击下方文华财经
    mainWindow.setIgnoreMouseEvents(true, { forward: true })
    // 降低窗口焦点优先级，让文华财经可以接收输入
    mainWindow.blur()
  } else {
    // 画图模式：拦截鼠标，允许在浮层上操作
    mainWindow.setIgnoreMouseEvents(false)
    mainWindow.focus()
  }

  // 通知渲染进程更新 UI 状态
  mainWindow.webContents.send('mode-changed', {
    mode: isMousePassThrough ? 'observe' : 'draw'
  })
}

// ─── IPC 通信处理 ────────────────────────────────────────────────────────────
function setupIPC(): void {
  // 渲染进程请求切换模式
  ipcMain.on('toggle-mode', () => {
    toggleMousePassThrough()
  })

  // 渲染进程查询当前模式
  ipcMain.handle('get-mode', () => {
    return isMousePassThrough ? 'observe' : 'draw'
  })

  // 窗口拖动（无边框窗口需要自定义拖动区域）
  ipcMain.on('window-drag-start', (_event, { mouseX, mouseY }) => {
    if (!mainWindow) return
    const [winX, winY] = mainWindow.getPosition()
    // 记录拖动起点（实际拖动在 mousemove 中处理）
    void mouseX; void mouseY; void winX; void winY
  })

  // 设置窗口位置（价格对齐时使用）
  ipcMain.on('set-window-bounds', (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    mainWindow?.setBounds(bounds)
  })

  // 获取窗口当前 bounds（用于价格对齐计算）
  ipcMain.handle('get-window-bounds', () => {
    return mainWindow?.getBounds()
  })

  // 设置窗口透明度（可选，用于亮度调节）
  ipcMain.on('set-opacity', (_event, opacity: number) => {
    mainWindow?.setOpacity(Math.max(0.1, Math.min(1, opacity)))
  })
}

// ─── 系统托盘 ────────────────────────────────────────────────────────────────
function setupTray(): void {
  // 创建一个简单的托盘图标（16x16 透明 PNG）
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAADWSURBVDiNpZMxDoMwDEUfqgtj7sDCBbgJHIGzcBMOwAE6dGDrwNiBgYGBgQE6VKqqKlVV1R9FUfRSSqmU8t57770HgHMOay0AjDEws+ScI4TAvu+cc0IIkVJijDHGWGullFJKKaW01lprjDHGWGullFJKKaXWWmuttdYYY4yx1lprrbXWGmOstdZaa6211hhjjLXWWmuttcYYY6y11lprrTHGGGOttdZaa40xxlhrrZXWWmuMMcZYa6211lpjjDHGWmsttdYaY4wx1lpLrbXWGmOMsdZaAAAA//9tDy0mAAAABklEQVQI12NgAAIABQAABjABpwAAAABJRU5ErkJggg=='
  )

  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'FuturLens - 期货辅助工具',
      enabled: false
    },
    { type: 'separator' },
    {
      label: '显示/隐藏 (Alt+H)',
      click: () => {
        if (mainWindow?.isVisible()) mainWindow.hide()
        else mainWindow?.show()
      }
    },
    {
      label: '切换模式 (Alt+S)',
      click: () => toggleMousePassThrough()
    },
    { type: 'separator' },
    {
      label: '退出 (Alt+Q)',
      click: () => app.quit()
    }
  ])

  tray.setToolTip('FuturLens 期货辅助')
  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    if (mainWindow?.isVisible()) mainWindow.hide()
    else mainWindow?.show()
  })
}

// ─── 应用生命周期 ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Windows 透明度关键设置：禁用硬件加速（如遇透明失效时）
  // 注意：优先不禁用，仅在透明失效时取消注释
  // app.disableHardwareAcceleration()

  setupIPC()
  createWindow()
})

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
