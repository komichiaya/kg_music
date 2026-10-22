/**
 * 窗口模式：迷你播放器（文档 §5.5）
 *
 * 迷你模式把主窗口压缩为 380×120 的悬浮小窗，只保留封面 / 进度 / 三键。
 * 关键约束：
 * - 进入前保存普通模式的 bounds 与窗口能力，退出时原样恢复（含最大化）；
 * - 最小尺寸必须同步改小，否则 setBounds 会被 minWidth/minHeight 夹住；
 * - 迷你期间的 resize/move 不应写入 window-state，否则下次启动会以小窗尺寸打开。
 *   主进程通过 isMiniWindow() 判断，渲染层无需参与。
 */
import { BrowserWindow, screen } from 'electron'

export const MINI_SIZE = { width: 380, height: 120 }
const NORMAL_MIN_SIZE = { width: 960, height: 640 }

interface NormalWindowState {
  bounds: Electron.Rectangle
  maximized: boolean
  resizable: boolean
  maximizable: boolean
  fullScreenable: boolean
}

const savedStates = new WeakMap<BrowserWindow, NormalWindowState>()
const miniWindows = new WeakSet<BrowserWindow>()

export function isMiniWindow(win: BrowserWindow): boolean {
  return !win.isDestroyed() && miniWindows.has(win)
}

/** 把窗口放进当前显示器工作区内，避免小窗落到屏幕外 */
function clampToWorkArea(bounds: Electron.Rectangle, size: { width: number; height: number }) {
  const area = screen.getDisplayMatching(bounds).workArea
  const x = Math.min(Math.max(bounds.x, area.x + 8), area.x + area.width - size.width - 8)
  const y = Math.min(Math.max(bounds.y, area.y + 8), area.y + area.height - size.height - 8)
  return { x: Math.round(x), y: Math.round(y), width: size.width, height: size.height }
}

/**
 * 切换迷你模式。
 * @returns 切换后的迷你状态
 */
export function setMiniWindow(win: BrowserWindow, enabled: boolean): boolean {
  if (win.isDestroyed()) return false
  const current = isMiniWindow(win)
  if (enabled === current) return current

  if (enabled) {
    const maximized = win.isMaximized()
    savedStates.set(win, {
      bounds: maximized ? win.getNormalBounds() : win.getBounds(),
      maximized,
      resizable: win.isResizable(),
      maximizable: win.isMaximizable(),
      fullScreenable: win.isFullScreenable(),
    })

    if (maximized) win.unmaximize()
    // 先放开最小尺寸，再缩窗；顺序反过来会被 960×640 夹住
    win.setMinimumSize(MINI_SIZE.width, MINI_SIZE.height)
    win.setResizable(false)
    win.setMaximizable(false)
    win.setFullScreenable(false)
    win.setAlwaysOnTop(true, 'floating')
    win.setBounds(clampToWorkArea(win.getBounds(), MINI_SIZE))
    miniWindows.add(win)
    return true
  }

  const saved = savedStates.get(win)
  win.setAlwaysOnTop(false)
  win.setFullScreenable(saved?.fullScreenable ?? true)
  win.setResizable(saved?.resizable ?? true)
  win.setMaximizable(saved?.maximizable ?? true)
  win.setMinimumSize(NORMAL_MIN_SIZE.width, NORMAL_MIN_SIZE.height)
  miniWindows.delete(win)

  if (saved) {
    win.setBounds(saved.bounds)
    if (saved.maximized) win.maximize()
  }
  savedStates.delete(win)
  return false
}
