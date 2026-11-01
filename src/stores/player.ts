/**
 * 播放器（文档 §4.4.1 / §4.4.2 / §6.2）
 *
 * 状态层职责：
 * - 队列、当前曲、播放模式、音质（纯前端，不依赖服务端会话）
 * - 音频解码与进度推进（HTMLAudioElement 才能做的事）
 * - 取流降级在 loadCurrent() 内完成：高音质无权限 → 逐级降级 → free_part 试听 → 报错
 *
 * 明确不做：歌词同步（P3 已由 lyric store 承担）、CSCC 上报细节（P5 由 checkin store 承担），
 * 这里只负责在真实播放开始/结束时通知 checkin，并累计真实收听时长。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { fetchStream } from '@/api/song'
import { ApiError } from '@/api/request'
import { useAuthStore } from '@/stores/auth'
import { useCheckinStore } from '@/stores/checkin'
import { clearQueue, dropLegacySession, loadQueue, saveQueue } from '@/stores/playerSession'
import type { PlayMode, SongQuality, Track } from '@/types/kugou'

export const PLAY_MODE_LABEL: Record<PlayMode, string> = {
  order: '列表循环',
  single: '单曲循环',
  random: '随机播放',
}

export const PLAY_MODE_ORDER: PlayMode[] = ['order', 'single', 'random']

export const QUALITY_LABEL: Record<SongQuality, string> = {
  '128': '标准 128K',
  '320': '高清 320K',
  flac: '无损 FLAC',
  high: 'Hi-Res',
}

const VOLUME_KEY = 'kugou.concept.volume.v1'
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function readableError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '播放失败，请稍后重试'
}

export const usePlayerStore = defineStore('player', () => {
  const queue = ref<Track[]>([])
  const currentIndex = ref(-1)
  const playing = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const volume = ref(0.8)
  const muted = ref(false)
  const mode = ref<PlayMode>('order')
  const quality = ref<SongQuality>('320')

  const loading = ref(false)
  const buffering = ref(false)
  const error = ref<string | null>(null)
  /** 60s 试听标记，与「不可播放」严格区分（§7.2） */
  const previewMode = ref(false)
  const previewSeconds = ref(0)
  /** 实际拿到的音质，可能因权限低于 quality */
  const streamQuality = ref<SongQuality | null>(null)

  const current = computed<Track | null>(() => queue.value[currentIndex.value] ?? null)
  const hasQueue = computed(() => queue.value.length > 0)
  const hasCurrent = computed(() => current.value !== null)
  const progress = computed(() => {
    if (!duration.value) return 0
    return clamp(currentTime.value / duration.value, 0, 1)
  })
  const effectiveVolume = computed(() => (muted.value ? 0 : volume.value))
  const modeLabel = computed(() => PLAY_MODE_LABEL[mode.value])

  let audio: HTMLAudioElement | null = null
  /** 已装填的音源标识：hash@quality，避免重复取流 */
  let loadedKey = ''
  let pendingSeek = 0
  let backupTried = false
  /** 当前音源的备用地址，主 CDN 失败时重试一次 */
  let backupUrl: string | null = null
  /** 上一次 timeupdate 的播放位置，用于计算真实收听增量（拖动/暂停不累加） */
  let lastPos = 0

  // ---------- 会话恢复 ----------
  //
  // 语义（2026-10-26 修订）：只恢复「播放队列 + 当前曲目」，不恢复播放进度。
  // - 队列 / 当前索引写 kugou.concept.queue.v1，队列变化时立即写；
  // - 重开应用一律从 0 开始播（旧版 position.v1 会在启动时被清除）；
  // - 任何换曲都从 0 开始，只有同曲重载（换音质 / 重试）才沿用当前位置。

  function persistQueue() {
    saveQueue(queue.value, currentIndex.value, current.value?.hash ?? null)
  }

  /**
   * 冷启动恢复：只把上次退出时的队列与当前曲目放回状态。
   *
   * 进度不恢复 —— 重开应用一律从 0 开始（2026-10-26 按用户要求移除续播），
   * 同时清掉历史版本留下的进度键，避免旧数据继续影响行为。
   */
  function restoreSession() {
    dropLegacySession()
    const saved = loadQueue()
    if (!saved) return
    queue.value = saved.queue
    currentIndex.value = saved.index
    const track = queue.value[saved.index]
    if (!track) return
    duration.value = track.duration || 0
    currentTime.value = 0
  }

  restoreSession()

  /**
   * 决定本次装填音源从第几秒开始。
   * @param track         目标曲目
   * @param keepPosition  同曲重载（切换音质 / 错误重试 / 点当前曲）时沿用当前位置
   */
  function resolveStartSeconds(keepPosition: boolean): number {
    // 只有「同一首曲的重载」（切换音质 / 错误重试）才沿用当前位置；
    // 任何换曲都必须从 0 开始 —— 这里不再读任何持久化进度。
    if (keepPosition) return audio?.currentTime ?? currentTime.value
    return 0
  }

  // ---------- 音频元素 ----------

  function updatePositionState() {
    if (!('mediaSession' in navigator) || !Number.isFinite(duration.value) || duration.value <= 0) return
    try {
      navigator.mediaSession.setPositionState({
        duration: duration.value,
        position: clamp(currentTime.value, 0, duration.value),
        playbackRate: audio?.playbackRate ?? 1,
      })
    } catch {
      // 部分环境不支持 setPositionState，忽略
    }
  }

  function updateMediaSession(track: Track) {
    if (!('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.name,
        artist: track.singer,
        album: track.album,
        artwork: track.cover ? [{ src: track.cover, sizes: '480x480', type: 'image/jpeg' }] : [],
      })
    } catch {
      // MediaMetadata 不可用时静默降级
    }
  }

  /** 系统媒体键 / 播放器硬件按键映射到同一套控制方法 */
  function setupMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    const bind = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        session.setActionHandler(action, handler)
      } catch {
        // 部分动作在当前平台不支持，忽略
      }
    }

    bind('play', () => void play())
    bind('pause', () => audio?.pause())
    bind('previoustrack', () => void prev())
    bind('nexttrack', () => void next())
    bind('seekto', (details) => {
      if (typeof details.seekTime === 'number') seek(details.seekTime)
    })
  }

  function onAudioError() {
    if (!audio?.src) return
    // 主 CDN 失败时尝试备用地址一次（上游 backupUrl）
    if (!backupTried && backupUrl) {
      backupTried = true
      audio.src = backupUrl
      audio.load()
      if (playing.value) void startAudio()
      return
    }
    playing.value = false
    buffering.value = false
    error.value = '音频加载失败，请重试'
  }

  function ensureAudio(): HTMLAudioElement {
    if (audio) return audio

    const el = new Audio()
    el.preload = 'auto'
    el.volume = clamp(volume.value, 0, 1)

    el.addEventListener('timeupdate', () => {
      const position = el.currentTime
      // 只累计连续播放产生的增量：暂停、拖动造成的跳变（>5s）不计入上报时长
      if (playing.value) useCheckinStore().addListenTime(position - lastPos)
      lastPos = position
      currentTime.value = position
      updatePositionState()
    })

    el.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(el.duration) && el.duration > 0) duration.value = el.duration
      if (pendingSeek > 0) {
        const target = clamp(pendingSeek, 0, Math.max(0, el.duration - 1))
        el.currentTime = target
        // 同步 UI 与增量基准，避免落位瞬间被判定成一次跳变
        currentTime.value = target
        lastPos = target
        pendingSeek = 0
      }
    })

    el.addEventListener('play', () => {
      playing.value = true
      // 每日首播：checkin store 内部按账号 + 日期幂等，重复调用不会有额外请求
      void useCheckinStore().beginPlay(current.value)
    })

    el.addEventListener('pause', () => {
      playing.value = false
    })

    el.addEventListener('waiting', () => {
      buffering.value = true
    })

    el.addEventListener('playing', () => {
      buffering.value = false
      error.value = null
    })

    el.addEventListener('canplay', () => {
      buffering.value = false
    })

    el.addEventListener('ended', () => {
      // 自然播完：先结束上报（含等级同步），再按模式切歌
      void useCheckinStore().endPlay('完整播放')
      // 单曲循环由 auto=true 表达：重播当前曲而非下一首
      void next(true)
    })

    el.addEventListener('error', onAudioError)

    // 恢复上次音量
    const savedVolume = Number(localStorage.getItem(VOLUME_KEY))
    if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) {
      volume.value = savedVolume
      el.volume = savedVolume
    }

    window.addEventListener('beforeunload', () => {
      // 只落盘队列；进度不再持久化
      persistQueue()
      // 尽力而为：窗口关闭时网络请求可能被中断，失败也不影响下次启动
      void useCheckinStore().endPlay('退出')
    })
    setupMediaSessionHandlers()

    audio = el
    return el
  }

  async function startAudio() {
    const el = ensureAudio()
    if (!el.src) return
    try {
      await el.play()
      playing.value = true
    } catch (err) {
      playing.value = false
      // AbortError 是切歌瞬间的正常中断，不提示
      if ((err as DOMException)?.name !== 'AbortError') {
        error.value = '播放未能开始，请再次点击播放'
      }
    }
  }

  // ---------- 取流 ----------

  /**
   * 装填并播放当前曲。
   * @param autoPlay      装填完成后是否立即播放
   * @param keepPosition  是否沿用当前播放位置。仅在「同一首曲」的重载场景为 true
   *                      （切换音质 / 错误重试），切歌时必须为 false。
   */
  async function loadCurrent(autoPlay: boolean, keepPosition = false) {
    const track = current.value
    if (!track) return

    const key = `${track.hash}@${quality.value}`
    if (loadedKey === key && audio?.src) {
      if (autoPlay) await startAudio()
      return
    }

    const auth = useAuthStore()
    loading.value = true
    error.value = null
    buffering.value = false
    previewMode.value = false
    previewSeconds.value = 0
    backupTried = false
    backupUrl = null

    try {
      const info = await fetchStream(track, quality.value, {
        allowHighQuality: auth.isLoggedIn,
      })

      streamQuality.value = info.quality
      previewMode.value = info.preview
      previewSeconds.value = info.previewSeconds
      backupUrl = info.backupUrl

      const startAt = info.preview ? 0 : resolveStartSeconds(keepPosition)

      const el = ensureAudio()
      el.src = info.url
      pendingSeek = startAt
      currentTime.value = startAt
      lastPos = startAt
      duration.value = track.duration || info.duration || 0
      el.load()
      loadedKey = key
      updateMediaSession(track)

      persistQueue()

      // 元数据未就绪时 el.currentTime 赋值会被丢弃，pendingSeek 由 loadedmetadata 兜底；
      // 已就绪（同曲重载）时这里直接落位，保证 UI 与音频位置一致。
      if (startAt > 0 && Number.isFinite(el.duration) && el.duration > 0) {
        el.currentTime = clamp(startAt, 0, Math.max(0, el.duration - 1))
        pendingSeek = 0
      }

      if (autoPlay) await startAudio()
    } catch (err) {
      loadedKey = ''
      playing.value = false
      error.value = readableError(err)
    } finally {
      loading.value = false
    }
  }

  // ---------- 队列与播放控制 ----------

  function resetProgress() {
    currentTime.value = 0
    duration.value = current.value?.duration ?? 0
    previewMode.value = false
    previewSeconds.value = 0
  }

  async function playAt(
    index: number,
    options: { autoPlay?: boolean; keepPosition?: boolean } = {}
  ) {
    if (index < 0 || index >= queue.value.length) return

    // 同一首曲：不重置进度，也不走切歌流程（点击当前曲应视为续播 / 暂停恢复）。
    // 注意：队列被整体替换后 current 已指向新队列，「索引 + hash 相同」会恒成立，
    // 所以 play(track, list) 会显式传 keepPosition 覆盖这个判断。
    const sameTrack =
      options.keepPosition ??
      (index === currentIndex.value && current.value?.hash === queue.value[index]?.hash)

    if (sameTrack) {
      await loadCurrent(options.autoPlay !== false, true)
      return
    }

    // 切歌即结束上一次播放的上报会话（同一次首播可能被中途切走）
    void useCheckinStore().endPlay('切歌')
    currentIndex.value = index
    // 索引变化立即落盘
    persistQueue()
    resetProgress()
    await loadCurrent(options.autoPlay !== false)
  }

  /**
   * 播放指定曲目。
   * @param track 目标曲目；省略时从当前队列继续
   * @param list  传入时整体替换队列
   */
  async function play(track?: Track, list?: Track[]) {
    if (list && list.length > 0) {
      // 替换队列前先记下正在播的那首：替换后 current 已经指向新队列，
      // 再用「索引 + hash」判断是否同一首会恒成立，导致新歌从旧歌的进度开始播。
      const previousHash = current.value?.hash ?? null
      queue.value = [...list]
      persistQueue()
      const index = track ? list.findIndex((item) => item.hash === track.hash) : 0
      const target = index >= 0 ? index : 0
      await playAt(target, {
        keepPosition: Boolean(previousHash) && list[target]?.hash === previousHash,
      })
      return
    }

    if (track) {
      const existing = queue.value.findIndex((item) => item.hash === track.hash)
      if (existing >= 0) {
        await playAt(existing)
      } else {
        queue.value = [...queue.value, track]
        await playAt(queue.value.length - 1)
      }
      return
    }

    if (currentIndex.value < 0) await playAt(0)
    // 冷启动恢复的队列尚未取流：首次播放要先装填音源，而不是直接 play()
    else if (!audio?.src) await loadCurrent(true)
    else await startAudio()
  }

  async function toggle() {
    if (!hasCurrent.value) return
    if (playing.value) audio?.pause()
    else if (!audio?.src) await loadCurrent(true)
    else await startAudio()
  }

  /**
   * @param auto true 表示由曲目自然结束触发：此时单曲循环应重播当前曲
   */
  async function next(auto = false) {
    if (!hasQueue.value) return

    if (mode.value === 'single' && auto) {
      if (audio) audio.currentTime = 0
      currentTime.value = 0
      // 位置回到 0，增量基准必须同步，否则下一帧会算出巨大的负增量
      lastPos = 0
      await startAudio()
      return
    }

    if (mode.value === 'random' && queue.value.length > 1) {
      let target = currentIndex.value
      while (target === currentIndex.value) {
        target = Math.floor(Math.random() * queue.value.length)
      }
      await playAt(target)
      return
    }

    await playAt((currentIndex.value + 1) % queue.value.length)
  }

  async function prev() {
    if (!hasQueue.value) return
    // 播放超过 3 秒时，「上一首」优先回到本曲开头（与主流播放器一致）
    if (currentTime.value > 3) {
      seek(0)
      return
    }
    await playAt((currentIndex.value - 1 + queue.value.length) % queue.value.length)
  }

  /**
   * 精确播放位置（秒）。
   *
   * `currentTime` 只在 timeupdate 时更新（约 4Hz），进度条够用；
   * 但歌词逐字扫光需要更细的粒度，直接读 audio.currentTime 才能跑到帧率。
   */
  function getPlaybackTime(): number {
    return audio?.currentTime ?? currentTime.value
  }

  function seek(seconds: number) {
    if (!Number.isFinite(seconds)) return
    const upper = duration.value || seconds
    const target = clamp(seconds, 0, upper)
    if (audio) audio.currentTime = target
    currentTime.value = target
    // 跳转后增量基准必须同步到新位置，否则下一次 timeupdate 的差值会被当成一次跳变
    lastPos = target
  }

  function setVolume(value: number) {
    const next = clamp(value, 0, 1)
    volume.value = next
    if (audio) {
      audio.volume = next
      audio.muted = false
    }
    muted.value = false
    try {
      localStorage.setItem(VOLUME_KEY, String(next))
    } catch {
      // 忽略
    }
  }

  function toggleMute() {
    const el = ensureAudio()
    el.muted = !el.muted
    muted.value = el.muted
  }

  function setMode(nextMode: PlayMode) {
    mode.value = nextMode
  }

  function cycleMode() {
    const index = PLAY_MODE_ORDER.indexOf(mode.value)
    mode.value = PLAY_MODE_ORDER[(index + 1) % PLAY_MODE_ORDER.length]
  }

  /** 切换音质：立即用新音质重载当前曲，保持播放状态与播放位置 */
  async function setQuality(nextQuality: SongQuality) {
    if (quality.value === nextQuality) return
    quality.value = nextQuality
    if (!current.value) return
    // 冷启动恢复的队列还没取流：只更新偏好，等首次播放时按新音质装填
    if (!audio?.src) return
    const wasPlaying = playing.value
    loadedKey = ''
    // 同一首曲的重载：沿用当前位置，不能退回 0
    await loadCurrent(wasPlaying, true)
  }

  /** 错误后手动重试 */
  async function retry() {
    if (!current.value) return
    loadedKey = ''
    // 同一首曲的重载：沿用当前位置
    await loadCurrent(true, true)
  }

  function append(tracks: Track[]) {
    if (tracks.length === 0) return
    const known = new Set(queue.value.map((item) => item.hash))
    queue.value = [...queue.value, ...tracks.filter((item) => !known.has(item.hash))]
    persistQueue()
  }

  async function removeAt(index: number) {
    if (index < 0 || index >= queue.value.length) return

    if (index === currentIndex.value) {
      void useCheckinStore().endPlay('停止')
      audio?.pause()
      if (audio) audio.src = ''
      loadedKey = ''
      queue.value = queue.value.filter((_, i) => i !== index)
      persistQueue()
      if (queue.value.length === 0) {
        currentIndex.value = -1
        playing.value = false
        resetProgress()
      } else {
        currentIndex.value = Math.min(index, queue.value.length - 1)
        playing.value = false
        resetProgress()
        await loadCurrent(false)
      }
      return
    }

    queue.value = queue.value.filter((_, i) => i !== index)
    if (index < currentIndex.value) currentIndex.value -= 1
    persistQueue()
  }

  /** 拖拽排序：保持当前曲目仍在播放（只调整索引） */
  function move(from: number, to: number) {
    if (from === to) return
    if (from < 0 || from >= queue.value.length) return
    if (to < 0 || to >= queue.value.length) return

    const list = [...queue.value]
    const [moved] = list.splice(from, 1)
    list.splice(to, 0, moved)
    queue.value = list

    const currentTrack = queue.value[currentIndex.value]
    if (currentTrack) {
      currentIndex.value = queue.value.findIndex((item) => item.hash === currentTrack.hash)
    }
    persistQueue()
  }

  function clear() {
    void useCheckinStore().endPlay('停止')
    audio?.pause()
    if (audio) audio.src = ''
    loadedKey = ''
    // 没有曲目就没有「实际音质」，留着会让播放栏的降级提示指向上一首
    streamQuality.value = null
    queue.value = []
    currentIndex.value = -1
    playing.value = false
    buffering.value = false
    error.value = null
    resetProgress()
    clearQueue()
  }

  return {
    queue,
    currentIndex,
    playing,
    currentTime,
    duration,
    volume,
    muted,
    mode,
    modeLabel,
    quality,
    loading,
    buffering,
    error,
    previewMode,
    previewSeconds,
    streamQuality,
    current,
    hasQueue,
    hasCurrent,
    progress,
    effectiveVolume,
    play,
    playAt,
    toggle,
    next,
    prev,
    seek,
    getPlaybackTime,
    setVolume,
    toggleMute,
    setMode,
    cycleMode,
    setQuality,
    retry,
    append,
    removeAt,
    move,
    clear,
  }
})
