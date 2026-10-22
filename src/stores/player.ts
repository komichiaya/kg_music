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
import {
  clearPosition,
  clearQueue,
  dropLegacyResume,
  loadPosition,
  loadQueue,
  savePosition,
  saveQueue,
} from '@/stores/playerSession'
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
/**
 * 会话恢复（文档 §4.4.1）。
 * 只保存「队列 + 当前曲进度」，播放过的其他曲目不留断点；
 * 进度 5s 节流落盘，暂停 / 拖动 / 关闭窗口时强制落盘。
 */
const POSITION_SAVE_MS = 5_000

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
  /**
   * 切歌进行中标记。
   * 替换 `audio.src` / 调用 `load()` 会派生一次 `pause`（规范里是排队任务，异步触发），
   * 而此刻 `currentIndex` 已指向新曲 —— 若不拦截，旧曲的 `currentTime` 会被写到新曲的
   * 断点记录上（串写）。切歌期间一律禁止落盘播放位置。
   */
  let switching = false
  /** 上一次 timeupdate 的播放位置，用于计算真实收听增量（拖动/暂停不累加） */
  let lastPos = 0

  // ---------- 会话恢复 ----------
  //
  // 语义（2026-10-20 修订）：只恢复「播放队列 + 正在听的那一首歌」。
  // - 队列 / 当前索引写 kugou.concept.queue.v1，队列变化时立即写；
  // - 进度只保留当前曲一条（kugou.concept.position.v1），播放中 5s 节流；
  // - 切走的历史曲目不留任何记录，重启后从头播放；
  // - 同一次运行内切走再切回同样从头（touched）。

  /** 本次运行内已装载过的曲目 hash；命中即从 0 开始 */
  const touched = new Set<string>()
  let lastPositionSave = 0

  function persistQueue() {
    saveQueue(queue.value, currentIndex.value, current.value?.hash ?? null)
  }

  /** 落盘当前曲进度；试听片段、切歌窗口内一律不写 */
  function persistPosition(force = false) {
    if (previewMode.value) return
    const track = current.value
    if (!track) return
    const now = Date.now()
    if (!force && now - lastPositionSave < POSITION_SAVE_MS) return
    lastPositionSave = now
    savePosition(track.hash, audio?.currentTime ?? currentTime.value, duration.value)
  }

  /**
   * 冷启动恢复：把上次退出时的队列、当前曲与该曲进度放回状态。
   * 只恢复当前曲的进度，其他曲目没有持久化位置。
   */
  function restoreSession() {
    dropLegacyResume()
    const saved = loadQueue()
    if (!saved) return
    queue.value = saved.queue
    currentIndex.value = saved.index
    const track = queue.value[saved.index]
    if (!track) return
    duration.value = track.duration || 0
    currentTime.value = loadPosition(track.hash, duration.value)
  }

  restoreSession()

  /**
   * 决定本次装填音源从第几秒开始。
   * @param track         目标曲目
   * @param keepPosition  同曲重载（切换音质 / 错误重试 / 点当前曲）时沿用当前位置
   */
  function resolveStartSeconds(track: Track, keepPosition: boolean): number {
    if (keepPosition) return audio ? audio.currentTime : currentTime.value
    // 本次运行已听过：从头发起，并丢弃可能残留的落盘位置
    if (touched.has(track.hash)) return 0
    // 恢复的当前曲：currentTime 已是上次进度；切新曲时 resetProgress 已归零
    return currentTime.value > 0 ? currentTime.value : 0
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
      if (playing.value) persistPosition()
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
      persistPosition(true)
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
      // 播完即视为没有断点；下一首会在 loadCurrent 时写入自己的起点
      clearPosition()
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
      // 只落盘当前曲的位置与队列，历史曲目没有任何记录
      persistPosition(true)
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

      const startAt = info.preview ? 0 : resolveStartSeconds(track, keepPosition)
      touched.add(track.hash)

      const el = ensureAudio()
      el.src = info.url
      pendingSeek = startAt
      currentTime.value = startAt
      lastPos = startAt
      duration.value = track.duration || info.duration || 0
      el.load()
      loadedKey = key
      updateMediaSession(track)

      // 当前曲与起点落盘（startAt=0 时会清除旧进度，避免重启回到上一首的位置）
      savePosition(track.hash, startAt, duration.value)
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

  async function playAt(index: number, options: { autoPlay?: boolean } = {}) {
    if (index < 0 || index >= queue.value.length) return

    // 同一首曲：不重置进度，也不走切歌流程（点击当前曲应视为续播 / 暂停恢复）
    // 必须比对 hash —— 播放列表被整体替换时，索引相同不代表同一首。
    // keepPosition=true：即便音源已被卸载，也按当前位置重载而不是回到 0。
    if (index === currentIndex.value && current.value?.hash === queue.value[index]?.hash) {
      await loadCurrent(options.autoPlay !== false, true)
      return
    }

    // 切歌即结束上一次播放的上报会话（同一次首播可能被中途切走）
    void useCheckinStore().endPlay('切歌')
    switching = true
    currentIndex.value = index
    // 索引变化立即落盘；旧曲不保留任何进度
    persistQueue()
    resetProgress()
    try {
      await loadCurrent(options.autoPlay !== false)
    } finally {
      switching = false
    }
  }

  /**
   * 播放指定曲目。
   * @param track 目标曲目；省略时从当前队列继续
   * @param list  传入时整体替换队列
   */
  async function play(track?: Track, list?: Track[]) {
    if (list && list.length > 0) {
      queue.value = [...list]
      persistQueue()
      const index = track ? list.findIndex((item) => item.hash === track.hash) : 0
      await playAt(index >= 0 ? index : 0)
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
    // 切歌窗口内的 seek 通常来自旧曲的收尾逻辑，不应写进新曲的记录
    if (switching || previewMode.value || !current.value) return
    // 回到开头或拖到结尾由 savePosition 自动清除
    savePosition(current.value.hash, target, duration.value)
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
    switching = true
    try {
      await loadCurrent(wasPlaying, true)
    } finally {
      switching = false
    }
  }

  /** 错误后手动重试 */
  async function retry() {
    if (!current.value) return
    loadedKey = ''
    // 同一首曲的重载：沿用当前位置
    switching = true
    try {
      await loadCurrent(true, true)
    } finally {
      switching = false
    }
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
      // 用户主动移除当前曲：不保留进度（下次点播从头开始）
      clearPosition()
      switching = true
      audio?.pause()
      if (audio) audio.src = ''
      loadedKey = ''
      queue.value = queue.value.filter((_, i) => i !== index)
      persistQueue()
      if (queue.value.length === 0) {
        currentIndex.value = -1
        playing.value = false
        resetProgress()
        switching = false
      } else {
        currentIndex.value = Math.min(index, queue.value.length - 1)
        playing.value = false
        resetProgress()
        try {
          await loadCurrent(false)
        } finally {
          switching = false
        }
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
    switching = true
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
    clearPosition()
    switching = false
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
