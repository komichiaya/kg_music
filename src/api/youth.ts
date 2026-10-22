/**
 * 每日一天 VIP（文档 §4.3，上游 module/youth_day_vip.js）
 *
 * 重要：`receive_day` 是**日期字符串**（`YYYY-MM-DD`），不是「1 天」。
 * 传 `1` 会被酷狗拒绝（error_code 304001「日期格式错误」）——
 * 项目文档 §4.3.1 里写的 `receive_day=1` 与上游实现不符，以本文件为准。
 *
 * 典型返回：
 *   成功      status=1
 *   已领取    status=0 + 文案含「已领取」（按成功处理，避免重复领取）
 *   未登录    status=0 + error_code 51002 / 20002
 */
import { apiGet, apiPost, ApiError } from './request'
import type { KugouBody } from './login'

export interface DayVipOutcome {
  /** 本次是否真正发放（已领取时为 false） */
  granted: boolean
  /** 今天是否已领过（服务端幂等命中） */
  alreadyClaimed: boolean
  message: string
  /** VIP 到期时间，响应未提供时为 null */
  expireAt: string | null
}

/** 本地时区的 YYYY-MM-DD（酷狗按自然日结算） */
export function todayString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function messageOf(body: KugouBody<unknown> | undefined): string {
  const text = body?.error_msg || body?.msg || body?.message || body?.error
  return typeof text === 'string' ? text.trim() : ''
}

const ALREADY_CLAIMED = /(已领取|已领过|重复领取|今日已)/

/** 响应里的到期时间字段命名不统一，做一次宽松提取 */
function extractExpireAt(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const stack: Array<Record<string, unknown>> = [data as Record<string, unknown>]
  const keys = ['expire_at', 'expire_time', 'expire', 'end_time', 'endtime', 'vip_end_time', 'vip_expire']

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    for (const [key, value] of Object.entries(current)) {
      if (typeof value === 'object' && value !== null) {
        stack.push(value as Record<string, unknown>)
        continue
      }
      if (!keys.some((candidate) => key.toLowerCase().includes(candidate))) continue
      if (typeof value === 'string' && value.trim()) {
        // 非会员 / 领取失败时上游会给 "0"
        if (value.trim() === '0') continue
        return value.trim()
      }
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        // 秒级时间戳需要转毫秒；0 会被 Date 解析成 1970，直接跳过
        const ms = value > 1e12 ? value : value * 1000
        return new Date(ms).toISOString()
      }
    }
  }
  return null
}

/** 领取指定日期的一天 VIP */
export async function claimDayVip(receiveDay = todayString()): Promise<DayVipOutcome> {
  const body = await apiPost<KugouBody<Record<string, unknown>>>(
    '/youth/day/vip',
    { timestamp: Date.now() },
    { params: { receive_day: receiveDay }, timeout: 15_000 }
  )

  const message = messageOf(body)
  const code = body?.error_code ?? body?.errcode

  if (body?.status === 1) {
    return {
      granted: true,
      alreadyClaimed: false,
      message: message || '已领取一天 VIP',
      expireAt: extractExpireAt(body?.data),
    }
  }

  if (ALREADY_CLAIMED.test(message)) {
    return {
      granted: false,
      alreadyClaimed: true,
      message: message || '今日已领取一天 VIP',
      expireAt: extractExpireAt(body?.data),
    }
  }

  // 20002/51002 = 未登录或登录态失效，交由上层决定是否跳登录
  const authIssue = code === 20002 || code === 51002
  throw new ApiError(message || `领取失败（错误码 ${code ?? '未知'}）`, {
    code: authIssue ? 'AUTH_INVALID' : 'VIP_CLAIM_FAILED',
    payload: body,
  })
}

/**
 * 核对服务端本月领取记录，作为本地 lastClaimDate 之外的第二个幂等键。
 * 查询失败一律返回 null（不阻断领取流程）。
 */
export async function hasClaimedOn(date: string): Promise<boolean | null> {
  try {
    const body = await apiGet<KugouBody<unknown>>('/youth/month/vip/record', {
      latest_limit: 100,
      timestamp: Date.now(),
    })
    if (body?.status !== 1) return null
    // 返回结构随活动版本变化，这里只做「今日日期是否出现在记录里」的宽松判断
    return JSON.stringify(body.data ?? '').includes(date)
  } catch {
    return null
  }
}
