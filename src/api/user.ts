/**
 * 用户接口（文档 §3.5）
 *
 * /user/info 的字段在不同客户端版本间命名不一致（nickname / nick_name、pic / user_pic ...），
 * 这里做一次归一化，视图层只依赖 UserProfile。
 */
import { ApiError, apiGet, apiPost } from './request'
import type { KugouBody } from './login'
import type { GradeInfo, UserProfile, VipInfo } from '@/types/kugou'

function pickString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/** 到期时间：非会员时上游会给 "0" / 空串，统一收敛成 null，避免被渲染成 1970 年 */
function pickDateString(data: Record<string, unknown>, keys: string[]): string | null {
  const text = pickString(data, keys)
  return text && text !== '0' ? text : null
}

function pickNumber(data: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

/** 等级有时藏在 p_grade / grade 这类嵌套对象里 */
function pickNestedLevel(data: Record<string, unknown>): number | null {
  for (const key of ['p_grade', 'grade', 'vip_grade']) {
    const nested = data[key]
    if (nested && typeof nested === 'object') {
      const level = pickNumber(nested as Record<string, unknown>, ['level', 'grade', 'lvl'])
      if (level !== null) return level
    }
  }
  return null
}

export function normalizeProfile(data: Record<string, unknown>): UserProfile {
  return {
    userid: String(data.userid ?? data.user_id ?? ''),
    nickname:
      pickString(data, ['nickname', 'nick_name', 'username', 'nick', 'name']) ?? '酷狗用户',
    avatar: pickString(data, ['pic', 'user_pic', 'avatar', 'img', 'headimg']),
    vipType: pickNumber(data, ['vip_type', 'vipType', 'is_vip']) ?? 0,
    level: pickNumber(data, ['level', 'grade', 'user_level']) ?? pickNestedLevel(data),
    mobile: pickString(data, ['mobile', 'phone']),
  }
}

/** 拉取当前登录账号资料；失败由调用方决定是否降级 */
export async function fetchUserProfile(): Promise<UserProfile> {
  const body = await apiPost<KugouBody<Record<string, unknown>>>(
    '/user/info',
    { timestamp: Date.now() },
    { timeout: 10_000 }
  )

  if (body?.status !== 1 || !body.data) {
    const payloadCode = body?.error_code ?? body?.errcode
    const message =
      body?.error || body?.msg || body?.message || `获取用户资料失败（错误码 ${payloadCode ?? '未知'}）`
    // 20017 = token 失效，交由 auth store 清理凭证
    const invalid = payloadCode === 20017 || /(token|登录|失效|过期)/i.test(message)
    throw new ApiError(message, {
      code: invalid ? 'AUTH_INVALID' : 'PROFILE_FAILED',
      payload: body,
    })
  }

  return normalizeProfile(body.data)
}

/** 等级响应归一化：查询接口与上报响应的 grade 子结构同构，共用一份解析 */
export function normalizeGrade(data: Record<string, unknown>): GradeInfo {
  return {
    level: pickNumber(data, ['p_grade', 'grade']) ?? 0,
    points: pickNumber(data, ['p_current_point', 'point']) ?? 0,
    nextLevelPoints: pickNumber(data, ['p_next_grade_point']) ?? 0,
    finishPercent: pickNumber(data, ['finish_percent']) ?? 0,
    totalSeconds: pickNumber(data, ['d_sec', 'duration']) ?? 0,
  }
}

/** 听歌等级（查询模式，无 d_sec 上报） */
export async function fetchGradeInfo(): Promise<GradeInfo> {
  const body = await apiPost<KugouBody<Record<string, unknown>>>(
    '/user/grade/info',
    { timestamp: Date.now() },
    { timeout: 15_000 }
  )

  if (body?.status !== 1 || !body.data) {
    const message = body?.error_msg || body?.error || '听歌等级获取失败'
    throw new ApiError(message, {
      code: /(token|登录|失效|过期)/i.test(message) ? 'AUTH_INVALID' : 'GRADE_FAILED',
      payload: body,
    })
  }

  return normalizeGrade(body.data)
}

/** 会员详情；`vip_end_time` 可能为空字符串 */
export async function fetchVipDetail(): Promise<VipInfo> {
  const body = await apiGet<KugouBody<Record<string, unknown>>>(
    '/user/vip/detail',
    { timestamp: Date.now() },
    { timeout: 15_000 }
  )

  if (body?.status !== 1 || !body.data) {
    const message = body?.error_msg || body?.error || '会员信息获取失败'
    throw new ApiError(message, {
      code: /(token|登录|失效|过期)/i.test(message) ? 'AUTH_INVALID' : 'VIP_DETAIL_FAILED',
      payload: body,
    })
  }

  const data = body.data
  const vipType = pickNumber(data, ['vip_type']) ?? 0
  const isVip = (pickNumber(data, ['is_vip']) ?? 0) > 0 || vipType > 0

  return {
    isVip,
    vipType,
    expireAt: pickDateString(data, ['vip_end_time', 'vip_y_endtime']),
  }
}
