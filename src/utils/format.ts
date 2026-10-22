/** 展示层格式化工具 */

/** 秒 → m:ss（超过一小时显示 h:mm:ss） */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const total = Math.floor(seconds)
  const hour = Math.floor(total / 3600)
  const minute = Math.floor((total % 3600) / 60)
  const second = total % 60

  if (hour > 0) {
    return `${hour}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
  }
  return `${minute}:${String(second).padStart(2, '0')}`
}

/** 大数字缩写：1275149 → 127.5 万 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)} 亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万`
  return String(Math.round(value))
}

/** 早于这一年的日期一律视为「上游没给有效值」（0 / 空值会被 Date 解析成 1970） */
const MIN_VALID_YEAR = 1971

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function fromTimestamp(value: number): Date | null {
  if (!Number.isFinite(value) || value <= 0) return null
  // 上游有的给秒级、有的给毫秒级，10 位以内按秒处理
  return new Date(value > 1e12 ? value : value * 1000)
}

/**
 * 上游时间值 → 展示用日期。
 *
 * 同一个「VIP 到期时间」在不同接口里有四种形态：秒级时间戳、毫秒级时间戳、
 * `2026-10-22 12:00:00` 这样的字符串、以及非会员时的 0 / 空串。
 * 0 直接 `new Date(0)` 会得到 1970-01-01，必须当无效值丢掉，否则界面会显示
 * 「1970-01-01T00:00:00.000Z」这种对用户毫无意义的东西。
 *
 * 返回 `YYYY-MM-DD`；带时分且不是 00:00 时返回 `YYYY-MM-DD HH:mm`；无法识别返回 null。
 */
export function formatDateTime(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null

  let date: Date | null = null

  if (typeof value === 'number') {
    date = fromTimestamp(value)
  } else {
    const text = value.trim()
    if (!text || text === '0') return null
    if (/^\d{9,14}$/.test(text)) {
      date = fromTimestamp(Number(text))
    } else {
      // 纯日期必须按本地时区构造：`new Date('2026-10-22')` 会当成 UTC 零点，
      // 在东八区再取本地时分就成了 08:00，凭空空出一个时间。
      const dateOnly = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
      if (dateOnly) {
        const year = Number(dateOnly[1])
        const month = Number(dateOnly[2])
        const day = Number(dateOnly[3])
        const local = new Date(year, month - 1, day)
        if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day) {
          return null
        }
        return `${year}-${pad2(month)}-${pad2(day)}`
      }

      const parsed = new Date(text)
      date = Number.isNaN(parsed.getTime()) ? null : parsed
    }
  }

  if (!date || Number.isNaN(date.getTime())) return null
  if (date.getFullYear() < MIN_VALID_YEAR) return null

  const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  return time === '00:00' ? day : `${day} ${time}`
}
