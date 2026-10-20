/**
 * 桌面歌词窗口（Main 进程）
 *
 * 独立于主窗口的置顶小窗：无边框 + 透明 + 置顶 + 不占任务栏。
 * 数据由主窗口通过 IPC 推送（`lyric-window:sync`），这里只做转发，
 * 窗口本身不发起任何业务请求。
 */
import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

const WIDTH = 860
const HEIGHT = 176

let lyricWin: BrowserWindow | null = null

/** 把窗口开关状态广播给主窗口，避免设置项与实际窗口不同步 */
function broadcastState(open: boolean) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win === lyricWin) continue
    win.webContents.send('lyric-window:state', open)
  }
}

function preloadPath() {
  return path.join(moduleDir, 'preload.cjs')
}

function rendererDist() {
  const root = process.env.APP_ROOT ?? path.join(moduleDir, '..')
  return path.join(root, 'dist')
}

function isAlive(): boolean {
  return Boolean(lyricWin && !lyricWin.isDestroyed())
}

export function getLyricWindow(): BrowserWindow | null {
  return isAlive() ? lyricWin : null
}

export async function openLyricWindow(): Promise<BrowserWindow> {
  if (isAlive()) {
    lyricWin?.showInactive()
    return lyricWin as BrowserWindow
  }

  const area = screen.getPrimaryDisplay().workArea

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: Math.round(area.x + (area.width - WIDTH) / 2),
    y: Math.round(area.y + area.height - HEIGHT - 56),
    minWidth: 520,
    minHeight: 120,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    title: '桌面歌词',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.once('ready-to-show', () => win.showInactive())
  win.on('closed', () => {
    lyricWin = null
    broadcastState(false)
  })

  lyricWin = win

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    await win.loadURL(`${devUrl.replace(/\/+$/, '')}/#/lyric-window`)
  } else {
    await win.loadFile(path.join(rendererDist(), 'index.html'), { hash: '/lyric-window' })
  }

  broadcastState(true)
  return win
}

export function closeLyricWindow(): void {
  if (isAlive()) lyricWin?.close()
  lyricWin = null
}

/** 返回切换后的状态：true = 已打开 */
export function toggleLyricWindow(): boolean {
  if (isAlive()) {
    closeLyricWindow()
    return false
  }
  void openLyricWindow()
  return true
}

export function pushLyricData(payload: unknown): void {
  if (!isAlive()) return
  lyricWin?.webContents.send('lyric-window:data', payload)
}
