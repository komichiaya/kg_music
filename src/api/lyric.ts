/**
 * 歌词接口（文档 §3.2 / §4.2.1）
 *
 * 链路：/search/lyric（hash + duration 命中候选）→ /lyric?id&accesskey&fmt&decode=true
 *
 * 两个易踩点：
 * 1. `/lyric` 只有 `decode=true` 才回 `decodeContent`，否则只有 base64 的 `content`。
 * 2. 歌词接口的成功标志是 **status=200**（不是登录接口的 status=1）；
 *    候选列表在响应**根节点** `candidates`，不在 `data` 里。
 */
import { apiGet } from './request'
import type { Track } from '@/types/kugou'

export type LyricFormat = 'krc' | 'lrc'

export interface LyricCandidate {
  id: string
  accesskey: string
  song: string | null
  singer: string | null
  /** 歌词标注的时长（毫秒），可用于置信度判断 */
  duration: number | null
  score: number | null
}

interface LyricSearchBody {
  status?: number
  candidates?: Array<{
    id?: string | number
    accesskey?: string
    song?: string
    singer?: string
    duration?: number
    score?: number
  }>
  ugccandidates?: unknown[]
}

interface LyricDownloadBody {
  status?: number
  fmt?: string
  contenttype?: number
  decodeContent?: string
  content?: string
  error_code?: number
}

/** 用 hash + duration 命中歌词候选；无候选返回 null（纯音乐 / 未收录） */
export async function searchLyric(track: Track): Promise<LyricCandidate | null> {
  const body = await apiGet<LyricSearchBody>(
    '/search/lyric',
    {
      hash: track.hash,
      // 上游对秒/毫秒都兼容，这里统一传秒
      duration: Math.max(0, Math.round(track.duration || 0)),
      keywords: track.name,
      timestamp: Date.now(),
    },
    { timeout: 12_000 }
  )

  const candidates = Array.isArray(body?.candidates) ? body.candidates : []
  const first = candidates.find((item) => item?.id && item?.accesskey)
  if (!first) return null

  return {
    id: String(first.id),
    accesskey: String(first.accesskey),
    song: typeof first.song === 'string' ? first.song : null,
    singer: typeof first.singer === 'string' ? first.singer : null,
    duration: typeof first.duration === 'number' ? first.duration : null,
    score: typeof first.score === 'number' ? first.score : null,
  }
}

/** 按指定格式取解码后的歌词文本；失败返回 null，由上层决定是否降级 */
export async function fetchLyric(
  candidate: LyricCandidate,
  fmt: LyricFormat
): Promise<string | null> {
  const body = await apiGet<LyricDownloadBody>(
    '/lyric',
    {
      id: candidate.id,
      accesskey: candidate.accesskey,
      fmt,
      decode: 'true',
      timestamp: Date.now(),
    },
    { timeout: 12_000 }
  )

  // 成功标志是 200；部分版本回 1，做兼容
  if (body?.status !== undefined && body.status !== 200 && body.status !== 1) return null

  const text = typeof body?.decodeContent === 'string' ? body.decodeContent : ''
  if (!text.trim()) return null
  return text
}
