/**
 * 封面主色提取（文档 §5.4）
 *
 * 极光背景需要随当前曲目变色。酷狗图片 CDN 返回 `Access-Control-Allow-Origin: *`，
 * 因此可以在渲染层用 canvas 取样；一旦某个源没有 CORS 头、图片加载失败或超时，
 * 就退化为「按封面 URL 哈希生成的稳定色」，保证每首歌仍有可区分的色调，
 * 而不是所有封面都套同一套品牌色。
 */

export interface CoverPalette {
  primary: string
  secondary: string
  accent: string
}

const BRAND_PALETTE: CoverPalette = {
  primary: '#2d7ff9',
  secondary: '#2ce6e6',
  accent: '#7c5cff',
}

/** 取色尺寸：24×24 足够做直方图，且几乎不占主线程 */
const SAMPLE_SIZE = 24
const LOAD_TIMEOUT = 5_000
const CACHE_LIMIT = 80
const paletteCache = new Map<string, CoverPalette>()

interface Hsl {
  h: number
  s: number
  l: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  const l = (max + min) / 2

  if (delta === 0) return { h: 0, s: 0, l }

  const s = delta / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / delta) % 6
  else if (max === gn) h = (bn - rn) / delta + 2
  else h = (rn - gn) / delta + 4

  return { h: (h * 60 + 360) % 360, s, l }
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round((h + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`
}

/** 统一压到深色背景上仍然「有颜色但不刺眼」的范围 */
function tone(color: Hsl, overrides: Partial<Pick<Hsl, 's' | 'l'>> = {}): string {
  return hsl(
    color.h,
    clamp(overrides.s ?? Math.max(color.s, 0.55), 0.42, 0.92),
    clamp(overrides.l ?? color.l, 0.44, 0.62)
  )
}

/** 无 CORS / 加载失败时的确定性回退：同一封面每次得到同一组颜色 */
export function fallbackPalette(seed: string): CoverPalette {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360000
  }
  const h1 = hash % 360
  const h2 = (h1 + 46 + (hash % 37)) % 360
  const h3 = (h1 + 208) % 360
  return {
    primary: hsl(h1, 0.66, 0.56),
    secondary: hsl(h2, 0.6, 0.52),
    accent: hsl(h3, 0.5, 0.5),
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.referrerPolicy = 'no-referrer'
    const timer = window.setTimeout(() => reject(new Error('cover timeout')), LOAD_TIMEOUT)
    image.onload = () => {
      window.clearTimeout(timer)
      resolve(image)
    }
    image.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error('cover load failed'))
    }
    image.src = url
  })
}

interface Bucket {
  r: number
  g: number
  b: number
  score: number
}

/** 4bit/通道直方图，按「像素数 × 饱和度」打分，跳过近黑/近白与低饱和灰 */
function quantize(image: HTMLImageElement): CoverPalette | null {
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  const buckets = new Map<number, Bucket>()

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 160) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const { s, l } = rgbToHsl(r, g, b)
    if (l < 0.12 || l > 0.92) continue
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key)
    const weight = 0.35 + s
    if (bucket) {
      bucket.score += weight
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else {
      buckets.set(key, { r, g, b, score: weight })
    }
  }

  if (buckets.size === 0) return null

  const sorted = [...buckets.values()].sort((a, b) => b.score - a.score)
  const toHsl = (bucket: Bucket) => rgbToHsl(bucket.r, bucket.g, bucket.b)
  const primary = toHsl(sorted[0])

  let secondary: Hsl | null = null
  for (const bucket of sorted.slice(1)) {
    const candidate = toHsl(bucket)
    const distance = Math.abs(((candidate.h - primary.h + 540) % 360) - 180)
    if (distance > 38 && candidate.s > 0.2) {
      secondary = candidate
      break
    }
  }

  const accent = secondary ? { ...secondary, h: (secondary.h + 40) % 360 } : { ...primary, h: (primary.h + 190) % 360 }

  return {
    primary: tone(primary),
    secondary: secondary ? tone(secondary, { l: 0.5 }) : tone(primary, { l: 0.46 }),
    accent: tone(accent, { s: 0.5, l: 0.52 }),
  }
}

function remember(url: string, palette: CoverPalette): CoverPalette {
  if (paletteCache.size >= CACHE_LIMIT) {
    const oldest = paletteCache.keys().next().value
    if (oldest) paletteCache.delete(oldest)
  }
  paletteCache.set(url, palette)
  return palette
}

/** 提取封面主色；失败时返回稳定回退色，不会 reject */
export async function extractPalette(url: string | null | undefined): Promise<CoverPalette> {
  if (!url) return BRAND_PALETTE
  const cached = paletteCache.get(url)
  if (cached) return cached

  try {
    const image = await loadImage(url)
    const palette = quantize(image)
    return remember(url, palette ?? fallbackPalette(url))
  } catch {
    return remember(url, fallbackPalette(url))
  }
}

let appliedUrl: string | null = null

/** 把调色板写入 CSS 变量；同一封面重复调用不触发重绘 */
export function applyCoverPalette(cover: string | null | undefined, palette?: CoverPalette) {
  if (typeof document === 'undefined') return
  if (!palette && appliedUrl === (cover ?? null)) return
  appliedUrl = cover ?? null
  const next = palette ?? BRAND_PALETTE
  const root = document.documentElement
  root.style.setProperty('--cover-1', next.primary)
  root.style.setProperty('--cover-2', next.secondary)
  root.style.setProperty('--cover-3', next.accent)
}

export { BRAND_PALETTE }
