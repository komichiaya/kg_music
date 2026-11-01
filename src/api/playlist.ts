/**
 * 歌单相关接口（文档 §3.4 / §7.6）
 *
 * 关键约束：
 * - `/playlist/track/all` 的 `id` 必须是 `global_collection_id`（gid），传 specialid 会 20010。
 * - 歌单曲目字段与歌曲搜索不同构，统一由 api/track.ts 归一化。
 */
import { apiGet, apiPost, ApiError, http } from './request'
import { normalizeTracks } from './track'
import { COVER_MAX_BYTES } from '@/utils/image'
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
    // 版本号用于 /playlist/update，部分返回放在列表级（见 fetchUserPlaylists 的兜底）
    totalVer: str(item.total_ver) ?? undefined,
  }
}

/**
 * 歌单详情（批量接口，这里取第一条）
 *
 * `timestamp` 同时放 query：上游 apicache 缓存键是 `hostname + originalUrl`，
 * 只带 body 会让 URL 恒定，改完封面/名字立刻回读详情会拿到 2 分钟前的旧数据
 * （2026-10-26 实测：无 query ts 读到空 pic，带 query ts 读到新 pic）。
 */
export async function fetchPlaylistDetail(
  gid: string,
  currentUserId: string | null = null
): Promise<PlaylistSummary | null> {
  const body = await apiPost<KugouBody<Raw[] | Raw>>(
    '/playlist/detail',
    { timestamp: Date.now() },
    { params: { ids: gid, timestamp: Date.now() }, timeout: 15_000 }
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

/**
 * 我的歌单列表
 *
 * `timestamp` 必须放在 **query** 里（不是 body）：上游 apicache 的缓存键是
 * `hostname + originalUrl`，只带 body 的 timestamp 会让 URL 恒定不变，
 * 于是「新建/改名/改封面后重新拉列表」会命中 2 分钟内的旧缓存，
 * 表现为侧栏迟迟看不到变化（2026-10-26 实测确认）。
 */
export async function fetchUserPlaylists(userid: string): Promise<PlaylistSummary[]> {
  const body = await apiPost<KugouBody<{ info?: Raw[]; total_ver?: unknown }>>(
    '/user/playlist',
    { timestamp: Date.now() },
    { params: { pagesize: 50, timestamp: Date.now() }, timeout: 15_000 }
  )

  if (body?.status !== 1) {
    throw new ApiError(body?.error_msg || '我的歌单获取失败', {
      code: body?.error_code ?? 'USER_PLAYLIST_FAILED',
      payload: body,
    })
  }

  const list = Array.isArray(body.data?.info) ? body.data.info : []
  // 版本号有的版本挂在列表级，条目里没有时用它兜底，否则 /playlist/update 会版本冲突
  const listVer = str(body.data?.total_ver)

  return list
    .map((item) => toPlaylist(item, userid))
    .filter((item) => item.id)
    .map((item) => (item.totalVer || !listVer ? item : { ...item, totalVer: listVer }))
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

/* ============================================================
 * 修改歌单信息 / 从歌单删除曲目
 *
 * 参数语义来自上游模块（module/playlist_update.js、module/playlist_tracks_del.js）：
 * - `/playlist/update` 只认 listid（不是 gid），且 total_ver 必传；
 *   模块里 intro / sort / tags 是「不传即写默认值」的写法（`params.intro || ''`、sort 默认 0），
 *   所以只改名字也必须把简介原样带上，否则一次重命名会把简介清空。
 * - `/playlist/tracks/del` 只认 fileid（歌单内曲目 id，不是 hash）。
 *   重复添加同一首会改写 fileid，因此删除前必须重新读一次歌单曲目，不能用列表里的旧值。
 * ============================================================ */

/* ============================================================
 * 歌单自定义封面
 *
 * 实测结论（2026-10-26，真实账号）：
 * - 上传与设置是**两步**：`/playlist/pic/upload` 只负责把图片推到图床并返回 `FileName`，
 *   真正写入歌单要走 `/playlist/update` 的 `pic=custom/<FileName>`。
 * - 上传接口**不需要登录**（鉴权在改歌单那一步）；上游为此开了二进制通道
 *   （server.js 的 `express.raw({type:'application/octet-stream'})`），
 *   所以这里不能用 apiPost（它固定 Content-Type: application/json）。
 * - 新建歌单接口（`/playlist/add`）**没有 pic 字段**，只能建完再 update 一次。
 * - 自定义封面的回读地址是 `http://c1.kgimg.com/custom/{size}/...`，
 *   与系统封面的 `stdmusic/` 前缀不同，但同样支持 `{size}` 占位。
 * ============================================================ */

/**
 * 自定义封面允许的图片类型（图床按扩展名分派，猜错会拿不到 FileName）
 *
 * 注意：真正提交给图床的是 `utils/image.ts` 里 `prepareCoverImage()` 处理后的 JPEG，
 * 这里保留多格式只是为了给用户更宽松的「可选文件类型」。
 */
const COVER_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.jpg',
  'image/webp': '.jpg',
  'image/gif': '.jpg',
}

/**
 * 上传一张图片作为歌单自定义封面，返回可直接用于 `pic` 的 `custom/<FileName>`。
 *
 * 入参应当是 `prepareCoverImage()` 的输出（512×512 JPEG）——图床对尺寸和体积有硬限制
 * （宽高 ≥400、单边 ≤8192、≤3MB），原图直传经常失败。这里只做兜底校验。
 */
export async function uploadPlaylistCover(file: File): Promise<string> {
  const ext = COVER_MIME_EXT[file.type]
  if (!ext) {
    throw new ApiError('只支持 JPG / PNG / WebP / GIF 图片', { code: 'COVER_TYPE_INVALID' })
  }
  if (file.size > COVER_MAX_BYTES) {
    throw new ApiError('图片过大，请选择 3MB 以内的图片', { code: 'COVER_TOO_LARGE' })
  }
  if (file.size === 0) {
    throw new ApiError('图片内容为空，请重新选择', { code: 'COVER_EMPTY' })
  }

  // 上传接口的响应是扁平的 `{status, FileName}`，不是上游常见的 `{data:{...}}` 壳，
  // 所以这里不用 KugouBody。
  const body = await http
    .post<{ status?: number; FileName?: string; msg?: string; error_msg?: string; error_code?: number }>(
      '/playlist/pic/upload',
      file,
      {
        params: { type: 'custom', extendName: ext, timestamp: Date.now() },
        headers: { 'Content-Type': 'application/octet-stream' },
        // 图片上传比普通接口慢，且上游要转发到图床，给足 30s
        timeout: 30_000,
      }
    )
    .then((response) => response.data)

  const fileName = str(body?.FileName)
  if (body?.status !== 1 || !fileName) {
    throw new ApiError(body?.msg || body?.error_msg || '封面上传失败，请稍后重试', {
      code: body?.error_code ?? 'COVER_UPLOAD_FAILED',
      payload: body,
    })
  }

  return `custom/${fileName}`
}

/**
 * 修改「我的歌单」名称 / 简介 / 自定义封面（传 undefined 表示不改该项）。
 *
 * `pic` 只在传了值时才会带上：上游模块是 `if (params.pic)` 判断，
 * 不传即保持原封面 —— 这一点和 `intro`（不传即写空）相反，容易搞混。
 */
export async function updatePlaylist(
  listid: string,
  patch: { name?: string; intro?: string; pic?: string; totalVer?: string }
): Promise<void> {
  const body = await apiGet<KugouBody<Raw>>(
    '/playlist/update',
    {
      listid,
      total_ver: patch.totalVer || 0,
      type: 0,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      intro: patch.intro ?? '',
      ...(patch.pic ? { pic: patch.pic } : {}),
      timestamp: Date.now(),
    },
    { timeout: 15_000 }
  )

  if (body?.status !== 1) {
    throw new ApiError(body?.error_msg || body?.error || '保存歌单信息失败', {
      code: body?.error_code ?? 'PLAYLIST_UPDATE_FAILED',
      payload: body,
    })
  }
}

/** 从歌单删除一首歌（fileid 必须来自最新一次 /playlist/track/all） */
export async function removeTrackFromPlaylist(listid: string, fileid: string): Promise<void> {
  const body = await apiGet<KugouBody<Raw>>(
    '/playlist/tracks/del',
    { listid, fileids: fileid, timestamp: Date.now() },
    { timeout: 15_000 }
  )

  if (body?.status !== 1) {
    throw new ApiError(body?.error_msg || body?.error || '从歌单移除失败', {
      code: body?.error_code ?? 'PLAYLIST_TRACK_DEL_FAILED',
      payload: body,
    })
  }
}

/** 新建歌单返回的标识；上游字段随版本变化，这里做宽松解析 */
export interface CreatedPlaylistRef {
  /** 账号内 listid，写曲目时必传 */
  listid: string | null
  /** global_collection_id，详情页路由用 */
  gid: string | null
}

/**
 * 新建空白歌单。
 *
 * 上游 `/playlist/add`：`type=0` 为创建，`type=1` 为收藏；
 * 新建时 `list_create_userid/list_create_listid` 固定传 0（参考官方 Lite 端报文）。
 */
export async function createPlaylist(
  name: string,
  options: { private?: boolean } = {}
): Promise<CreatedPlaylistRef> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new ApiError('歌单名称不能为空', { code: 'PLAYLIST_NAME_REQUIRED' })
  }

  const body = await apiPost<KugouBody<Raw>>(
    '/playlist/add',
    {
      name: trimmed,
      type: 0,
      source: 1,
      is_pri: options.private ? 1 : 0,
      list_create_userid: 0,
      list_create_listid: 0,
      list_create_gid: '',
    },
    { params: { timestamp: Date.now() }, timeout: 15_000 }
  )

  if (body?.status !== 1) {
    const message =
      body?.error_msg ||
      body?.msg ||
      body?.message ||
      `创建歌单失败（错误码 ${body?.error_code ?? body?.errcode ?? '未知'}）`
    throw new ApiError(message, {
      code: body?.error_code ?? body?.errcode ?? 'PLAYLIST_CREATE_FAILED',
      payload: body,
    })
  }

  const data = (body.data ?? {}) as Raw
  const info = (data.info ?? {}) as Raw
  return {
    listid: str(data.listid) ?? str(info.listid) ?? null,
    gid:
      str(data.global_collection_id) ??
      str(data.list_create_gid) ??
      str(info.global_collection_id) ??
      null,
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
