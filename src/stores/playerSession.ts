/**
 * 播放会话持久化（文档 §4.4.1 断点续播）
 *
 * 设计语义（2026-10-20 修订）：
 * - 只恢复「播放队列 + 正在听的那一首歌的进度」；
 * - 切走的历史曲目不留任何进度记录，重启后一律从头播放；
 * - 进度只存一条，天然避免历史上「听过的每首歌都能续播」的错误行为。
 *
 * 存储键：
 * - `kugou.concept.queue.v1`    队列 + 当前索引 + 当前 hash（队列/索引变化时写）
 * - `kugou.concept.position.v1` 仅当前曲 { hash, position }（播放中 5s 节流写）
 * - `kugou.concept.resume.v1`   旧版「按 hash 的全量进度表」，启动时清除，不再读取
 */
import type { Track } from '@/types/kugou'

const QUEUE_KEY = 'kugou.concept.queue.v1'
const POSITION_KEY = 'kugou.concept.position.v1'
const LEGACY_RESUME_KEY = 'kugou.concept.resume.v1'

/** 小于该秒数视为误点，不保留 */
const MIN_POSITION = 3
/** 距结尾不足该秒数视为已播完，不保留 */
const END_MARGIN = 3

export interface StoredQueue {
  queue: Track[]
  index: number
  hash: string | null
}

export interface StoredPosition {
  hash: string
  position: number
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // 配额受限 / 隐私模式：静默失败，不影响播放
    return false
  }
}

function removeKey(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    // 忽略
  }
}

/** 只做最基本的形状校验：存储是本机自写自读，坏数据（旧版本、手改）直接丢弃 */
function isTrack(value: unknown): value is Track {
  if (!value || typeof value !== 'object') return false
  const track = value as Record<string, unknown>
  return (
    typeof track.hash === 'string' &&
    track.hash.length > 0 &&
    typeof track.name === 'string' &&
    typeof track.singer === 'string' &&
    typeof track.duration === 'number' &&
    Number.isFinite(track.duration)
  )
}

/** 清除旧版全量进度表；已有用户的脏数据只需删除一次 */
export function dropLegacyResume() {
  removeKey(LEGACY_RESUME_KEY)
}

export function loadQueue(): StoredQueue | null {
  const raw = readJson<unknown>(QUEUE_KEY, null)
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (!Array.isArray(record.queue)) return null

  const queue = record.queue.filter(isTrack)
  if (queue.length === 0) return null

  const rawIndex =
    typeof record.index === 'number' && Number.isInteger(record.index) ? record.index : 0
  const index = Math.min(Math.max(rawIndex, 0), queue.length - 1)
  return {
    queue,
    index,
    hash: typeof record.hash === 'string' ? record.hash : queue[index]?.hash ?? null,
  }
}

export function saveQueue(queue: Track[], index: number, hash: string | null) {
  if (queue.length === 0) {
    clearQueue()
    return
  }

  const payload: StoredQueue = { queue, index, hash }
  if (writeJson(QUEUE_KEY, payload)) return

  // 配额不足时退化为「只保留正在听的这一首」，保证核心恢复能力
  const current = queue[index]
  if (current) writeJson(QUEUE_KEY, { queue: [current], index: 0, hash: current.hash })
  else clearQueue()
}

export function clearQueue() {
  removeKey(QUEUE_KEY)
}

/** 读取当前曲进度；hash 不匹配、越界或已是结尾一律返回 0 */
export function loadPosition(hash: string | null | undefined, duration: number): number {
  if (!hash) return 0
  const raw = readJson<StoredPosition | null>(POSITION_KEY, null)
  if (!raw || raw.hash !== hash) return 0

  const position = Number(raw.position)
  if (!Number.isFinite(position) || position < MIN_POSITION) return 0
  if (duration > 0 && position >= duration - END_MARGIN) return 0
  return Math.floor(position)
}

/** 写入当前曲进度；无意义位置（开头/结尾）直接清除，避免重启停在这些位置 */
export function savePosition(hash: string, seconds: number, duration: number) {
  if (!hash || !Number.isFinite(seconds) || seconds < MIN_POSITION) {
    clearPosition()
    return
  }
  if (duration > 0 && seconds >= duration - END_MARGIN) {
    clearPosition()
    return
  }
  writeJson(POSITION_KEY, { hash, position: Math.floor(seconds) })
}

export function clearPosition() {
  removeKey(POSITION_KEY)
}
