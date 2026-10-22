/**
 * 跨进程共享类型定义
 *
 * 该文件同时被 Renderer（Vue）与 Main / Preload（Electron）引用，
 * 只允许出现「类型」，不得包含任何运行时代码，避免被打包进 preload。
 */

/** 三个登录通道统一收敛后的凭证对象（文档 §4.1.5） */
export interface KugouCredential {
  token: string
  userid: string
  vip_type: number
  vip_token: string
  t1?: string
  dfid?: string
}

/** 登录通道 */
export type LoginChannel = 'qr' | 'cellphone' | 'password'

/**
 * 归一化后的用户资料。
 * 上游 /user/info 字段命名在不同版本间有差异，统一在此收敛，
 * 视图层只依赖这里的字段。
 */
export interface UserProfile {
  userid: string
  nickname: string
  /** 头像可能为空或加载失败，视图层需回退到首字母占位 */
  avatar: string | null
  vipType: number
  /** 听歌等级，接口未返回时为 null（P5 由 /user/grade/info 补齐） */
  level: number | null
  /** 账号绑定手机号的脱敏展示，接口未返回时为 null */
  mobile: string | null
}

/** 排行榜条目（/rank/list） */
export interface RankSummary {
  rankid: string
  name: string
  cover: string | null
  intro: string
  updateFrequency: string
  playCount: number | null
}

/** 歌单摘要（/user/playlist、/playlist/detail） */
export interface PlaylistSummary {
  /** global_collection_id，即 gid；/playlist/track/all 必须用它 */
  id: string
  /**
   * 歌单在账号内的 listid，只有「写操作」用得到
   * （/playlist/tracks/add|del 要 listid，传 gid 会失败）。
   */
  listid?: string
  name: string
  cover: string | null
  count: number
  creator: string
  intro: string
  mine: boolean
  /**
   * 歌单总版本号，`/playlist/update` 的必选参数。
   * 由 `/user/playlist` 返回，缺失时更新接口可能报版本冲突，调用方需容错。
   */
  totalVer?: string
}

/** 专辑详情（/album/detail），曲目由 /album/songs 单独拉取 */
export interface AlbumDetail {
  id: string
  name: string
  cover: string | null
  /** 专辑简介，接口未返回时为空串 */
  intro: string
  author: string
  authorId: string | null
  publishDate: string | null
  language: string | null
  /** 录音室专辑 / EP / 单曲 等 */
  type: string | null
}

/** 歌手详情（/artist/detail） */
export interface ArtistDetail {
  id: string
  name: string
  avatar: string | null
  /** 短简介，缺失时回退长简介首段 */
  intro: string
  fans: number | null
  songCount: number | null
  albumCount: number | null
  mvCount: number | null
}

/** 专辑卡片（/artist/albums） */
export interface AlbumSummary {
  id: string
  name: string
  cover: string | null
  author: string
  publishDate: string | null
}

/** 听歌等级（/user/grade/info 查询模式） */
export interface GradeInfo {
  level: number
  points: number
  nextLevelPoints: number
  /** 当前等级完成百分比 0–100 */
  finishPercent: number
  /** 累计听歌秒数（d_sec） */
  totalSeconds: number
}

/** 会员信息（/user/vip/detail） */
export interface VipInfo {
  isVip: boolean
  vipType: number
  /** 到期时间，接口未返回时为 null */
  expireAt: string | null
}

/** 扫码登录状态机（文档 §4.1.2） */
export type QrPhase =
  | 'idle'
  | 'loading'
  | 'waiting'
  | 'scanned'
  | 'confirmed'
  | 'expired'
  | 'error'

/** 桌面歌词窗口：单字填充比例用于逐字扫光 */
export interface DesktopLyricWord {
  text: string
  /** 0–1，已唱进度 */
  fill: number
}

export interface DesktopLyricPayload {
  title: string
  artist: string
  playing: boolean
  prev: string | null
  current: { text: string; words: DesktopLyricWord[] } | null
  next: string | null
}

/** 音质档位，与上游 /song/url 的 quality 参数一致 */
export type SongQuality = '128' | '320' | 'flac' | 'high'

/** 播放模式 */
export type PlayMode = 'order' | 'single' | 'random'

