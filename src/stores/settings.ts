/**
 * 偏好设置
 *
 * 持久化策略（文档 §6.5）：
 * - 用户偏好（音质 / 播放模式 / 主题 / 桌面歌词 / 侧栏折叠）写 localStorage；
 * - 系统级行为（开机自启、关闭到托盘）以 **Main 为准**：它们要真的写系统登录项、
 *   真的在 `BrowserWindow#close` 里拦截，只存 localStorage 是无效的。
 *   localStorage 里仍保留一份副本，用于 Main 尚未应答（或运行在浏览器里调试）时
 *   先渲染出用户上次的选择，避免开关闪一下再跳回去。
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { getBridge } from '@/bridge'
import type { PlayMode, SongQuality, SystemPreferences, ThemeMode, ThemeStyle } from '@/types/kugou'

const STORAGE_KEY = 'kugou.concept.settings.v1'

interface Preferences {
  quality: SongQuality
  playbackMode: PlayMode
  theme: ThemeMode
  themeStyle: ThemeStyle
  /** 播放栏液态玻璃：仅在极光风格下生效，切到极简自动回退但保留偏好 */
  playerbarLiquid: boolean
  lyricDesktop: boolean
  /** 外文歌词是否显示译文（KRC 自带，无翻译时自动隐藏） */
  lyricTranslation: boolean
  /** 日文歌词是否显示罗马音（KRC 的 type:0 块，无音译时自动隐藏） */
  lyricRomaji: boolean
  closeToTray: boolean
  autoStart: boolean
  sidebarCollapsed: boolean
}

const DEFAULTS: Preferences = {
  quality: '320',
  playbackMode: 'order',
  theme: 'dark',
  themeStyle: 'aurora',
  playerbarLiquid: false,
  lyricDesktop: false,
  lyricTranslation: true,
  lyricRomaji: true,
  closeToTray: true,
  autoStart: false,
  sidebarCollapsed: false,
}

const QUALITY_VALUES: SongQuality[] = ['128', '320', 'flac', 'high']
const PLAY_MODE_VALUES: PlayMode[] = ['order', 'single', 'random']
const THEME_VALUES: ThemeMode[] = ['dark', 'light', 'system']
const THEME_STYLE_VALUES: ThemeStyle[] = ['aurora', 'minimal']

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

