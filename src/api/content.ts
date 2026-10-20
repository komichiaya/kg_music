/**
 * 内容源接口（文档 §3.4 / §3.3）
 *
 * 每日推荐、排行榜、热搜。响应字段各家不同，统一交给 api/track.ts 归一化。
 */
import { apiGet, apiPost, ApiError } from './request'
import { normalizeTracks } from './track'
import type { KugouBody } from './login'
import type { RankSummary, Track } from '@/types/kugou'

type Raw = Record<string, unknown>

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function imageUrl(value: unknown, size = 240): string | null {
  const path = str(value)
  if (!path || !/^https?:\/\//.test(path)) return null
  return path.replace('{size}', String(size))
}

/** 每日推荐（需登录；未登录时上游会返回空或错误） */
export async function fetchEverydayRecommend(): Promise<Track[]> {
  const body = await apiPost<KugouBody<{ song_list?: unknown[] }>>(
    '/everyday/recommend',
    { timestamp: Date.now() },
    { params: { platform: 'ios' }, timeout: 15_000 }
  )

  if (body?.status !== 1) {
    const message = body?.error_msg || body?.error || '每日推荐获取失败'
    throw new ApiError(message, { code: body?.error_code ?? 'RECOMMEND_FAILED', payload: body })
  }

  return normalizeTracks(body.data?.song_list)
}

export interface PersonalFmBatch {
  tracks: Track[]
  /** 后端给出的推荐理由，例如「正在随机推荐歌曲」；无可用文案时为空串 */
  reason: string
}

/**
 * 私人 FM 单批推荐（/personal/fm）
 *
 * 说明：
 * - 该接口**未登录也可用**，未登录时上游退化为随机推荐，`reason` 会写明「正在随机推荐歌曲」。
 * - 单批只返回约 5 首，是「电台式」小队列；继续拉歌需带 hash / playtime 续播，
 *   当前版本按批次播放，由「换一批」重新取。
 * - 字段结构与每日推荐同族（hash / hash_320 / hash_flac / time_length 秒 / union_cover），
 *   直接交给 normalizeTracks 归一化。
 */
export async function fetchPersonalFm(): Promise<PersonalFmBatch> {
  // timestamp 必须同时放 query：上游对 200 响应做 2 分钟 apicache，body 里的 timestamp 绕不过去
  const timestamp = Date.now()
  const body = await apiPost<KugouBody<{ song_list?: unknown[] }>>(
    '/personal/fm',
    { timestamp },
    { params: { timestamp }, timeout: 15_000 }
  )

  if (body?.status !== 1) {
    const message = body?.error_msg || body?.error || '私人 FM 获取失败'
    throw new ApiError(message, { code: body?.error_code ?? 'PERSONAL_FM_FAILED', payload: body })
  }

  const list = Array.isArray(body.data?.song_list) ? body.data.song_list : []
  const reason = list
    .map((item) => {
      const info = (item as Raw | null)?.rec_song_info
      return info && typeof info === 'object' ? str((info as Raw).rec_desc) : null
    })
    .find((text): text is string => Boolean(text))

  return {
    tracks: normalizeTracks(list),
    reason: reason ?? '',
  }
}


/** 排行榜列表 */
export async function fetchRankList(): Promise<RankSummary[]> {
  const body = await apiGet<KugouBody<{ info?: Raw[] }>>(
    '/rank/list',
    { withsong: 1, timestamp: Date.now() },
    { timeout: 15_000 }
  )

  if (body?.status !== 1) {
    throw new ApiError(body?.error || '排行榜获取失败', {
      code: body?.errcode ?? 'RANK_LIST_FAILED',
      payload: body,
    })
  }

  const list = Array.isArray(body.data?.info) ? body.data.info : []

  return list
    .map((item): RankSummary | null => {
      const rankid = str(item.rankid)
      if (!rankid) return null
      return {
        rankid,
        name: str(item.rankname) ?? '未命名榜单',
        cover:
          imageUrl(item.imgurl) ??
          imageUrl(item.img_9) ??
          imageUrl(item.album_img_9) ??
          imageUrl(item.img_cover),
        intro: str(item.intro) ?? '',
        updateFrequency: str(item.update_frequency) ?? '',
        playCount: num(item.play_times),
      }
    })
    .filter((rank): rank is RankSummary => rank !== null)
}

export interface RankSongs {
  tracks: Track[]
  total: number
}

/** 榜单曲目 */
export async function fetchRankSongs(
  rankid: string,
  options: { page?: number; pageSize?: number } = {}
): Promise<RankSongs> {
  const page = options.page ?? 1
  const pageSize = options.pageSize ?? 50

  const body = await apiPost<KugouBody<{ songlist?: unknown[]; total?: number }>>(
    '/rank/audio',
    { timestamp: Date.now() },
    { params: { rankid, page, pagesize: pageSize }, timeout: 15_000 }
  )

  if (body?.status !== 1) {
    throw new ApiError(body?.errmsg || '榜单曲目获取失败', {
      code: body?.error_code ?? 'RANK_AUDIO_FAILED',
      payload: body,
    })
  }

  const tracks = normalizeTracks(body.data?.songlist)
  const topTotal = num((body as unknown as { total?: number }).total)
  return { tracks, total: topTotal ?? num(body.data?.total) ?? tracks.length }
}

/** 热搜词（取榜单第一组） */
export async function fetchHotSearch(): Promise<string[]> {
  const body = await apiGet<
    KugouBody<{ list?: Array<{ keywords?: Array<{ keyword?: string; reason?: string }> }> }>
  >('/search/hot', { timestamp: Date.now() }, { timeout: 10_000 })

  if (body?.status !== 1) return []

  const keywords = body.data?.list?.[0]?.keywords ?? []
  const words = keywords
    .map((item) => item.keyword || item.reason || '')
    .map((word) => word.trim())
    .filter(Boolean)

  return Array.from(new Set(words)).slice(0, 12)
}
