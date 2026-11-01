/**
 * 播放会话持久化
 *
 * 设计语义（2026-10-26 修订）：
 * - **只恢复队列与当前曲目，不再恢复播放进度** —— 重开应用一律从 0 开始；
 * - 进度续播被移除的原因：用户明确不需要，且它带来的错位比便利更明显。
 *
 * 存储键：
 * - `kugou.concept.queue.v1`    队列 + 当前索引 + 当前 hash（队列/索引变化时写）
 * - `kugou.concept.position.v1` 旧版进度键，启动时清除，不再读写
 * - `kugou.concept.resume.v1`   更早的「按 hash 全量进度表」，启动时清除
 */
import type { Track } from '@/types/kugou'

const QUEUE_KEY = 'kugou.concept.queue.v1'
const LEGACY_POSITION_KEY = 'kugou.concept.position.v1'
const LEGACY_RESUME_KEY = 'kugou.concept.resume.v1'

export interface StoredQueue {
  queue: Track[]
  index: number
  hash: string | null
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

/** 清除旧版进度数据（单曲进度表 + 全量进度表）；只需删除一次 */
export function dropLegacySession() {
  removeKey(LEGACY_RESUME_KEY)
  removeKey(LEGACY_POSITION_KEY)
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
