/**
 * 歌手接口
 *
 * - `/artist/detail?id=`   歌手详情；**该接口响应没有 status 字段**，只能靠 data 判定成功
 * - `/artist/audios?id=`   热门单曲，响应 `{ total, data: [...] }`，字段与搜索不同构
 * - `/artist/albums?id=`   歌手专辑，响应 `{ total, data: [...] }`
 *
 * 约定同其他内容接口：上游 apicache 缓存 2 分钟，**所有 GET 必须带 timestamp**。
 */
import { apiGet, ApiError } from './request'
import { normalizeTracks } from './track'
import type { KugouBody } from './login'
import type { AlbumSummary, ArtistDetail, Track } from '@/types/kugou'

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

/** 头像 / 封面统一替换 {size} 占位 */
function imageUrl(value: unknown, size = 480): string | null {
  const path = str(value)
  if (!path) return null
  if (!/^https?:\/\//.test(path)) return null
  return path.replace('{size}', String(size))
}

/** 歌手详情 */
export async function fetchArtistDetail(id: string): Promise<ArtistDetail> {
  const body = await apiGet<KugouBody<Raw>>(
    '/artist/detail',
    { id, timestamp: Date.now() },
    { timeout: 15_000 }
  )

  const item = body?.data
  if (!item || typeof item !== 'object') {
    throw new ApiError('歌手信息获取失败', { code: 'ARTIST_DETAIL_FAILED', payload: body })
  }

  // 简介优先短简介；只有长简介时取首段（long_intro 是 [{content}]）
  let intro = str(item.intro) ?? ''
  if (!intro && Array.isArray(item.long_intro)) {
    const first = item.long_intro[0]
    intro = first && typeof first === 'object' ? str((first as Raw).content) ?? '' : ''
  }

  return {
    id: str(item.author_id) ?? id,
    name: str(item.author_name) ?? '未知歌手',
    avatar: imageUrl(item.sizable_avatar),
    intro,
    fans: num(item.fansnums),
    songCount: num(item.song_count),
    albumCount: num(item.album_count),
    mvCount: num(item.mv_count),
  }
}

export interface ArtistSongs {
  tracks: Track[]
  total: number
}

/** 歌手热门单曲。返回的曲目统一回填当前歌手 id，便于列表里再点歌手名跳回本页 */
export async function fetchArtistSongs(
  id: string,
  options: { page?: number; pageSize?: number; sort?: 'hot' | 'new' } = {}
): Promise<ArtistSongs> {
  const page = options.page ?? 1
  const pageSize = options.pageSize ?? 50

  const body = await apiGet<KugouBody<unknown[]>>(
    '/artist/audios',
    { id, page, pagesize: pageSize, sort: options.sort ?? 'hot', timestamp: Date.now() },
    { timeout: 15_000 }
  )

  const list = Array.isArray(body?.data) ? body.data : []
  const tracks = normalizeTracks(list).map((track) => ({ ...track, artistId: track.artistId ?? id }))

  return { tracks, total: num((body as unknown as Raw)?.total) ?? tracks.length }
}

/** 歌手专辑列表 */
export async function fetchArtistAlbums(
  id: string,
  options: { page?: number; pageSize?: number; sort?: 'hot' | 'new' } = {}
): Promise<AlbumSummary[]> {
  const page = options.page ?? 1
  const pageSize = options.pageSize ?? 30

  const body = await apiGet<KugouBody<Raw[]>>(
    '/artist/albums',
    { id, page, pagesize: pageSize, sort: options.sort ?? 'hot', timestamp: Date.now() },
    { timeout: 15_000 }
  )

  const list = Array.isArray(body?.data) ? body.data : []

  return list
    .map((item): AlbumSummary | null => {
      const albumId = str(item.album_id)
      if (!albumId) return null
      return {
        id: albumId,
        name: str(item.album_name) ?? '未命名专辑',
        cover: imageUrl(item.sizable_cover),
        author: str(item.author_name) ?? '',
        publishDate: str(item.publish_date),
      }
    })
    .filter((album): album is AlbumSummary => album !== null)
}
