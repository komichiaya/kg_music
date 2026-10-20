/**
 * 偏好设置
 *
 * 持久化策略（文档 §6.5）：
 * - 用户偏好（音质 / 播放模式 / 主题 / 桌面歌词 / 侧栏折叠）写 localStorage；
 * - 系统级行为（开机自启、托盘）需 Main 参与，P7 接入，当前仅保留开关位。
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { PlayMode, SongQuality, ThemeMode } from '@/types/kugou'

const STORAGE_KEY = 'kugou.concept.settings.v1'

interface Preferences {
  quality: SongQuality
  playbackMode: PlayMode
  theme: ThemeMode
  lyricDesktop: boolean
  closeToTray: boolean
  autoStart: boolean
  sidebarCollapsed: boolean
}

const DEFAULTS: Preferences = {
  quality: '320',
  playbackMode: 'order',
  theme: 'dark',
  lyricDesktop: false,
  closeToTray: true,
  autoStart: false,
  sidebarCollapsed: false,
}

const QUALITY_VALUES: SongQuality[] = ['128', '320', 'flac', 'high']
const PLAY_MODE_VALUES: PlayMode[] = ['order', 'single', 'random']
const THEME_VALUES: ThemeMode[] = ['dark', 'light', 'system']

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
      lyricDesktop: typeof parsed.lyricDesktop === 'boolean' ? parsed.lyricDesktop : DEFAULTS.lyricDesktop,
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
  const lyricDesktop = ref(initial.lyricDesktop)
  const closeToTray = ref(initial.closeToTray)
  const autoStart = ref(initial.autoStart)
  const sidebarCollapsed = ref(initial.sidebarCollapsed)

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
    // Element Plus 通过 html.dark 切换暗色变量
    root.classList.toggle('dark', resolvedTheme.value === 'dark')
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  // 跟随系统时监听 prefers-color-scheme 变化（只注册一次）
  if (typeof window !== 'undefined') {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', (event) => {
      systemPrefersDark.value = event.matches
      if (theme.value === 'system') applyTheme()
    })
  }

  watch(resolvedTheme, applyTheme)

  watch(
    [quality, playbackMode, theme, lyricDesktop, closeToTray, autoStart, sidebarCollapsed],
    () => {
      const snapshot: Preferences = {
        quality: quality.value,
        playbackMode: playbackMode.value,
        theme: theme.value,
        lyricDesktop: lyricDesktop.value,
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
    lyricDesktop,
    closeToTray,
    autoStart,
    sidebarCollapsed,
    resolvedTheme,
    applyTheme,
    toggleSidebar,
  }
})
