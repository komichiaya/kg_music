/**
 * Electron 主进程
 *
 * 职责（文档 §2.1）：
 * - 无边框窗口 + 自定义标题栏，尺寸/位置/最大化状态持久化
 * - 单实例锁，二次启动仅聚焦已有窗口
 * - 上游 KuGouMusicApi 子进程守护（见 services/upstream.ts）
 * - IPC 调度（见 services/ipc.ts）：窗口控制、凭据存储、上游状态
 * - 系统集成（P7，见 services/tray.ts / systemPrefs.ts / updater.ts）：
 *   托盘、开机自启、关闭到托盘、检查更新
 * - 安全基线：contextIsolation、无 nodeIntegration、外链/导航白名单
 */
import { app, BrowserWindow, Menu, screen, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bindSystemBroadcast,
  bindUpstreamBroadcast,
  registerIpcHandlers,
} from './services/ipc'
import { readWindowState, writeWindowState, type WindowState } from './services/store'
import { upstream } from './services/upstream'
import { closeLyricWindow } from './services/lyricWindow'
import { isMiniWindow } from './services/windowMode'
import { AUTOSTART_FLAG, systemPrefs } from './services/systemPrefs'
import {
  createTray,
  destroyTray,
  hintTrayOnce,
  refreshTray,
  trayAvailable,
} from './services/tray'
import type { TrayCommand } from '../src/types/kugou'

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
/**
 * 用户确实要退出（托盘「退出」/系统关机）时为 true。
 * 只有它能让 `close` 事件穿透「关闭到托盘」的拦截，否则隐藏窗口后
 * 应用既不在前台也退不掉。
 */
let forceQuit = false
let saveTimer: NodeJS.Timeout | null = null
/**
 * 最近一次「非最大化、非迷你」的窗口 bounds。
 * 不能依赖 getNormalBounds()：程序化 maximize 之后（尤其跨屏且带 DPI 缩放）
 * 它可能返回最大化后的工作区尺寸，导致下一次启动窗口超出屏幕。
 */
let lastNormalBounds: Electron.Rectangle | null = null
/**
 * 最大化/还原是异步的，过渡期间 getBounds() 会短暂返回接近工作区的尺寸。
 * 这段窗口期内一律不更新 lastNormalBounds，否则会把「最大化后的尺寸」当成用户窗口大小。
 */
let boundsSuppressUntil = 0
/**
 * 开机自启时以「静默进托盘」启动。
 *
 * 由 `systemPrefs.applyAutoStart()` 把 `--autostart` 写进系统登录项，
 * 用户开机后不该被一个播放器窗口挡住；手动启动（无该参数）仍正常显示窗口。
 * 注意此时托盘必须能建起来，否则会变成没有任何入口的僵尸进程，
 * 所以下面建窗逻辑还会再校验一次 `trayAvailable()`。
 */
const launchedByAutoStart = process.argv.includes(AUTOSTART_FLAG)

/**
 * 校验历史窗口位置是否仍落在某块屏幕上。
 * 显示器热插拔后旧坐标可能完全在屏幕外，此时丢弃位置信息只保留尺寸。
 */
function sanitizeBounds(state: WindowState | null) {
  if (!state) return { ...DEFAULT_BOUNDS }

  // 先按目标显示器的工作区夹住尺寸，避免历史脏数据（如最大化后的物理像素）撑爆窗口
  const anchor = {
    x: typeof state.x === 'number' ? state.x : 0,
    y: typeof state.y === 'number' ? state.y : 0,
  }
  const area = screen.getDisplayNearestPoint(anchor).workArea
  const width = Math.max(960, Math.min(Math.round(state.width), area.width))
  const height = Math.max(640, Math.min(Math.round(state.height), area.height))

  if (typeof state.x !== 'number' || typeof state.y !== 'number') return { width, height }

  const visible = screen.getAllDisplays().some((display) => {
    const workArea = display.workArea
    return (
      state.x! < workArea.x + workArea.width &&
      state.x! + width > workArea.x &&
      state.y! < workArea.y + workArea.height &&
      state.y! + height > workArea.y
    )
  })

  return visible ? { width, height, x: Math.round(state.x), y: Math.round(state.y) } : { width, height }
}