/** 主题偏好 */
export type ThemeMode = 'dark' | 'light' | 'system'

/**
 * 主题风格（与明暗主题正交）
 * - aurora：极光渐变，动态光晕 + 玻璃质感（默认）
 * - minimal：极简，亮色纯白、暗色纯黑，扁平描边
 */
export type ThemeStyle = 'aurora' | 'minimal'

/** 归一化后的曲目结构，字段命名对齐上游 song 搜索结果 */
export interface TrackArtist {
  /** 缺失时该歌手只展示、不可跳转（宁可不跳，也不指错人） */
  id?: string
  name: string
}

export interface Track {
  /** 歌曲 hash（128K 版本），同时作为队列内唯一标识 */
  hash: string
  name: string
  singer: string
  /**
   * 歌手列表（按上游顺序）。多歌手时每项可独立跳转；
   * 只有 `singer` 一个拼接串的来源（如部分搜索结果）会按名字数量与 id 数组对齐，
   * 对不上时只给 name 不给 id。
   */
  artists?: TrackArtist[]
  album: string
  albumId?: string | number
  /** 歌手 id（author_id / SingerId 等），用于跳转歌手页；缺失时详情页不提供跳转 */
  artistId?: string | number
  /** 取流必传：上游 /song/url 的 album_audio_id（MixSongID） */
  albumAudioId?: string | number
  /** 时长（秒） */
  duration: number
  cover?: string
  /** 各音质对应的文件 hash；缺省时回退到 hash */
  hashes?: Partial<Record<SongQuality, string>>
  /** 版权标记：8/10 之类的上游值，仅用于列表角标 */
  privilege?: number
  payType?: number
  /**
   * 歌单内曲目 id，仅 `/playlist/track/all` 的返回带这个字段。
   * 从歌单里删歌必须用它（`/playlist/tracks/del` 只认 fileid，不认 hash），
   * 搜索结果等其他来源没有，因此为可选。
   */
  fileid?: string
}

/** 上游守护进程状态 */
export type UpstreamState = 'idle' | 'starting' | 'running' | 'external' | 'failed' | 'stopped'

export interface UpstreamStatus {
  state: UpstreamState
  port: number
  baseUrl: string
  pid: number | null
  /** 已发生的自动重启次数 */
  attempts: number
  lastError: string | null
  /** 最近若干行子进程输出，便于在设置页定位问题 */
  logTail: string[]
  /** 上游工程目录（未找到时为 null） */
  apiDir: string | null
}

/** Main 进程注入给 Renderer 的应用信息 */
export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  isPackaged: boolean
  /** Renderer 应使用的 API baseURL */
  apiBase: string
  upstream: UpstreamStatus
}

/** preload 通过 contextBridge 暴露的全部能力（唯一入口 window.kugou） */
export interface KugouBridge {
  app: {
    info: () => Promise<AppInfo>
    openExternal: (url: string) => Promise<boolean>
  }
  window: {
    minimize: () => void
    toggleMaximize: () => Promise<boolean>
    close: () => void
    isMaximized: () => Promise<boolean>
    /** 切换迷你播放器窗口，返回切换后的状态 */
    setMini: (enabled: boolean) => Promise<boolean>
    isMini: () => Promise<boolean>
    onMaximizeChange: (cb: (maximized: boolean) => void) => () => void
  }
  credential: {
    get: () => Promise<KugouCredential | null>
    set: (credential: KugouCredential) => Promise<boolean>
    clear: () => Promise<void>
  }
  upstream: {
    status: () => Promise<UpstreamStatus>
    restart: () => Promise<UpstreamStatus>
    onStatus: (cb: (status: UpstreamStatus) => void) => () => void
  }
  /** 桌面歌词独立窗口 */
  lyric: {
    open: () => Promise<boolean>
    close: () => Promise<boolean>
    toggle: () => Promise<boolean>
    sync: (payload: DesktopLyricPayload) => void
    onData: (cb: (payload: DesktopLyricPayload) => void) => () => void
    /** 窗口开关状态（用户在桌面歌词窗里关闭时同步回设置） */
    onState: (cb: (open: boolean) => void) => () => void
  }
}