/** 读取时逐字段校验：历史版本或手工篡改的脏数据不应污染运行时状态 */
function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<Preferences>
    return {
      quality: isOneOf(parsed.quality, QUALITY_VALUES) ? parsed.quality : DEFAULTS.quality,
      playbackMode: isOneOf(parsed.playbackMode, PLAY_MODE_VALUES)
        ? parsed.playbackMode
        : DEFAULTS.playbackMode,
      theme: isOneOf(parsed.theme, THEME_VALUES) ? parsed.theme : DEFAULTS.theme,
      themeStyle: isOneOf(parsed.themeStyle, THEME_STYLE_VALUES)
        ? parsed.themeStyle
        : DEFAULTS.themeStyle,
      playerbarLiquid:
        typeof parsed.playerbarLiquid === 'boolean'
          ? parsed.playerbarLiquid
          : DEFAULTS.playerbarLiquid,
      lyricDesktop: typeof parsed.lyricDesktop === 'boolean' ? parsed.lyricDesktop : DEFAULTS.lyricDesktop,
      lyricTranslation:
        typeof parsed.lyricTranslation === 'boolean'
          ? parsed.lyricTranslation
          : DEFAULTS.lyricTranslation,
      lyricRomaji:
        typeof parsed.lyricRomaji === 'boolean' ? parsed.lyricRomaji : DEFAULTS.lyricRomaji,
      closeToTray: typeof parsed.closeToTray === 'boolean' ? parsed.closeToTray : DEFAULTS.closeToTray,
      autoStart: typeof parsed.autoStart === 'boolean' ? parsed.autoStart : DEFAULTS.autoStart,
      sidebarCollapsed:
        typeof parsed.sidebarCollapsed === 'boolean' ? parsed.sidebarCollapsed : DEFAULTS.sidebarCollapsed,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

const initial = loadPreferences()

export const useSettingsStore = defineStore('settings', () => {
  const quality = ref<SongQuality>(initial.quality)
  const playbackMode = ref<PlayMode>(initial.playbackMode)
  const theme = ref<ThemeMode>(initial.theme)
  const themeStyle = ref<ThemeStyle>(initial.themeStyle)
  const playerbarLiquid = ref(initial.playerbarLiquid)
  const lyricDesktop = ref(initial.lyricDesktop)
  const lyricTranslation = ref(initial.lyricTranslation)
  const lyricRomaji = ref(initial.lyricRomaji)
  const closeToTray = ref(initial.closeToTray)
  const autoStart = ref(initial.autoStart)
  const sidebarCollapsed = ref(initial.sidebarCollapsed)
  /**
   * 迷你模式是「窗口状态」而非偏好：不落 localStorage。
   * 重启后一律回到普通窗口，避免上次以小窗退出导致下次打开只有 380×120。
   */
  const miniMode = ref(false)

  const systemPrefersDark = ref(
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  const resolvedTheme = computed<'dark' | 'light'>(() =>
    theme.value === 'system' ? (systemPrefersDark.value ? 'dark' : 'light') : theme.value
  )

  function applyTheme() {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    root.dataset.theme = resolvedTheme.value
    // 风格与明暗正交：aurora = 极光渐变，minimal = 纯白 / 纯黑
    root.dataset.style = themeStyle.value
    // 液态玻璃只属于极光风格：极简下不写该属性，样式自然回退，偏好本身保留
    if (themeStyle.value === 'aurora' && playerbarLiquid.value) {
      root.dataset.liquid = 'on'
    } else {
      delete root.dataset.liquid
    }
    // Element Plus 通过 html.dark 切换暗色变量
    root.classList.toggle('dark', resolvedTheme.value === 'dark')
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  /** 切换迷你播放器；窗口几何由 Main 保存与恢复，这里只维护渲染层状态 */
  async function setMini(enabled: boolean): Promise<boolean> {
    const bridge = getBridge()
    if (!bridge) {
      miniMode.value = false
      return false
    }
    try {
      miniMode.value = await bridge.window.setMini(enabled)
    } catch (error) {
      console.warn('[settings] 切换迷你模式失败', error)
      miniMode.value = false
    }
    return miniMode.value
  }

  async function toggleMini(): Promise<boolean> {
    return setMini(!miniMode.value)
  }

  // ---------- 系统级行为（P7：以 Main 为准） ----------

  /**
   * 从 Main 拉取系统偏好并覆盖本地值
   *
   * 首次运行 Main 侧尚无落盘文件时会返回默认值，与这里的 DEFAULTS 一致；
   * 若两边不一致（例如用户直接改了 system-prefs.json），以 Main 为准。
   */
  async function syncSystemPreferences() {
    const bridge = getBridge()
    if (!bridge?.system) return
    try {
      const remote: SystemPreferences | null = await bridge.system.preferences()
      if (!remote) return
      closeToTray.value = remote.closeToTray
      autoStart.value = remote.autoStart
    } catch (error) {
      console.warn('[settings] 读取系统偏好失败', error)
    }
  }

  /**
   * 写系统偏好
   *
   * 不做乐观更新：开机自启要真的写系统登录项，可能失败（策略限制、无权限）。
   * 等 Main 回传真实结果再落值，失败时把开关恢复原状并抛出，由调用方提示。
   */
  async function setSystemPreference(patch: Partial<SystemPreferences>) {
    const bridge = getBridge()
    if (!bridge?.system) throw new Error('当前环境不支持系统级设置')
    const next = await bridge.system.setPreferences(patch)
    closeToTray.value = next.closeToTray
    autoStart.value = next.autoStart
    return next
  }

  async function setCloseToTray(enabled: boolean) {
    return setSystemPreference({ closeToTray: enabled })
  }

  async function setAutoStart(enabled: boolean) {
    return setSystemPreference({ autoStart: enabled })
  }

  /** 托盘菜单也能改开机自启，因此偏好变化必须以 Main 的广播为准 */
  function bindSystemBridge() {
    const bridge = getBridge()
    if (!bridge?.system) return () => {}
    void syncSystemPreferences()
    return bridge.system.onPreferences((remote) => {
      closeToTray.value = remote.closeToTray
      autoStart.value = remote.autoStart
    })
  }

  // 跟随系统时监听 prefers-color-scheme 变化（只注册一次）
  if (typeof window !== 'undefined') {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', (event) => {
      systemPrefersDark.value = event.matches
      if (theme.value === 'system') applyTheme()
    })
  }

  watch([resolvedTheme, themeStyle, playerbarLiquid], applyTheme)

  watch(
    [
      quality,
      playbackMode,
      theme,
      themeStyle,
      playerbarLiquid,
      lyricDesktop,
      lyricTranslation,
      lyricRomaji,
      closeToTray,
      autoStart,
      sidebarCollapsed,
    ],
    () => {
      const snapshot: Preferences = {
        quality: quality.value,
        playbackMode: playbackMode.value,
        theme: theme.value,
        themeStyle: themeStyle.value,
        playerbarLiquid: playerbarLiquid.value,
        lyricDesktop: lyricDesktop.value,
        lyricTranslation: lyricTranslation.value,
        lyricRomaji: lyricRomaji.value,
        closeToTray: closeToTray.value,
        autoStart: autoStart.value,
        sidebarCollapsed: sidebarCollapsed.value,
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
      } catch {
        // 隐私模式或磁盘配额受限时静默失败，不影响使用
      }
    }
  )

  return {
    quality,
    playbackMode,
    theme,
    themeStyle,
    playerbarLiquid,
    lyricDesktop,
    lyricTranslation,
    lyricRomaji,
    closeToTray,
    autoStart,
    sidebarCollapsed,
    miniMode,
    resolvedTheme,
    applyTheme,
    toggleSidebar,
    setMini,
    toggleMini,
    syncSystemPreferences,
    setSystemPreference,
    setCloseToTray,
    setAutoStart,
    bindSystemBridge,
  }
})