/** 只在窗口处于普通形态时记录 bounds；最大化/全屏/迷你一律跳过 */
function rememberNormalBounds(target: BrowserWindow) {
  if (target.isDestroyed()) return
  if (Date.now() < boundsSuppressUntil) return
  if (isMiniWindow(target) || target.isMaximized() || target.isMinimized() || target.isFullScreen()) {
    return
  }
  const bounds = target.getBounds()
  // 启动/恢复时的 maximize 是异步的：过渡阶段会短暂报告「接近工作区」的尺寸，
  // 把它当成普通 bounds 会让下次启动丢失用户窗口大小，这里直接判为不可信。
  const area = screen.getDisplayMatching(bounds).workArea
  if (bounds.width >= area.width - 8 && bounds.height >= area.height - 8) return
  lastNormalBounds = bounds
}

function collectWindowState(target: BrowserWindow): WindowState {
  const current = target.getBounds()
  const maximized = target.isMaximized()
  const bounds = maximized ? lastNormalBounds ?? target.getNormalBounds() : current
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized,
  }
}

function scheduleSaveWindowState(target: BrowserWindow) {
  if (target.isDestroyed()) return
  // 迷你模式只改窗口几何，不能污染普通模式的持久化状态
  if (isMiniWindow(target)) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    // 进入/退出迷你的瞬间也可能触发 resize，回调执行时必须再确认一次
    if (target.isDestroyed() || isMiniWindow(target)) return
    rememberNormalBounds(target)
    void writeWindowState(collectWindowState(target))
  }, 400)
}

