/**
 * Electron 主进程
 *
 * 职责（文档 §2.1）：
 * - 无边框窗口 + 自定义标题栏，尺寸/位置/最大化状态持久化
 * - 单实例锁，二次启动仅聚焦已有窗口
 * - 上游 KuGouMusicApi 子进程守护（见 services/upstream.ts）
 * - IPC 调度（见 services/ipc.ts）：窗口控制、凭据存储、上游状态
 * - 安全基线：contextIsolation、无 nodeIntegration、外链/导航白名单
 */
import { app, BrowserWindow, Menu, screen, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bindUpstreamBroadcast, registerIpcHandlers } from './services/ipc'
import { readWindowState, writeWindowState, type WindowState } from './services/store'
import { upstream } from './services/upstream'
import { closeLyricWindow } from './services/lyricWindow'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

const isMac = process.platform === 'darwin'

// 音乐播放器需要「非用户手势」也能出声：自动连播、重启后继续播放都依赖它。
// 否则 Chromium 的自动播放策略会把 audio.play() 直接拒掉。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const DEFAULT_BOUNDS = { width: 1280, height: 800 }

let win: BrowserWindow | null = null
let quitReady = false
let saveTimer: NodeJS.Timeout | null = null

/**
 * 校验历史窗口位置是否仍落在某块屏幕上。
 * 显示器热插拔后旧坐标可能完全在屏幕外，此时丢弃位置信息只保留尺寸。
 */
function sanitizeBounds(state: WindowState | null) {
  if (!state) return { ...DEFAULT_BOUNDS }

  const width = Math.max(960, Math.round(state.width))
  const height = Math.max(640, Math.round(state.height))

  if (typeof state.x !== 'number' || typeof state.y !== 'number') return { width, height }

  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      state.x! < area.x + area.width &&
      state.x! + width > area.x &&
      state.y! < area.y + area.height &&
      state.y! + height > area.y
    )
  })

  return visible ? { width, height, x: Math.round(state.x), y: Math.round(state.y) } : { width, height }
}

function collectWindowState(target: BrowserWindow): WindowState {
  const bounds = target.isMaximized() ? target.getNormalBounds() : target.getBounds()
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized: target.isMaximized(),
  }
}

function scheduleSaveWindowState(target: BrowserWindow) {
  if (target.isDestroyed()) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!target.isDestroyed()) void writeWindowState(collectWindowState(target))
  }, 400)
}

async function createWindow() {
  const state = await readWindowState()

  win = new BrowserWindow({
    ...sanitizeBounds(state),
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0e14',
    title: '酷狗音乐 · 概念版',
    icon: path.join(process.env.VITE_PUBLIC ?? '', 'electron-vite.svg'),
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM 预加载脚本要求关闭沙箱；特权能力仍被限制在 preload 白名单内
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
    },
  })

  if (state?.maximized) win.maximize()

  win.once('ready-to-show', () => win?.show())

  win.webContents.on('did-finish-load', () => {
    console.log('[main] 渲染层加载完成')
  })

  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[main] 渲染层加载失败 code=${code} desc=${description} url=${url}`)
  })

  // 最大化状态实时同步给自定义标题栏
  const notifyMaximize = () => {
    if (!win || win.isDestroyed()) return
    win.webContents.send('window:maximized-changed', win.isMaximized())
  }
  win.on('maximize', notifyMaximize)
  win.on('unmaximize', notifyMaximize)

  win.on('resize', () => win && scheduleSaveWindowState(win))
  win.on('move', () => win && scheduleSaveWindowState(win))

  win.on('close', () => {
    if (win && !win.isDestroyed()) void writeWindowState(collectWindowState(win))
  })

  win.on('closed', () => {
    win = null
    // 主窗口关闭时一并回收桌面歌词窗口，否则 window-all-closed 不会触发
    closeLyricWindow()
  })

  // 外链一律交给系统浏览器；应用内不允许新开窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 阻止渲染进程被导航到应用之外的页面
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = VITE_DEV_SERVER_URL
    const allowed = devUrl ? url.startsWith(devUrl) : url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })

  if (VITE_DEV_SERVER_URL) {
    // 开发期把渲染层控制台转发到终端，便于定位 Vue / 路由运行时告警
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level >= 2) console.log(`[renderer] ${message} (${sourceId}:${line})`)
    })
    await win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    await win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// 单实例：重复启动时聚焦已有窗口，避免多个实例争抢上游端口
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.setAppUserModelId('com.kugo.concept')

  // 安全基线：禁止渲染进程创建 webview
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)

    registerIpcHandlers()
    bindUpstreamBroadcast()

    // 上游与窗口并行启动：窗口不等待上游就绪，界面用状态胶囊反馈进度
    void upstream.start()

    await createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })

  // 退出前回收上游子进程，避免端口残留
  app.on('before-quit', (event) => {
    if (quitReady) return
    event.preventDefault()
    quitReady = true
    void upstream.stop().finally(() => {
      app.quit()
    })
  })
}
