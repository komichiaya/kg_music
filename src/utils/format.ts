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
