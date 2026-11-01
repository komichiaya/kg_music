/**
 * 系统托盘（Main 进程）
 *
 * 设计取舍：
 * - 菜单整份重建而不是去改单项 checked：Electron 的 context menu 一旦设置就
 *   不可变，重建比跟踪引用可靠，代价只有几十微秒。
 * - 托盘只做「窗口 / 播放形态」这类全局动作，不掺业务（上一首、收藏等）。
 *   播放控制已有 Media Session 与窗口内快捷键，托盘再放一套只会让状态更难对齐。
 * - 图标来源 `process.env.VITE_PUBLIC`：开发态指向 public/、打包后指向 dist/，
 *   两处都由 vite 的 public 复制机制产出 tray.ico / tray.png。
 */
import { BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import path from 'node:path'
import type { TrayCommand, TrayState } from '../../src/types/kugou'
import { getLyricWindow, toggleLyricWindow } from './lyricWindow'
import { systemPrefs } from './systemPrefs'
import { isMiniWindow } from './windowMode'

/**
 * 托盘悬浮文案
 *
 * 不用 app.getName()：它取的是 package.json 的 name（`music-app`，同时也是
 * userData 目录名，不宜改成中文），这里要的是给用户看的中文名。
 */
const APP_DISPLAY_NAME = '酷狗音乐概念版'

export interface TrayHandlers {
  /** 显示并聚焦主窗口（已销毁时重建） */
  show: () => void
  hide: () => void
  /** 进入/退出迷你播放器 */
  setMini: (enabled: boolean) => void
  /** 打开设置页（检查更新的入口在这里） */
  openSettings: () => void
  /** 走与「关闭窗口 → 退出」一致的回收流程 */
  quit: () => void
}

let tray: Tray | null = null
let handlers: TrayHandlers | null = null
let windowGetter: () => BrowserWindow | null = () => null
let available = false

function publicFile(name: string) {
  const root = process.env.VITE_PUBLIC ?? path.join(process.env.APP_ROOT ?? '', 'dist')
  return path.join(root, name)
}

/**
 * 托盘图标
 *
 * Windows 用多尺寸 .ico（16/20/24 缩放都能取到清晰帧），macOS / Linux 用 png。
 * 取不到时返回 null 而不是抛错——没有托盘总比启动失败好。
 */
function trayImage() {
  const file = process.platform === 'win32' ? publicFile('tray.ico') : publicFile('tray.png')
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) return null
  // 高 DPI 下托盘会按缩放取帧，模板图（macOS）交给系统着色
  return process.platform === 'darwin' ? image.resize({ width: 18, height: 18 }) : image
}

function currentWindow() {
  const target = windowGetter()
  return target && !target.isDestroyed() ? target : null
}

function isVisible() {
  const target = currentWindow()
  return Boolean(target && target.isVisible() && !target.isMinimized())
}

function isMini() {
  const target = currentWindow()
  return Boolean(target && isMiniWindow(target))
}

/** 当前托盘相关状态（同步给渲染层做提示） */
export function trayState(): TrayState {
  return {
    available,
    windowVisible: isVisible(),
    mini: isMini(),
    lyricOpen: Boolean(getLyricWindow()),
  }
}

/**
 * 托盘是否真的可用
 *
 * 主进程的「关闭到托盘」拦截必须查这个：没有托盘还把窗口藏起来，
 * 用户就再也找不到窗口了（任务栏图标也随 hide 一起消失）。
 */
export function trayAvailable() {
  return available
}

function broadcast() {
  const next = trayState()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('system:tray-state', next)
  }
}

function buildMenu() {
  const prefs = systemPrefs.snapshot()
  const visible = isVisible()
  const mini = isMini()
  const lyricOpen = Boolean(getLyricWindow())

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: visible ? '隐藏主窗口' : '显示主窗口',
      click: () => (visible ? handlers?.hide() : handlers?.show()),
    },
    {
      label: '迷你播放器',
      type: 'checkbox',
      checked: mini,
      click: (item) => handlers?.setMini(item.checked),
    },
    {
      label: '桌面歌词',
      type: 'checkbox',
      checked: lyricOpen,
      click: () => {
        toggleLyricWindow()
        refreshTray()
      },
    },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: Boolean(prefs?.autoStart),
      click: (item) => {
        // 托盘改的是真实系统状态，同时通过 system:preferences 广播回渲染层，
        // 否则设置页的开关会和实际不一致
        void systemPrefs.patch({ autoStart: item.checked }).then(() => refreshTray())
      },
    },
    { label: '设置…', click: () => handlers?.openSettings() },
    { type: 'separator' },
    { label: '退出', click: () => handlers?.quit() },
  ]

  return Menu.buildFromTemplate(template)
}

/** 重建菜单并广播状态（窗口显隐、迷你态、歌词窗、自启变化后都要调） */
export function refreshTray() {
  if (!tray) return
  tray.setContextMenu(buildMenu())
  tray.setToolTip(APP_DISPLAY_NAME)
  broadcast()
}

/**
 * 首次「关闭到托盘」时提示一次
 *
 * 只在 Windows 用气泡提示：macOS 的通知需要用户授权，Linux 各桌面实现不一，
 * 强制弹一个系统通知反而更打扰。提示过就落盘，避免每次关窗都弹。
 */
export function hintTrayOnce() {
  if (!tray) return
  if (systemPrefs.snapshot()?.trayHintShown) return
  void systemPrefs.patch({ trayHintShown: true })
  if (process.platform !== 'win32') return

  try {
    tray.displayBalloon({
      title: '仍在后台运行',
      content: '窗口已最小化到托盘，播放不会中断。右键托盘图标可退出。',
    })
  } catch (error) {
    console.warn('[tray] 气泡提示失败', error)
  }
}

/**
 * 创建托盘
 *
 * 返回是否创建成功。`available` 单独暴露给渲染层：Linux 无托盘宿主时
 * `new Tray()` 仍可能不报错但图标不可见，设置页据此提示而不是假装开关有效。
 */
export function createTray(getter: () => BrowserWindow | null, nextHandlers: TrayHandlers) {
  windowGetter = getter
  handlers = nextHandlers

  if (tray) {
    refreshTray()
    return available
  }

  const image = trayImage()
  if (!image) {
    console.warn('[tray] 未找到托盘图标，跳过托盘创建')
    available = false
    return false
  }

  try {
    tray = new Tray(image)
  } catch (error) {
    console.warn('[tray] 创建托盘失败', error)
    available = false
    return false
  }

  available = true
  // 单击：始终把窗口带回前台（最小化/被遮挡时都需要），不做「点一下隐藏」
  // 那种切换——用户点托盘图标的意图几乎总是「我要看到它」。
  tray.on('click', () => handlers?.show())
  tray.on('double-click', () => handlers?.show())

  refreshTray()
  return available
}

export function destroyTray() {
  tray?.destroy()
  tray = null
  available = false
}

export type { TrayCommand }
