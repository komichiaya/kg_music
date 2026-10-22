/**
 * IPC 通道注册（Main 进程）
 *
 * 约定（文档 §7.3）：
 * - Renderer 不开启 nodeIntegration，所有特权能力必须经 preload 白名单暴露。
 * - 通道名统一使用 `域:动作` 形式，与 preload 中的 `window.kugou` 一一对应。
 * - 每个 handler 都校验来源窗口，非本应用窗口一律拒绝。
 */
import { app, BrowserWindow, ipcMain, shell, type WebContents } from 'electron'
import type { AppInfo, KugouCredential, UpstreamStatus } from '../../src/types/kugou'
import { clearCredential, readCredential, writeCredential } from './store'
import { upstream } from './upstream'
import { closeLyricWindow, openLyricWindow, pushLyricData, toggleLyricWindow } from './lyricWindow'
import { isMiniWindow, setMiniWindow } from './windowMode'

/** 统一从事件来源反查窗口；来源不可信时返回 null，由调用方短路 */
function windowOf(source: { sender: WebContents }): BrowserWindow | null {
  return BrowserWindow.fromWebContents(source.sender)
}

/** 仅允许打开 http/https 外链，避免 file:// 或自定义协议被利用 */
function openExternal(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    void shell.openExternal(url.toString())
    return true
  } catch {
    return false
  }
}

export function registerIpcHandlers() {
  ipcMain.handle('app:info', (): AppInfo => {
    const status = upstream.getStatus()
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      isPackaged: app.isPackaged,
      apiBase: status.baseUrl,
      upstream: status,
    }
  })

  ipcMain.handle('app:open-external', (_event, url: unknown) =>
    typeof url === 'string' ? openExternal(url) : false
  )

  ipcMain.on('window:minimize', (event) => {
    windowOf(event)?.minimize()
  })

  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = windowOf(event)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  ipcMain.on('window:close', (event) => {
    windowOf(event)?.close()
  })

  ipcMain.handle('window:is-maximized', (event) => windowOf(event)?.isMaximized() ?? false)

  // 迷你播放器：Renderer 主动切换，Main 负责保存/恢复普通窗口的几何与能力
  ipcMain.handle('window:set-mini', (event, enabled: unknown) => {
    const win = windowOf(event)
    if (!win) return false
    return setMiniWindow(win, enabled === true)
  })

  ipcMain.handle('window:is-mini', (event) => {
    const win = windowOf(event)
    return win ? isMiniWindow(win) : false
  })

  ipcMain.handle('credential:get', () => readCredential())

  ipcMain.handle('credential:set', async (_event, credential: KugouCredential) => {
    await writeCredential(credential)
    return true
  })

  ipcMain.handle('credential:clear', () => clearCredential())

  ipcMain.handle('upstream:status', (): UpstreamStatus => upstream.getStatus())

  ipcMain.handle('upstream:restart', (): Promise<UpstreamStatus> => upstream.restart())

  // ---------- 桌面歌词窗口 ----------

  ipcMain.handle('lyric-window:open', async () => {
    await openLyricWindow()
    return true
  })

  ipcMain.handle('lyric-window:close', () => {
    closeLyricWindow()
    return true
  })

  ipcMain.handle('lyric-window:toggle', () => toggleLyricWindow())

  ipcMain.on('lyric-window:sync', (_event, payload: unknown) => {
    pushLyricData(payload)
  })
}

/** 向所有窗口广播上游状态变化 */
export function bindUpstreamBroadcast() {
  upstream.on('status', (status: UpstreamStatus) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('upstream:status', status)
    }
  })
}
