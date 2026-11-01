/**
 * 检查更新（Main 进程）
 *
 * 为什么不引 electron-updater：
 *   1. 它要求配置 publish 源并产出 latest.yml，本仓库目前没有发布通道，
 *      装了也只能在「未配置」状态下报错，反而多 3MB 依赖与一条自动下载链路。
 *   2. 自动下载安装包涉及签名/完整性校验，做不到位就不该做——静默替换可执行文件
 *      比「提示有新版本、让用户自己去下载」风险高得多。
 * 因此这里只做「读一个 JSON 清单 → 比较版本 → 给下载页链接」，安装交给系统浏览器。
 * 清单也可以是 electron-builder 直接产出的 `latest.yml`（见下方 parseLatestYml）。
 *
 * 清单格式（放任意 https 静态地址即可）：
 *   { "version": "1.2.0", "notes": "更新说明", "pub_date": "2026-10-23", "url": "https://.../setup.exe" }
 *
 * 同时也认 electron-builder 直接产出的 `latest.yml`（release/<version>/latest.yml）：
 * 那是 YAML，但结构极简（顶层 key: value + files 列表），这里用逐行解析取
 * version / releaseDate / path，避免为了一个字段引入 YAML 依赖。
 * 下载地址缺失时按「清单地址同目录 + path」拼出来，正是发布目录的自然布局。
 */
import { app, net } from 'electron'
import type { UpdateCheckResult } from '../../src/types/kugou'

/** 更新清单地址；未配置时设置页显示「未配置更新源」而不是「已是最新」 */
const DEFAULT_FEED_URL = ''
const FEED_TIMEOUT_MS = 8_000

interface FeedPayload {
  version?: unknown
  notes?: unknown
  pub_date?: unknown
  releaseDate?: unknown
  url?: unknown
  path?: unknown
  files?: unknown
}

function feedUrl() {
  const fromEnv = process.env.KUGOU_UPDATE_FEED
  if (typeof fromEnv === 'string' && /^https?:\/\//i.test(fromEnv.trim())) return fromEnv.trim()
  return DEFAULT_FEED_URL || null
}

/** 取 major.minor.patch 数字段，忽略预发布后缀（1.2.0-beta.1 → [1,2,0]） */
function versionParts(raw: string): number[] {
  const core = raw.trim().replace(/^v/i, '').split('-')[0] ?? ''
  const parts = core.split('.').map((piece) => Number.parseInt(piece, 10))
  while (parts.length < 3) parts.push(0)
  return parts.map((value) => (Number.isFinite(value) ? value : 0))
}

/** 返回 >0 表示 left 更新，<0 表示 right 更新，0 相等 */
function compareVersion(left: string, right: string) {
  const a = versionParts(left)
  const b = versionParts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function baseResult(phase: UpdateCheckResult['phase']): UpdateCheckResult {
  return {
    phase,
    currentVersion: app.getVersion(),
    latestVersion: null,
    releaseNotes: null,
    releaseDate: null,
    downloadUrl: null,
    message: null,
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * 极简 YAML 解析（只覆盖 electron-builder 的 latest.yml 形态）
 *
 * 只取顶层 `key: value` 与 `files:` 下第一项的 `url:`，其余行忽略。
 * 用「是否缩进」判断层级而不是维护状态机：顶层键无缩进，列表项必然有缩进。
 * 不为一个字段引入 YAML 依赖——目标格式固定，逐行判断更不容易出错。
 */
function parseLatestYml(raw: string): FeedPayload {
  const result: FeedPayload = {}

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // 缩进行 = files 列表项（唯一嵌套结构），只在还没拿到 url 时取第一个
    if (/^\s/.test(line)) {
      if (result.url === undefined) {
        const nested = /^-?\s*url:\s*(.*)$/.exec(trimmed)
        if (nested) result.url = nested[1].replace(/^['"]|['"]$/g, '')
      }
      continue
    }

    const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(trimmed)
    if (!top) continue
    const [, key, value] = top
    const clean = value.replace(/^['"]|['"]$/g, '')
    if (!clean) continue

    if (key === 'version') result.version = clean
    else if (key === 'releaseDate') result.releaseDate = clean
    else if (key === 'path') result.path = clean
    else if (key === 'url') result.url = clean
  }

  return result
}

/** 清单地址所在目录，用于把 `path` 拼成绝对下载地址 */
function feedDir(url: string): string | null {
  try {
    const parsed = new URL(url)
    const slash = parsed.pathname.lastIndexOf('/')
    parsed.pathname = parsed.pathname.slice(0, slash + 1)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return null
  }
}

/**
 * 拉取清单
 *
 * 用 Electron 的 net 而不是 Node fetch：net 走 Chromium 的网络栈，
 * 系统代理/证书设置与用户预期一致（Node 的 fetch 不读系统代理）。
 */
async function fetchFeed(url: string): Promise<FeedPayload> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS)

  try {
    const response = await net.fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json, text/yaml, text/plain, */*' },
      // 清单必须实时，避免被中间层缓存住导致永远看到旧版本
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`更新清单返回 HTTP ${response.status}`)
    }

    const raw = await response.text()
    // 清单可能被 Windows 记事本 / 某些编辑器存成带 BOM 的 UTF-8：
    // BOM 会让 JSON.parse 直接失败、也让首行的 key 匹配不上，这里统一先剥掉。
    const clean = raw.replace(/^\uFEFF/, '')

    // 先按 JSON 解，失败再按 latest.yml（YAML）解：两种格式都允许
    try {
      return JSON.parse(clean) as FeedPayload
    } catch {
      return parseLatestYml(clean)
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 把清单里的下载地址规范成绝对地址
 *
 * `latest.yml` 里的 `url` / `path` 是**相对安装包所在目录**的文件名
 * （如 `KugouConcept-Windows-1.0.0-Setup.exe`），直接拿去 openExternal 会失败。
 * 因此非 http(s) 的一律按清单地址所在目录拼绝对地址。
 */
function resolveDownloadUrl(raw: string | null, feed: string): string | null {
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  const dir = feedDir(feed)
  return dir ? `${dir}${raw.replace(/^\.?\//, '')}` : null
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const url = feedUrl()
  if (!url) {
    return {
      ...baseResult('unconfigured'),
      message: '当前版本未配置更新源，无法在线检查。可前往项目主页获取新版本。',
    }
  }

  try {
    const payload = await fetchFeed(url)
    const latest = text(payload.version)
    if (!latest) {
      return { ...baseResult('error'), message: '更新清单缺少 version 字段' }
    }

    // 下载地址优先级：显式 url > path > files[0].url，统一规范成绝对地址
    const firstFile = Array.isArray(payload.files)
      ? (payload.files[0] as { url?: unknown } | undefined)
      : undefined
    const downloadUrl =
      resolveDownloadUrl(text(payload.url), url) ??
      resolveDownloadUrl(text(payload.path), url) ??
      resolveDownloadUrl(text(firstFile?.url), url)

    const result: UpdateCheckResult = {
      ...baseResult('idle'),
      latestVersion: latest,
      releaseNotes: text(payload.notes),
      releaseDate: text(payload.pub_date) ?? text(payload.releaseDate),
      downloadUrl,
    }

    if (compareVersion(latest, app.getVersion()) <= 0) {
      return { ...result, phase: 'latest' }
    }

    return { ...result, phase: 'available' }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    const message = aborted
      ? '检查更新超时，请稍后重试'
      : `检查更新失败：${error instanceof Error ? error.message : String(error)}`
    console.warn('[updater]', message)
    return { ...baseResult('error'), message }
  }
}
