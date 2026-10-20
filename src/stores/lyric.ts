/**
 * 歌词状态（文档 §6.3）
 *
 * 加载链路在 store 内完成（KRC 优先、LRC 降级），组件只负责渲染与交互。
 * 时间统一用毫秒，避免逐字时间戳的浮点误差。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { fetchLyric, searchLyric, type LyricFormat } from '@/api/lyric'
import { findActiveIndex, parseLyricText, type LyricLine } from '@/utils/lyric'
import type { Track } from '@/types/kugou'

export type LyricStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

function readable(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '歌词加载失败'
}

export const useLyricStore = defineStore('lyric', () => {
  const lines = ref<LyricLine[]>([])
  const activeIndex = ref(-1)
  const status = ref<LyricStatus>('idle')
  const source = ref<LyricFormat | null>(null)
  const error = ref<string | null>(null)
  const title = ref<string | null>(null)
  const artist = ref<string | null>(null)

  const activeLine = computed<LyricLine | null>(() => lines.value[activeIndex.value] ?? null)
  const hasLyric = computed(() => lines.value.length > 0)

  let currentHash = ''
  let requestId = 0
  let lastTimeMs = 0

  function reset() {
    requestId += 1
    currentHash = ''
    lines.value = []
    activeIndex.value = -1
    status.value = 'idle'
    source.value = null
    error.value = null
    title.value = null
    artist.value = null
  }

  /**
   * 加载指定曲目的歌词。
   * 同一首歌重复调用会被跳过；切歌时旧的请求结果会被 requestId 丢弃。
   */
  async function load(track: Track | null) {
    if (!track) {
      reset()
      return
    }
    if (track.hash === currentHash && (status.value === 'ready' || status.value === 'loading')) return

    const token = ++requestId
    currentHash = track.hash
    lines.value = []
    activeIndex.value = -1
    status.value = 'loading'
    source.value = null
    error.value = null
    title.value = null
    artist.value = null

    try {
      const candidate = await searchLyric(track)
      if (token !== requestId) return
      if (!candidate) {
        status.value = 'empty'
        return
      }

      // 优先逐字 KRC；不可用或解析为空再降级 LRC
      let format: LyricFormat = 'krc'
      let text = await fetchLyric(candidate, 'krc')
      let parsed = text ? parseLyricText(text, 'krc') : null

      if (!parsed || parsed.lines.length === 0) {
        format = 'lrc'
        text = await fetchLyric(candidate, 'lrc')
        parsed = text ? parseLyricText(text, 'lrc') : null
      }

      if (token !== requestId) return
      if (!parsed || parsed.lines.length === 0) {
        status.value = 'empty'
        return
      }

      lines.value = parsed.lines
      source.value = format
      title.value = parsed.title
      artist.value = parsed.artist
      status.value = 'ready'
      // 直接定位到当前播放位置，避免加载完成瞬间高亮错行
      activeIndex.value = findActiveIndex(parsed.lines, lastTimeMs)
    } catch (err) {
      if (token !== requestId) return
      status.value = 'error'
      error.value = readable(err)
    }
  }

  /** 由播放进度驱动；只在行切换时写状态，避免每帧触发渲染 */
  function sync(seconds: number) {
    lastTimeMs = Math.max(0, seconds * 1000)
    if (status.value !== 'ready') return
    const next = findActiveIndex(lines.value, lastTimeMs)
    if (next !== activeIndex.value) activeIndex.value = next
  }

  return {
    lines,
    activeIndex,
    status,
    source,
    error,
    title,
    artist,
    activeLine,
    hasLyric,
    load,
    sync,
    reset,
  }
})
