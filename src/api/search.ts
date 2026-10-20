/**
 * 搜索（文档 §3.3）
 *
 * 四类结果字段完全不同构，分别归一化：
 * - song   → api/track.ts 的 normalizeTrack
 * - special（歌单）→ gid / specialname / img
 * - author（歌手）→ AuthorId / AuthorName / Avatar
 * - album（专辑）→ albumid / albumname / singer
 */
import { apiGet, ApiError } from './request'
import { normalizeTracks } from './track'
import type { KugouBody } from './login'
import type { Track } from '@/types/kugou'

type Raw = Record<string, unknown>

export interface SongSearchResult {
  tracks: Track[]
  total: number
  page: number
  pageSize: number
  correction: string | null
}

export interface PlaylistSearchItem {
  id: string
  name: string
  cover: string | null
  count: number
  creator: string
  playCount: number
}

export interface AuthorSearchItem {
  id: string
  name: string
  avatar: string | null
  fans: number
  songCount: number
}

export interface AlbumSearchItem {
  id: string
  name: string
  singer: string
  cover: string | null
  songCount: number
  publishTime: string
}

export interface SearchPage<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

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

/** 封面 URL 的 `{size}` 占位替换 */
function image(value: unknown, size = 480): string | null {
  const path = str(value)
  if (!path || !/^https?:\/\//.test(path)) return null
  return path.replace('{size}', String(size))
}

async function requestSearch(
  keyword: string,
  type: 'song' | 'special' | 'author' | 'album',
  page: number,
  pageSize: number
): Promise<{ data: Record<string, unknown>; page: number; pageSize: number; total: number }> {
  const body = await apiGet<
    KugouBody<{ lists?: Raw[]; total?: number; page?: number; pagesize?: number; correctiontip?: string }>
  >(
    '/search',
    { keywords: keyword, type, page, pagesize: pageSize, timestamp: Date.now() },
    { timeout: 15_000 }
  )

  if (body?.status !== 1) {
    const message = body?.error_msg || body?.msg || body?.message || '搜索失败，请稍后重试'
    throw new ApiError(message, { code: body?.error_code ?? 'SEARCH_FAILED', payload: body })
  }

  const data = (body.data ?? {}) as Record<string, unknown>
  return {
    data,
    page: num(data.page) ?? page,
    pageSize: num(data.pagesize) ?? pageSize,
    total: num(data.total) ?? (Array.isArray(data.lists) ? data.lists.length : 0),
  }
}

export async function searchSongs(
  keyword: string,
  options: { page?: number; pageSize?: number } = {}
): Promise<SongSearchResult> {
  const result = await requestSearch(keyword, 'song', options.page ?? 1, options.pageSize ?? 30)
  const data = result.data as { lists?: Raw[]; correctiontip?: string }
  const tracks = normalizeTracks(data.lists)

  return {
    tracks,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    correction: typeof data.correctiontip === 'string' && data.correctiontip.trim() ? data.correctiontip : null,
  }
}

export async function searchPlaylists(
  keyword: string,
  options: { page?: number; pageSize?: number } = {}
): Promise<SearchPage<PlaylistSearchItem>> {
  const result = await requestSearch(keyword, 'special', options.page ?? 1, options.pageSize ?? 12)
  const lists = (result.data as { lists?: Raw[] }).lists ?? []

  const items = lists
    .map((item): PlaylistSearchItem | null => {
      const id = str(item.gid)
      if (!id) return null
      return {
        id,
        name: str(item.specialname) ?? '未命名歌单',
        cover: image(item.img),
        count: num(item.song_count) ?? 0,
        creator: str(item.nickname) ?? '—',
        playCount: num(item.play_count) ?? num(item.total_play_count) ?? 0,
      }
    })
    .filter((item): item is PlaylistSearchItem => item !== null)

  return { items, total: result.total, page: result.page, pageSize: result.pageSize }
}

export async function searchAuthors(
  keyword: string,
  options: { page?: number; pageSize?: number } = {}
): Promise<SearchPage<AuthorSearchItem>> {
  const result = await requestSearch(keyword, 'author', options.page ?? 1, options.pageSize ?? 12)
  const lists = (result.data as { lists?: Raw[] }).lists ?? []

  const items = lists
    .map((item): AuthorSearchItem | null => {
      const id = str(item.AuthorId)
      if (!id) return null
      return {
        id,
        name: str(item.AuthorName) ?? '未知歌手',
        avatar: image(item.Avatar, 200),
        fans: num(item.FansNum) ?? 0,
        songCount: num(item.AudioCount) ?? 0,
      }
    })
    .filter((item): item is AuthorSearchItem => item !== null)

  return { items, total: result.total, page: result.page, pageSize: result.pageSize }
}

export async function searchAlbums(
  keyword: string,
  options: { page?: number; pageSize?: number } = {}
): Promise<SearchPage<AlbumSearchItem>> {
  const result = await requestSearch(keyword, 'album', options.page ?? 1, options.pageSize ?? 12)
  const lists = (result.data as { lists?: Raw[] }).lists ?? []

  const items = lists
    .map((item): AlbumSearchItem | null => {
      const id = str(item.albumid)
      if (!id) return null
      return {
        id,
        name: str(item.albumname) ?? '未知专辑',
        singer: str(item.singer) ?? '未知歌手',
        cover: image(item.img),
        songCount: num(item.songcount) ?? 0,
        publishTime: str(item.publish_time) ?? '',
      }
    })
    .filter((item): item is AlbumSearchItem => item !== null)

  return { items, total: result.total, page: result.page, pageSize: result.pageSize }
}
