/**
 * 专辑接口
 *
 * - `/album/detail?id=`  专辑详情（含 authors），响应 `data` 是数组，取 `[0]`
 * - `/album/songs?id=`   专辑曲目，响应在 `data.songs[]`，字段与搜索不同构，统一走 normalizeTracks
 *
 * 约定同其他内容接口：上游 apicache 缓存 2 分钟，**所有 GET 必须带 timestamp**。
 */
import { apiGet, ApiError } from './request'
import { normalizeTracks } from './track'
import type { KugouBody } from './login'
import type { AlbumDetail, Track } from '@/types/kugou'

type Raw = Record<string, unknown>

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/** 封面统一替换 {size} 占位 */
function imageUrl(value: unknown, size = 480): string | null {
  const path = str(value)
  if (!path) return null
  const full = /^https?:\/\//.test(path) ? path : `http://imge.kugou.com/stdmusic/{size}/${path}`
  return full.replace('{size}', String(size))
}

function firstAuthor(list: unknown): { name: string | null; id: string | null } | null {
  if (!Array.isArray(list)) return null
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Raw
    const name = str(item.author_name) ?? str(item.name)
    const id = str(item.author_id) ?? str(item.id)
    if (name || id) return { name, id }
  }
  return null
}

/** 专辑详情。id 缺失或上游异常时抛 ApiError，由页面兜底展示 */
export async function fetchAlbumDetail(id: string): Promise<AlbumDetail> {
  const body = await apiGet<KugouBody<Raw[]>>(
    '/album/detail',
    { id, timestamp: Date.now() },
    { timeout: 15_000 }
  )

  const payload = body?.data
  const item = Array.isArray(payload) ? payload[0] : payload

  if (!item) {
    const code = body?.error_code ?? body?.errcode
    throw new ApiError('专辑信息获取失败', {
      code: code ?? 'ALBUM_DETAIL_FAILED',
      payload: body,
    })
  }

  const author = firstAuthor(item.authors)

  return {
    id: str(item.album_id) ?? id,
    name: str(item.album_name) ?? '未知专辑',
    cover: imageUrl(item.sizable_cover),
    intro: str(item.intro) ?? '',
    author: str(item.author_name) ?? author?.name ?? '未知歌手',
    authorId: str(item.author_id) ?? author?.id ?? null,
    publishDate: str(item.publish_date),
    language: str(item.language),
    type: str(item.type),
  }
}

export interface AlbumSongs {
  tracks: Track[]
  total: number
}

/** 专辑曲目 */
export async function fetchAlbumSongs(
  id: string,
  options: { page?: number; pageSize?: number } = {}
): Promise<AlbumSongs> {
  const page = options.page ?? 1
  // 实测 /album/songs 的 pagesize 上限是 50，传 60+ 会 20010 invalid param
  const pageSize = Math.min(options.pageSize ?? 50, 50)

  const body = await apiGet<KugouBody<{ songs?: unknown[]; total?: number }>>(
    '/album/songs',
    { id, page, pagesize: pageSize, timestamp: Date.now() },
    { timeout: 15_000 }
  )

  const songs = Array.isArray(body?.data?.songs) ? body?.data?.songs : []
  // 专辑曲目的 album_id 藏在 base 里，归一化取不到；这里统一回填当前专辑 id，
  // 保证「点专辑列」这种入口在任何来源下都可用。
  const tracks = normalizeTracks(songs).map((track) => ({ ...track, albumId: track.albumId ?? id }))

  if (tracks.length === 0 && songs.length > 0) {
    // 归一化全灭说明字段又变了，直接抛出去，避免页面显示成「空专辑」
    throw new ApiError('专辑曲目解析失败', { code: 'ALBUM_SONGS_PARSE', payload: body })
  }

  return { tracks, total: str(body?.data?.total) ? Number(body?.data?.total) : tracks.length }
}
