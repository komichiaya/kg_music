/**
 * 系统级行为偏好（Main 进程独占）
 *
 * 与渲染层 localStorage 的 `Preferences` 分工（文档 §6.5）：
 *   localStorage  偏好（音质、主题、歌词开关……）——纯渲染层，无需 Main 参与
 *   system-prefs  系统行为（开机自启、关闭到托盘）——必须由 Main 真正执行
 *
 * 为什么不能只存 localStorage：`autoStart` 要写系统登录项，`closeToTray`
 * 要在 `BrowserWindow#close` 里拦截，两者都发生在 Main。渲染层存一份只是
 * 「界面状态」，重启后与真实系统状态可能不一致，所以这里以落盘文件为准。
 */
import { app } from 'electron'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SystemPreferences } from '../../src/types/kugou'

const PREFS_FILE = 'system-prefs.json'

const DEFAULTS: SystemPreferences = {
  autoStart: false,
  closeToTray: true,
  trayHintShown: false,
}

function prefsPath() {
  return path.join(app.getPath('userData'), PREFS_FILE)
}

/** 逐字段校验：脏数据只丢该字段，不让整个文件失效 */
function normalize(input: unknown): SystemPreferences {
  const raw = (input ?? {}) as Partial<Record<keyof SystemPreferences, unknown>>
  const bool = (value: unknown, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback

  return {
    autoStart: bool(raw.autoStart, DEFAULTS.autoStart),
    closeToTray: bool(raw.closeToTray, DEFAULTS.closeToTray),
    trayHintShown: bool(raw.trayHintShown, DEFAULTS.trayHintShown),
  }
}

/**
 * 开机自启是否真的可用
 *
 * 开发态（未打包）时 Electron 的可执行文件是 node_modules 里的 electron.exe，
 * 写进登录项后只会拉起一个空壳、且卸载依赖后残留，所以开发态一律不写系统，
 * 只保留偏好值，方便联调界面。
 */
export function autoStartSupported() {
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin')
}

/**
 * 开机自启的启动参数
 *
 * 带上它，主进程启动后不主动显示窗口（静默进托盘），否则用户一开机就被
 * 一个音乐播放器窗口挡住，与设置页「不打断当前工作」的承诺不符。
 */
export const AUTOSTART_FLAG = '--autostart'

/** 把偏好同步到系统登录项（失败只告警，不阻断启动） */
function applyAutoStart(enabled: boolean) {
  if (!autoStartSupported()) {
    if (enabled) {
      console.warn('[systemPrefs] 开发态不写入系统登录项，autoStart 仅作为偏好保存')
    }
    return
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      // args 仅 Windows 生效；macOS 由系统登录项自行拉起，不认这个参数
      ...(process.platform === 'win32' ? { args: [AUTOSTART_FLAG] } : {}),
    })
  } catch (error) {
    console.warn('[systemPrefs] 写入系统登录项失败', error)
  }
}

class SystemPrefsService extends EventEmitter {
  private current: SystemPreferences | null = null
  private loading: Promise<SystemPreferences> | null = null

  /** 读取偏好；首次运行没有文件时返回默认值（不抛错） */
  async load(): Promise<SystemPreferences> {
    if (this.current) return this.current
    if (this.loading) return this.loading

    this.loading = (async () => {
      let next = { ...DEFAULTS }

      try {
        const text = await fs.readFile(prefsPath(), 'utf8')
        next = normalize(JSON.parse(text))
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') {
          console.warn('[systemPrefs] 读取失败，使用默认值', error)
        }
      }

      this.current = next
      this.loading = null
      // 启动时把已保存的 autoStart 对齐到系统（用户可能在别处改过）
      applyAutoStart(next.autoStart)
      return next
    })()

    return this.loading
  }

  /** 同步取当前值（未 load 前返回 null，调用方需自行兜底） */
  snapshot() {
    return this.current ? { ...this.current } : null
  }

  /** 合并写入并立即生效；返回写入后的完整偏好 */
  async patch(patch: Partial<SystemPreferences>): Promise<SystemPreferences> {
    const base = await this.load()
    const next: SystemPreferences = {
      ...base,
      ...(typeof patch.autoStart === 'boolean' ? { autoStart: patch.autoStart } : {}),
      ...(typeof patch.closeToTray === 'boolean' ? { closeToTray: patch.closeToTray } : {}),
      ...(typeof patch.trayHintShown === 'boolean' ? { trayHintShown: patch.trayHintShown } : {}),
    }

    const changed =
      next.autoStart !== base.autoStart ||
      next.closeToTray !== base.closeToTray ||
      next.trayHintShown !== base.trayHintShown

    if (!changed) return { ...base }

    this.current = next
    if (next.autoStart !== base.autoStart) applyAutoStart(next.autoStart)

    try {
      await fs.mkdir(path.dirname(prefsPath()), { recursive: true })
      const tmp = `${prefsPath()}.${process.pid}.tmp`
      await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
      await fs.rename(tmp, prefsPath())
    } catch (error) {
      // 落盘失败不影响本次运行的行为（内存里已经是新值）
      console.warn('[systemPrefs] 写入失败', error)
    }

    this.emit('change', { ...next })
    return { ...next }
  }

  /** 是否关闭到托盘（close 拦截用，未初始化时用默认值） */
  closeToTray() {
    return this.current?.closeToTray ?? DEFAULTS.closeToTray
  }
}

export const systemPrefs = new SystemPrefsService()