async function createWindow() {
  const state = await readWindowState()
  const initial = sanitizeBounds(state)

  win = new BrowserWindow({
    ...initial,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0e14',
    title: '酷狗音乐 · 概念版',
    icon: path.join(process.env.VITE_PUBLIC ?? '', 'app-icon.png'),
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
      // 迷你模式/最小化时仍需推进进度与桌面歌词，禁用后台节流
      backgroundThrottling: false,
    },
  })

  // 记录普通形态基准（必须在 maximize 之前取，否则会拿到最大化后的 bounds）
  lastNormalBounds = {
    width: initial.width,
    height: initial.height,
    x: initial.x ?? 0,
    y: initial.y ?? 0,
  }

  if (state?.maximized) {
    boundsSuppressUntil = Date.now() + 1500
    win.maximize()
  }

  win.once('ready-to-show', () => {
    // 开机自启且托盘可用时静默进托盘：用户刚开机不该被播放器窗口挡住。
    // 托盘不可用则必须显示窗口，否则应用没有任何入口（僵尸进程）。
    if (launchedByAutoStart && trayAvailable()) {
      refreshTray()
      return
    }
    win?.show()
    // show 之前的 getBounds 不可信（会返回接近工作区的占位尺寸），首帧后再校正一次
    if (win && !win.isMaximized()) rememberNormalBounds(win)
  })

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
  win.on('maximize', () => {
    boundsSuppressUntil = Date.now() + 1200
    notifyMaximize()
  })
  win.on('unmaximize', () => {
    boundsSuppressUntil = Date.now() + 1200
    notifyMaximize()
  })

  win.on('resize', () => win && scheduleSaveWindowState(win))
  win.on('move', () => win && scheduleSaveWindowState(win))

  // 托盘菜单的「显示/隐藏」文案依赖可见性，窗口被程序化显示/隐藏时也要重建
  win.on('show', () => refreshTray())
  win.on('hide', () => refreshTray())
  win.on('minimize', () => refreshTray())
  win.on('restore', () => refreshTray())

  win.on('close', (event) => {
    if (win && !win.isDestroyed() && !isMiniWindow(win)) {
      rememberNormalBounds(win)
      void writeWindowState(collectWindowState(win))
    }

    // 「关闭到托盘」：拦下关闭改为隐藏窗口，音乐继续播放。
    // 三个前提缺一不可——
    //   1) 用户没在退出（forceQuit），否则永远退不掉；
    //   2) 偏好为 true；
    //   3) 托盘真的创建成功，否则窗口藏起来就再也找不回来了（应用变僵尸）。
    if (forceQuit || !systemPrefs.closeToTray() || !trayAvailable()) return

    event.preventDefault()
    win?.hide()
    hintTrayOnce()
    refreshTray()
  })

  win.on('closed', () => {
    win = null
    lastNormalBounds = null
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

/**
 * 把托盘点击翻译成渲染层指令
 *
 * 迷你态、路由都在渲染层：Main 直接改窗口几何会让 `settings.miniMode`
 * 与实际窗口形态脱节（下次启动可能又变回小窗），所以这里只转发。
 */
function sendTrayCommand(command: TrayCommand) {
  if (!win || win.isDestroyed()) return
  win.webContents.send('system:tray-command', command)
}

/** 显示主窗口（窗口已被销毁时重建） */
async function showWindow() {
  if (!win || win.isDestroyed()) {
    await createWindow()
    refreshTray()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  refreshTray()
}

function hideWindow() {
  if (!win || win.isDestroyed()) return
  win.hide()
  refreshTray()
}

/** 托盘「退出」：与标题栏关闭走同一条回收路径，但绕过关闭到托盘的拦截 */
function quitApp() {
  forceQuit = true
  app.quit()
}

function setupTray() {
  const created = createTray(() => win, {
    show: () => void showWindow(),
    hide: hideWindow,
    setMini: (enabled) => {
      void showWindow().then(() => sendTrayCommand(enabled ? 'mini' : 'restore'))
    },
    openSettings: () => {
      void showWindow().then(() => sendTrayCommand('settings'))
    },
    quit: quitApp,
  })

  if (!created) {
    console.warn('[main] 托盘不可用，关闭到托盘将被跳过（避免窗口藏起来找不回）')
    return
  }
  console.log('[main] 系统托盘已就绪')
}

// 单实例：重复启动时聚焦已有窗口，避免多个实例争抢上游端口
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    void showWindow()
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
    bindSystemBroadcast()

    // 偏好要在建窗之前读出来：`close` 拦截依赖 closeToTray。
    // load() 只读不写，首次运行没有文件时用内存默认值（不会立刻生成文件）。
    await systemPrefs.load()

    // 托盘先于窗口创建：`ready-to-show` 里判断「开机自启是否静默进托盘」
    // 依赖 trayAvailable()，晚建就会误判成托盘不可用而弹出窗口。
    setupTray()

    // 上游与窗口并行启动：窗口不等待上游就绪，界面用状态胶囊反馈进度
    void upstream.start()

    await createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  })

  app.on('window-all-closed', () => {
    // 走到这里说明主窗口真的被销毁了（关闭到托盘只是 hide，不会触发本事件）。
    // 此时若用户要的是「关掉就退出」，就必须退，否则会留下一个没有任何窗口的
    // 幽灵进程；只有「关闭到托盘 + 托盘可用」才保持常驻。
    if (isMac) return
    // forceQuit 覆盖常驻判断：托盘「退出」、系统注销、before-quit 里二次 app.quit()
    // 都会先置位它，此时不能再因为偏好是「关闭到托盘」而把退出吞掉。
    if (!forceQuit && systemPrefs.closeToTray() && trayAvailable()) return
    app.quit()
  })

  // 退出前回收上游子进程，避免端口残留
  app.on('before-quit', (event) => {
    // 系统关机 / 注销 / 托盘退出都会走到这里：此后不再拦截窗口关闭
    forceQuit = true
    if (quitReady) return
    event.preventDefault()
    quitReady = true
    destroyTray()
    void upstream.stop().finally(() => {
      app.quit()
    })
  })
}
