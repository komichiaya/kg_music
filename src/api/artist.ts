/**
 * 歌手接口
 *
 * - `/artist/detail?id=`   歌手详情；**该接口响应没有 status 字段**，只能靠 data 判定成功
 * - `/artist/audios?id=`   热门单曲，响应 `{ total, data: [...] }`，字段与搜索不同构
 * - `/artist/albums?id=`   歌手专辑，响应 `{ total, data: [...] }`
 * - `/artist/follow|unfollow`（POST，需登录）关注 / 取消关注歌手
 * - `/user/follow`（POST，需登录）已关注的歌手列表，`data.lists[]`
 *
 * 约定同其他内容接口：上游 apicache 缓存 2 分钟，**所有 GET 必须带 timestamp**。
 * 关注列表虽然是 POST，但缓存键只按 `hostname + originalUrl` 算，POST 同样会被缓存，
 * 所以关注 / 取关之后立刻重拉也必须带 timestamp，否则读到的还是关注前的旧列表。
 */
import { apiGet, apiPost, ApiError } from './request'
import { normalizeTracks } from './track'
import type { KugouBody } from './login'
import type { AlbumSummary, ArtistDetail, FollowedArtist, Track } from '@/types/kugou'

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

/* ============================================================
 * 关注歌手
 *
 * 上游 `/artist/follow` 与 `/artist/unfollow` 都要求登录（无 token 返回 20010）。
 * 返回体很薄：`{ data: { msg: '关注成功' } }` 或 `{ data: { rank, followtime } }`，
 * 没有「是否已关注」字段，也没有关注态查询接口——所以「已关注」只能靠
 * `/user/follow` 的列表在客户端比对 singerid。
 *
 * `/user/follow` 的 `data.lists[]` 里同时混了歌手与用户：
 * 歌手的 `singerid` 有值且 `userid` 恒为 0（`iden_type` 1/4 都出现过），
 * 这里只保留带 singerid 的条目，用 iden_type 交给视图层区分。
 * ============================================================ */

function rawList(body: KugouBody<Raw> | null | undefined): Raw[] {
  const data = body?.data
  if (!data || typeof data !== 'object') return []
  const lists = (data as Raw).lists
  return Array.isArray(lists) ? (lists as Raw[]) : []
}

/** 关注歌手；重复关注上游不报错，只是把 rank/followtime 更新一遍 */
export async function followArtist(id: string): Promise<void> {
  const body = await apiPost<KugouBody<Raw>>(
    '/artist/follow',
    { id, timestamp: Date.now() },
    { params: { timestamp: Date.now() }, timeout: 15_000 }
  )

  if (body?.status !== 1) {
    throw new ApiError(body?.error || body?.msg || '关注失败，请稍后重试', {
      code: body?.error_code ?? 'FOLLOW_FAILED',
      payload: body,
    })
  }
}

/** 取消关注歌手；未关注时上游同样回 status:1「操作成功」，属于幂等成功 */
export async function unfollowArtist(id: string): Promise<void> {
  const body = await apiPost<KugouBody<Raw>>(
    '/artist/unfollow',
    { id, timestamp: Date.now() },
    { params: { timestamp: Date.now() }, timeout: 15_000 }
  )

  if (body?.status !== 1) {
    throw new ApiError(body?.error || body?.msg || '取消关注失败，请稍后重试', {
      code: body?.error_code ?? 'UNFOLLOW_FAILED',
      payload: body,
    })
  }
}

/** 已关注的歌手列表（需登录） */
export async function fetchFollowedArtists(): Promise<FollowedArtist[]> {
  const body = await apiPost<KugouBody<Raw>>(
    '/user/follow',
    { timestamp: Date.now() },
    { params: { timestamp: Date.now() }, timeout: 15_000 }
  )

  if (body?.status !== 1) {
    throw new ApiError(body?.error || body?.msg || '关注列表获取失败', {
      code: body?.error_code ?? 'FOLLOW_LIST_FAILED',
      payload: body,
    })
  }

  return rawList(body)
    .map((item): FollowedArtist | null => {
      const id = str(item.singerid)
      if (!id || id === '0') return null
      return {
        id,
        name: str(item.nickname) ?? '未知歌手',
        avatar: imageUrl(item.pic, 240),
        addTime: num(item.addtime),
      }
    })
    .filter((artist): artist is FollowedArtist => artist !== null)
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
