/**
 * 曲目归一化
 *
 * 酷狗不同内容源（搜索、每日推荐、排行榜、歌单）返回的歌曲字段**完全不同构**（文档 §7.6）：
 * - 搜索：FileHash / HQFileHash / SQFileHash / ResFileHash + SongName / SingerName
 * - 每日推荐：hash / hash_320 / hash_flac + songname / author_name / time_length（秒）
 * - 排行榜：audio_info.hash_128… + album_info + duration_128（毫秒）
 * - 歌单：hash + relate_goods[].bitrate + timelen（毫秒）
 *
 * 这里做一次统一收敛，页面与播放器只需要面对 Track。
 */
import type { SongQuality, Track } from '@/types/kugou'

type Raw = Record<string, unknown>

function asObject(value: unknown): Raw | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null
}

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/**
 * 同 str，但额外接受「单元素数组」。
 * 搜索结果里 SingerId 是数组（如 [6539]），直接 str() 会丢掉。
 */
function strFirst(value: unknown): string | null {
  if (Array.isArray(value)) return value.length > 0 ? str(value[0]) : null
  return str(value)
}

/** 多候选字段里取第一个非空值，避免 long ?? 链堆成一坨 */
function pick(...values: unknown[]): string | null {
  for (const value of values) {
    const text = str(value)
    if (text) return text
  }
  return null
}

/**
 * 从对象数组里取第一个非空字段，用于 singerinfo / authors / Singers 三种异构结构。
 * 传 keys 而不是单个 key，是因为不同来源的 id 字段分别叫 id / author_id / singerid。
 */
function firstField(list: unknown, keys: string[]): string | null {
  if (!Array.isArray(list)) return null
  for (const entry of list) {
    const item = asObject(entry)
    if (!item) continue
    for (const key of keys) {
      const value = str(item[key])
      if (value) return value
    }
  }
  return null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function joinNames(list: unknown): string | null {
  if (!Array.isArray(list)) return null
  const names = list
    .map((entry) => {
      const item = asObject(entry)
      return item ? str(item.name) ?? str(item.author_name) ?? str(item.authorName) : str(entry)
    })
    .filter((name): name is string => Boolean(name))
  return names.length > 0 ? names.join(' / ') : null
}

/** 封面统一替换 `{size}` 占位，并按优先级挑第一个可用的 */
function coverOf(raw: Raw, albumInfo: Raw | null): string | undefined {
  const trans = asObject(raw.trans_param)
  const candidates = [
    str(raw.cover),
    str(raw.sizable_cover),
    str(raw.Image),
    str(raw.AlbumImage),
    albumInfo ? str(albumInfo.sizable_cover) : null,
    trans ? str(trans.union_cover) : null,
    str(raw.imgurl),
  ]

  const found = candidates.find((value) => value && /^https?:\/\//.test(value))
  return found ? found.replace('{size}', '480') : undefined
}

function pickFromRelate(relate: Raw[], min: number, max: number): string | undefined {
  for (const entry of relate) {
    const bitrate = num(entry.bitrate)
    const hash = str(entry.hash)
    if (hash && bitrate !== null && bitrate >= min && bitrate <= max) return hash
  }
  return undefined
}

/** 毫秒 / 秒混合的时长字段统一为秒 */
function toSeconds(value: number | null): number {
  if (value === null || !Number.isFinite(value) || value <= 0) return 0
  return value > 10_000 ? Math.round(value / 1000) : Math.round(value)
}

export function normalizeTrack(raw: unknown): Track | null {
  const item = asObject(raw)
  if (!item) return null

  const audioInfo = asObject(item.audio_info)
  const albumInfo = asObject(item.album_info)
  const album = asObject(item.albuminfo)
  // /album/songs 把曲名、歌手、album_audio_id 全部塞进 base 子对象里，
  // 不读它就只能得到「未知曲目」且取流缺 album_audio_id。
  const base = asObject(item.base)
  const relate = Array.isArray(item.relate_goods)
    ? item.relate_goods.map(asObject).filter((entry): entry is Raw => entry !== null)
    : []

  const hash =
    str(item.hash) ??
    str(item.FileHash) ??
    str(item.hash_128) ??
    (audioInfo ? str(audioInfo.hash_128) : null)
  if (!hash) return null

  const hashes: Partial<Record<SongQuality, string>> = { '128': hash }
  const hq =
    str(item.hash_320) ??
    str(item.HQFileHash) ??
    (audioInfo ? str(audioInfo.hash_320) : null) ??
    pickFromRelate(relate, 250, 400)
  const sq =
    str(item.hash_flac) ??
    str(item.SQFileHash) ??
    (audioInfo ? str(audioInfo.hash_flac) : null) ??
    pickFromRelate(relate, 700, 1400)
  const hi =
    str(item.hash_high) ??
    str(item.ResFileHash) ??
    (audioInfo ? str(audioInfo.hash_high) : null) ??
    pickFromRelate(relate, 1401, 100_000)

  if (hq && hq !== '0') hashes['320'] = hq
  if (sq && sq !== '0') hashes.flac = sq
  if (hi && hi !== '0') hashes.high = hi

  const durationRaw =
    num(item.time_length) ??
    num(item.Duration) ??
    num(item.timelen) ??
    num(item.timelength) ??
    (audioInfo ? num(audioInfo.duration_128) : null)

  return {
    hash,
    name:
      pick(
        item.songname,
        item.name,
        item.SongName,
        item.audio_name,
        item.filename,
        item.FileName,
        item.ori_audio_name,
        base?.audio_name,
        base?.songname,
        base?.filename
      ) ?? '未知曲目',
    singer:
      str(item.author_name) ??
      joinNames(item.singerinfo) ??
      str(item.SingerName) ??
      joinNames(item.Singers) ??
      joinNames(item.authors) ??
      str(base?.author_name) ??
      '未知歌手',
    album:
      str(item.album_name) ??
      (album ? str(album.name) : null) ??
      str(item.AlbumName) ??
      (albumInfo ? str(albumInfo.album_name) : null) ??
      str(base?.album_name) ??
      '未知专辑',
    albumId:
      strFirst(item.album_id) ??
      strFirst(item.AlbumID) ??
      strFirst(base?.album_id) ??
      (album ? str(album.id) : null) ??
      undefined,
    // 歌手 id 命名比专辑 id 更乱：搜索是 SingerId（数组）、榜单是 authors[].author_id、
    // 歌单是 singerinfo[].id，这里全部兼容；取不到时详情页不显示跳转。
    artistId:
      strFirst(item.author_id) ??
      strFirst(item.AuthorId) ??
      strFirst(item.artist_id) ??
      strFirst(item.singer_id) ??
      strFirst(item.singerid) ??
      strFirst(item.SingerId) ??
      firstField(item.singerinfo, ['id', 'author_id', 'singerid']) ??
      firstField(item.authors, ['author_id', 'id']) ??
      firstField(item.Singers, ['id', 'author_id', 'singerid']) ??
      undefined,
    albumAudioId:
      str(item.mixsongid) ??
      str(item.album_audio_id) ??
      str(item.MixSongID) ??
      str(item.audioid) ??
      str(item.add_mixsongid) ??
      str(base?.album_audio_id) ??
      undefined,
    duration: toSeconds(durationRaw),
    cover: coverOf(item, albumInfo),
    hashes,
    privilege: num(item.privilege) ?? num(item.Privilege) ?? undefined,
  }
}

/** 批量归一化并过滤无效项 */
export function normalizeTracks(list: unknown): Track[] {
  if (!Array.isArray(list)) return []
  return list.map(normalizeTrack).filter((track): track is Track => track !== null)
}
