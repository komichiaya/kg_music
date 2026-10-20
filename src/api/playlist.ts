/**
 * 歌单相关接口（文档 §3.4 / §7.6）
 *
 * 关键约束：
 * - `/playlist/track/all` 的 `id` 必须是 `global_collection_id`（gid），传 specialid 会 20010。
 * - 歌单曲目字段与歌曲搜索不同构，统一由 api/track.ts 归一化。
 */
import { apiGet, apiPost, ApiError } from './request'
import { normalizeTracks } from './track'
import type { KugouBody } from './login'
import type { PlaylistSummary, Track } from '@/types/kugou'

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

function coverOf(value: unknown, size = 480): string | null {
  const path = str(value)
  if (!path || !/^https?:\/\//.test(path)) return null
  return path.replace('{size}', String(size))
}

function toPlaylist(item: Raw, currentUserId: string | null): PlaylistSummary {
  const creatorId = str(item.list_create_userid) ?? str(item.userid)
  return {
    id: str(item.global_collection_id) ?? str(item.list_create_gid) ?? '',
    listid: str(item.listid) ?? str(item.list_create_listid) ?? undefined,
    name: str(item.name) ?? '未命名歌单',
    cover: coverOf(item.pic),
    count: num(item.count) ?? 0,
    creator: str(item.list_create_username) ?? '—',
    intro: str(item.intro) ?? '',
    mine: Boolean(currentUserId && creatorId === currentUserId),
  }
}

/** 歌单详情（批量接口，这里取第一条） */
export async function fetchPlaylistDetail(
  gid: string,
  currentUserId: string | null = null
): Promise<PlaylistSummary | null> {
  const body = await apiPost<KugouBody<Raw[] | Raw>>(
    '/playlist/detail',
    { timestamp: Date.now() },
    { params: { ids: gid }, timeout: 15_000 }
  )

  if (body?.status !== 1) {
    throw new ApiError(body?.error_msg || '歌单详情获取失败', {
      code: body?.error_code ?? 'PLAYLIST_DETAIL_FAILED',
      payload: body,
    })
  }

  const payload = body.data
  const first = Array.isArray(payload) ? payload[0] : payload
  if (!first || typeof first !== 'object') return null

  const playlist = toPlaylist(first as Raw, currentUserId)
  return playlist.id ? playlist : null
}

export interface PlaylistTracks {
  tracks: Track[]
  total: number
}

/** 歌单曲目（gid 分页） */
export async function fetchPlaylistTracks(
  gid: string,
  options: { page?: number; pageSize?: number } = {}
): Promise<PlaylistTracks> {
  const page = options.page ?? 1
  const pageSize = options.pageSize ?? 100

  const body = await apiGet<KugouBody<{ songs?: unknown[]; count?: number }>>(
    '/playlist/track/all',
    { id: gid, page, pagesize: pageSize, timestamp: Date.now() },
    { timeout: 20_000 }
  )

  if (body?.status !== 1) {
    throw new ApiError(body?.error_msg || '歌单曲目获取失败', {
      code: body?.error_code ?? 'PLAYLIST_TRACK_FAILED',
      payload: body,
    })
  }

  const tracks = normalizeTracks(body.data?.songs)
  return { tracks, total: num(body.data?.count) ?? tracks.length }
}

/** 我的歌单列表 */
export async function fetchUserPlaylists(userid: string): Promise<PlaylistSummary[]> {
  const body = await apiPost<KugouBody<{ info?: Raw[] }>>(
    '/user/playlist',
    { timestamp: Date.now() },
    { params: { pagesize: 50 }, timeout: 15_000 }
  )

  if (body?.status !== 1) {
    throw new ApiError(body?.error_msg || '我的歌单获取失败', {
      code: body?.error_code ?? 'USER_PLAYLIST_FAILED',
      payload: body,
    })
  }

  const list = Array.isArray(body.data?.info) ? body.data.info : []
  return list.map((item) => toPlaylist(item, userid)).filter((item) => item.id)
}

/* ============================================================
 * 往歌单添加曲目
 *
 * 实测结论（2026-10-20，真实账号）：
 * - 写入接口是 `/playlist/tracks/add`，参数 `listid` + `data`，
 *   而 **listid 与 gid 是两套 id**：读曲目用 gid（global_collection_id），
 *   写曲目必须用 listid。PlaylistSummary 因此同时保留 id 与 listid。
 * - `data` 格式为 `歌名|hash|album_id|mixsongid`；歌名只作展示（上游会改写为「歌手 - 歌名」），
 *   但歌名里的 `,` 与 `|` 会打乱上游的二次分段，必须先替换掉。
 * - 只能写自己创建的歌单：对「收藏来的歌单」（type=1、create_userid 非本人）上游返回
 *   HTTP 502 + `error_code=30205`，调用方应在选择器里直接过滤掉。
 * - 重复添加同一首不会报错（status=1），但**不会产生第二条**；此时歌单内该曲的 `fileid`
 *   会变化，所以任何基于旧 fileid 的删除都会静默失效 —— 删除前必须重新读列表。
 * ============================================================ */

/**
 * 歌名里的 `,` 与 `|` 会打乱上游 `data` 的解析（先按 , 分段，再按 | 分段），
 * 一律替换成空格；歌名只影响展示，不影响收藏结果。
 */
function safeName(name: string): string {
  return name.replace(/[,|]/g, ' ').trim()
}

/** 把曲目加入指定歌单（listid 来自 PlaylistSummary.listid） */
export async function addTrackToPlaylist(listid: string, track: Track): Promise<void> {
  const payload = [safeName(track.name), track.hash, track.albumId ?? 0, track.albumAudioId ?? 0].join(
    '|'
  )

  const body = await apiPost<KugouBody<Raw>>(
    '/playlist/tracks/add',
    { timestamp: Date.now() },
    { params: { listid, data: payload }, timeout: 15_000 }
  )

  if (body?.status !== 1) {
    // 30205 = 收藏来的歌单不可写，单独给出可读文案
    const code = body?.error_code
    const message =
      code === 30205
        ? '该歌单是收藏来的，不能添加歌曲'
        : body?.error_msg || body?.error || '添加到歌单失败'
    throw new ApiError(message, { code: code ?? 'PLAYLIST_ADD_FAILED', payload: body })
  }
}

/** 听歌历史（排行） */
export async function fetchUserHistory(): Promise<Track[]> {
  const body = await apiPost<KugouBody<{ songs?: unknown[] }>>(
    '/user/history',
    { timestamp: Date.now() },
    { timeout: 15_000 }
  )

  if (body?.status !== 1) {
    throw new ApiError(body?.error_msg || '听歌历史获取失败', {
      code: body?.error_code ?? 'USER_HISTORY_FAILED',
      payload: body,
    })
  }

  return normalizeTracks(body.data?.songs)
}
