/**
 * 歌词解析（文档 §4.2.1）
 *
 * LRC：`[mm:ss.xx]文本`，支持一行多时间标签与 `[offset:±ms]`。
 * KRC：`[行开始ms,行时长ms]<字偏移ms,字时长ms,0>字...`，
 *      字偏移**相对于行开始**，因此字绝对时间 = 行开始 + 偏移。
 *
 * 统一以毫秒存储，避免浮点误差累积；展示层再换算成秒。
 */
import type { LyricFormat } from '@/api/lyric'

export interface LyricWord {
  /** 绝对时间（毫秒） */
  start: number
  /** 持续时间（毫秒） */
  duration: number
  text: string
}

export interface LyricLine {
  /** 绝对时间（毫秒） */
  start: number
  duration: number
  text: string
  /** 逐字信息，LRC 为空数组 */
  words: LyricWord[]
  /**
   * 译文（KRC 的 `[language:]` 字段按行号一一对应）。
   * 只有外文歌才有；LRC 格式没有这个字段。
   */
  translation?: string
  /**
   * 音译（日文歌的罗马音，同样是 `[language:]` 的 `type: 0` 块）。
   * 只有部分外文歌提供；与原文逐行对齐，但**没有逐字时间**。
   */
  transliteration?: string
}

export interface ParsedLyric {
  format: LyricFormat
  lines: LyricLine[]
  title: string | null
  artist: string | null
  album: string | null
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const META_TAG = /^\[(ti|ar|al|by|offset|total|hash|sign|qq|language):(.*)\]$/i
const KRC_LINE = /^\[(\d+),(\d+)\](.*)$/
const KRC_WORD = /<(-?\d+),(-?\d+),-?\d+>([^<]*)/g
/** KRC 的译文/音译字段，值是 base64 的 JSON */
const LANGUAGE_TAG = /^\[language:([A-Za-z0-9+/=]+)\]$/i

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '')
}

/**
 * 解析 KRC 的 `[language:...]`：base64 → JSON → 按行排列的译文。
 *
 * 结构是 `{ content: [{ language: 0, lyricContent: [["译"], ["文"], ...] }] }`，
 * 每项对应 KRC 的一行（含空行，顺序严格一致），所以能按行号对齐。
 * 部分日文歌会再给一块罗马音，这里只取第一块（中文译文）。
 */
interface LanguageBlocks {
  /** 中文译文（type: 1） */
  translations: string[]
  /** 罗马音 / 音译（type: 0） */
  transliterations: string[]
}

/**
 * 解出 `[language:]` 里的译文与音译。
 *
 * `content` 里通常有 1–2 块，顺序**不固定**（实测 Lemon 是 [译文, 罗马音]，
 * 打上花火是 [罗马音, 译文]），因此必须按 `type` 选，不能取第一块：
 * - `type: 1` → 译文
 * - `type: 0` → 音译（日文罗马音）
 */
function decodeLanguage(encoded: string): LanguageBlocks {
  const empty: LanguageBlocks = { translations: [], transliterations: [] }
  try {
    const binary = atob(encoded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
      content?: Array<{ type?: number; lyricContent?: string[][] }>
    }
    const blocks = payload.content ?? []
    const usable = (block?: { lyricContent?: string[][] }) => (block?.lyricContent?.length ?? 0) > 0

    const translation =
      blocks.find((item) => item.type === 1 && usable(item)) ??
      // 兼容没有 type 字段的旧数据：把第一块当译文
      blocks.find((item) => item.type === undefined && usable(item))
    const transliteration = blocks.find((item) => item.type === 0 && usable(item))

    const rows = (block?: { lyricContent?: string[][] }) =>
      (block?.lyricContent ?? []).map((segments) => segments.join('').trim())

    return { translations: rows(translation), transliterations: rows(transliteration) }
  } catch {
    // 字段损坏 / 不是预期结构时当作没有附加语言块，不影响原歌词
    return empty
  }
}

/** 时间标签换算：`.74` → 740ms，`.740` → 740ms，`.7` → 700ms */
function fractionToMs(fraction: string | undefined): number {
  if (!fraction) return 0
  return Number(fraction.padEnd(3, '0').slice(0, 3))
}

function readMeta(line: string, parsed: ParsedLyric): boolean {
  const match = META_TAG.exec(line)
  if (!match) return false
  const key = match[1].toLowerCase()
  const value = match[2].trim()
  if (key === 'ti') parsed.title = value || null
  else if (key === 'ar') parsed.artist = value || null
  else if (key === 'al') parsed.album = value || null
  return true
}

/** 补齐行时长：LRC 没有行时长，用下一行开始时间推算 */
function fillDurations(lines: LyricLine[]): LyricLine[] {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.duration > 0) continue
    const next = lines[index + 1]
    line.duration = next ? Math.max(500, next.start - line.start) : 5_000
  }
  return lines
}

