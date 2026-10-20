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

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '')
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

  for (const raw of stripBom(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    if (readMeta(line, parsed)) continue

    const lineMatch = KRC_LINE.exec(line)
    if (!lineMatch) continue

    const lineStart = Number(lineMatch[1])
    const lineDuration = Number(lineMatch[2])
    const body = lineMatch[3]

    const words: LyricWord[] = []
    KRC_WORD.lastIndex = 0
    let wordMatch: RegExpExecArray | null
    while ((wordMatch = KRC_WORD.exec(body)) !== null) {
      const wordText = wordMatch[3]
      if (!wordText) continue
      words.push({
        start: lineStart + Math.max(0, Number(wordMatch[1])),
        duration: Math.max(0, Number(wordMatch[2])),
        text: wordText,
      })
    }

    const plain = body.replace(KRC_WORD, '').trim()
    const text = words.length > 0 ? words.map((word) => word.text).join('').trim() : plain
    if (!text) continue

    parsed.lines.push({ start: lineStart, duration: lineDuration, text, words })
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
