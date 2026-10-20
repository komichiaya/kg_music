/**
 * 取流（文档 §4.4.2 / §7.2 / §7.4）
 *
 * 上游 /song/url 的三个关键事实（均已实测）：
 * 1. 地址在 **`url` 数组**里，取 `[0]`；另有 `backupUrl` 可作失败重试。
 * 2. **不同音质要传对应 hash**：128→FileHash、320→HQFileHash、flac→SQFileHash、
 *    high→ResFileHash。传错 hash 会直接 `status=2`（不是"无版权"，是"该 hash 不提供该音质"）。
 * 3. 付费曲无权限时返回 `status=2` + `fail_process=["pkg","buy"]` 且没有 url；
 *    带 `free_part=1` 重试可拿到 60s 试听（`hash_offset.end_ms` 标明裁剪点）。
 */
import { apiGet, ApiError } from './request'
import type { KugouBody } from './login'
import type { SongQuality, Track } from '@/types/kugou'

interface SongUrlPayload {
  status?: number
  errcode?: number
  error?: string
  url?: string[]
  backupUrl?: string[]
  bitRate?: number
  fileSize?: number
  timeLength?: number
  fail_process?: string[]
  hash_offset?: { end_ms?: number; start_ms?: number }
}

export interface StreamInfo {
  url: string
  backupUrl: string | null
  /** 实际拿到的音质（可能因权限低于请求档位） */
  quality: SongQuality
  /** 调用方期望的音质 */
  requestedQuality: SongQuality
  preview: boolean
  previewSeconds: number
  bitrate: number | null
  size: number | null
  /** 上游声明时长（秒）；真实时长以音频元数据为准 */
  duration: number | null
}

/** 音质从低到高，降级时反向遍历 */
const QUALITY_ORDER: SongQuality[] = ['128', '320', 'flac', 'high']

function downgradeChain(quality: SongQuality, allowHighQuality: boolean): SongQuality[] {
  // 未登录时高音质必然无权限，直接走 128，省掉 3 次无效请求
  if (!allowHighQuality) return ['128']
  const index = QUALITY_ORDER.indexOf(quality)
  return QUALITY_ORDER.slice(0, index + 1).reverse()
}

function hashFor(track: Track, quality: SongQuality): string {
  return track.hashes?.[quality] || track.hash
}

function pickUrl(payload: SongUrlPayload): string | null {
  const list = payload.url
  if (!Array.isArray(list) || list.length === 0) return null
  const first = list[0]
  return typeof first === 'string' && first.length > 0 ? first : null
}

function pickBackup(payload: SongUrlPayload): string | null {
  const list = payload.backupUrl
  if (!Array.isArray(list)) return null
  const first = list.find((item) => typeof item === 'string' && item.length > 0)
  return first ?? null
}

function previewSecondsOf(payload: SongUrlPayload): number {
  const endMs = payload.hash_offset?.end_ms
  if (typeof endMs === 'number' && endMs > 0) {
    return Math.min(60, Math.max(10, Math.round(endMs / 1000)))
  }
  return 60
}

function describeFailure(payload: SongUrlPayload | null): string {
  if (!payload) return '音源解析失败'
  if (payload.errcode === 20028) return '设备校验未通过（20028），请在设置中重启本地服务后重试'
  const failProcess = payload.fail_process
  if (Array.isArray(failProcess) && (failProcess.includes('pkg') || failProcess.includes('buy'))) {
    return '该曲目需购买或开通会员后才能完整播放'
  }
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error
  if (payload.status === 2) return '当前账号暂无该曲目的播放权限'
  return '音源解析失败'
}

async function requestStream(
  track: Track,
  quality: SongQuality,
  freePart: boolean
): Promise<SongUrlPayload> {
  return apiGet<SongUrlPayload & KugouBody<unknown>>(
    '/song/url',
    {
      hash: hashFor(track, quality),
      album_id: track.albumId ?? 0,
      album_audio_id: track.albumAudioId ?? 0,
      quality,
      ...(freePart ? { free_part: 1 } : {}),
      timestamp: Date.now(),
    },
    { timeout: 15_000 }
  )
}

/**
 * 获取播放地址。
 *
 * @param quality 期望音质
 * @param options.allowHighQuality 登录态才允许尝试 320/flac/high，否则直接 128
 */
export async function fetchStream(
  track: Track,
  quality: SongQuality,
  options: { allowHighQuality?: boolean } = {}
): Promise<StreamInfo> {
  const chain = downgradeChain(quality, options.allowHighQuality === true)
  let lastFailure: SongUrlPayload | null = null

  for (const candidate of chain) {
    const payload = await requestStream(track, candidate, false)
    const url = pickUrl(payload)
    if (url) {
      return {
        url,
        backupUrl: pickBackup(payload),
        quality: candidate,
        requestedQuality: quality,
        preview: false,
        previewSeconds: 0,
        bitrate: typeof payload.bitRate === 'number' ? payload.bitRate : null,
        size: typeof payload.fileSize === 'number' ? payload.fileSize : null,
        duration: typeof payload.timeLength === 'number' ? payload.timeLength : null,
      }
    }
    if (payload.errcode === 20028) {
      throw new ApiError(describeFailure(payload), { code: 'DEVICE_RISK', payload })
    }
    lastFailure = payload
  }

  // 完整版不可得：按文档 §7.2 以 free_part=1 换取 60s 试听
  const previewPayload = await requestStream(track, chain[chain.length - 1], true)
  const previewUrl = pickUrl(previewPayload)
  if (previewUrl) {
    return {
      url: previewUrl,
      backupUrl: pickBackup(previewPayload),
      quality: chain[chain.length - 1],
      requestedQuality: quality,
      preview: true,
      previewSeconds: previewSecondsOf(previewPayload),
      bitrate: typeof previewPayload.bitRate === 'number' ? previewPayload.bitRate : null,
      size: typeof previewPayload.fileSize === 'number' ? previewPayload.fileSize : null,
      duration: typeof previewPayload.timeLength === 'number' ? previewPayload.timeLength : null,
    }
  }

  throw new ApiError(describeFailure(lastFailure ?? previewPayload), {
    code: 'STREAM_UNAVAILABLE',
    payload: lastFailure ?? previewPayload,
  })
}