export function parseLrc(text: string): ParsedLyric {
  const parsed: ParsedLyric = { format: 'lrc', lines: [], title: null, artist: null, album: null }
  let offset = 0

  for (const raw of stripBom(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    const offsetMatch = /^\[offset:([+-]?\d+)\]$/i.exec(line)
    if (offsetMatch) {
      offset = Number(offsetMatch[1]) || 0
      continue
    }

    if (readMeta(line, parsed)) continue

    // 一行可能有多个时间标签：[00:10.00][01:20.00]副歌
    const starts: number[] = []
    TIME_TAG.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = TIME_TAG.exec(line)) !== null) {
      const minute = Number(match[1])
      const second = Number(match[2])
      starts.push(minute * 60_000 + second * 1_000 + fractionToMs(match[3]))
    }
    if (starts.length === 0) continue

    const content = line.replace(TIME_TAG, '').trim()
    if (!content) continue

    for (const start of starts) {
      parsed.lines.push({ start: start + offset, duration: 0, text: content, words: [] })
    }
  }

  parsed.lines.sort((a, b) => a.start - b.start)
  parsed.lines = fillDurations(parsed.lines)
  return parsed
}

export function parseKrc(text: string): ParsedLyric {
  const parsed: ParsedLyric = { format: 'krc', lines: [], title: null, artist: null, album: null }
  const rawLines = stripBom(text).split(/\r?\n/)

  // 先单独扫一遍取附加语言块：`[language:]` 一般在头部，但顺序不保证
  let translations: string[] = []
  let transliterations: string[] = []
  for (const raw of rawLines) {
    const match = LANGUAGE_TAG.exec(raw.trim())
    if (match) {
      const decoded = decodeLanguage(match[1])
      translations = decoded.translations
      transliterations = decoded.transliterations
      break
    }
  }

  // 译文按 KRC 原始行号对齐：空行、纯音乐行也必须占位，不能跳号
  let rawIndex = -1

  for (const raw of rawLines) {
    const line = raw.trim()
    if (!line) continue

    if (readMeta(line, parsed)) continue

    const lineMatch = KRC_LINE.exec(line)
    if (!lineMatch) continue

    rawIndex += 1

    const lineStart = Number(lineMatch[1])
    const lineDuration = Number(lineMatch[2])
    const body = lineMatch[3]

    const words: LyricWord[] = []
    KRC_WORD.lastIndex = 0
    /**
     * 游标 = 上一个字结束的绝对时间。
     *
     * KRC 存在一个常见编码瑕疵：行尾字（偶尔也包括行首字）的偏移与时长都是 0，
     * 例如 `<0,0,0>可`、`<0,0,0>山`。若直接按「行开始 + 偏移」计算，
     * 这些字会被判定为「从行首就已唱完」，导致最后一个字一开始就整字高亮。
     * 这里用 max(行开始 + 偏移, 游标) 兜底：偏移缺失时顺延到上一个字之后。
     */
    let cursor = lineStart
    let wordMatch: RegExpExecArray | null
    while ((wordMatch = KRC_WORD.exec(body)) !== null) {
      const wordText = wordMatch[3]
      if (!wordText) continue
      const offset = Math.max(0, Number(wordMatch[1]))
      const duration = Math.max(0, Number(wordMatch[2]))
      const start = Math.max(lineStart + offset, cursor)
      words.push({ start, duration, text: wordText })
      cursor = start + duration
    }

    const plain = body.replace(KRC_WORD, '').trim()
    const text = words.length > 0 ? words.map((word) => word.text).join('').trim() : plain
    if (!text) continue

    const translation = translations[rawIndex]
    const transliteration = transliterations[rawIndex]
    parsed.lines.push({
      start: lineStart,
      duration: lineDuration,
      text,
      words,
      // 与原文相同（中文歌 / 本身即罗马音）就不重复展示
      ...(translation && translation !== text ? { translation } : {}),
      ...(transliteration && transliteration !== text && transliteration !== translation
        ? { transliteration }
        : {}),
    })
  }

  parsed.lines.sort((a, b) => a.start - b.start)
  parsed.lines = fillDurations(parsed.lines)
  return parsed
}

export function parseLyricText(text: string, format: LyricFormat): ParsedLyric {
  return format === 'krc' ? parseKrc(text) : parseLrc(text)
}

/** 二分查找当前行：返回最后一个 start <= time 的下标，早于首行返回 -1 */
export function findActiveIndex(lines: LyricLine[], timeMs: number): number {
  if (lines.length === 0) return -1
  if (timeMs < lines[0].start) return -1

  let low = 0
  let high = lines.length - 1
  let result = 0

  while (low <= high) {
    const mid = (low + high) >> 1
    if (lines[mid].start <= timeMs) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return result
}

/** 单个字的填充比例 0–1，用于逐字扫光 */
export function wordFill(word: LyricWord, timeMs: number): number {
  if (word.duration <= 0) return timeMs >= word.start ? 1 : 0
  return Math.min(1, Math.max(0, (timeMs - word.start) / word.duration))
}

/** 整行填充比例，LRC 模式下的渐进高亮 */
export function lineFill(line: LyricLine, timeMs: number): number {
  if (line.duration <= 0) return timeMs >= line.start ? 1 : 0
  return Math.min(1, Math.max(0, (timeMs - line.start) / line.duration))
}
