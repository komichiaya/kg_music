/**
 * Preload：唯一的 Renderer ↔ Main 桥接层
 *
 * 只暴露 `window.kugou` 这一个命名空间，不暴露 ipcRenderer 本体，
 * 也不暴露任何 Node 模块能力（文档 §7.3）。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  DesktopLyricPayload,
  KugouBridge,
  KugouCredential,
  UpstreamStatus,
} from '../src/types/kugou'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

/** 注册监听并返回取消订阅函数，避免组件卸载后回调泄漏 */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const bridge: KugouBridge = {
  app: {
    info: () => invoke<AppInfo>('app:info'),
    openExternal: (url: string) => invoke<boolean>('app:open-external', url),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => invoke<boolean>('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => invoke<boolean>('window:is-maximized'),
    setMini: (enabled: boolean) => invoke<boolean>('window:set-mini', enabled),
    isMini: () => invoke<boolean>('window:is-mini'),
    onMaximizeChange: (cb) => subscribe<boolean>('window:maximized-changed', cb),
  },
  credential: {
    get: () => invoke<KugouCredential | null>('credential:get'),
    set: (credential: KugouCredential) => invoke<boolean>('credential:set', credential),
    clear: () => invoke<void>('credential:clear'),
  },
  upstream: {
    status: () => invoke<UpstreamStatus>('upstream:status'),
    restart: () => invoke<UpstreamStatus>('upstream:restart'),
    onStatus: (cb) => subscribe<UpstreamStatus>('upstream:status', cb),
  },
  lyric: {
    open: () => invoke<boolean>('lyric-window:open'),
    close: () => invoke<boolean>('lyric-window:close'),
    toggle: () => invoke<boolean>('lyric-window:toggle'),
    sync: (payload: DesktopLyricPayload) => ipcRenderer.send('lyric-window:sync', payload),
    onData: (cb) => subscribe<DesktopLyricPayload>('lyric-window:data', cb),
    onState: (cb) => subscribe<boolean>('lyric-window:state', cb),
  },
}

contextBridge.exposeInMainWorld('kugou', bridge)
