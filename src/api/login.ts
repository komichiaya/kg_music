/**
 * 登录接口（与上游 module/login_*.js 对齐，见文档 §3.1）
 *
 * 关键约束：
 * 1. 上游把酷狗的业务状态放在 **200 响应体内**（status / error_code / errcode），
 *    因此不能依赖 HTTP 状态码判定成败，必须逐接口解析。
 * 2. 上游对 GET 响应做了 2 分钟 apicache（见 server.js），扫码轮询与 refresh 必须带
 *    `timestamp` 让每次 URL 不同，否则会一直拿到缓存的旧状态。
 * 3. 扫码 status=4 时 token/userid 在 body.data 中；vip 字段往往缺失，
 *    需再走一次 /login/token 续期补齐（文档 §4.1.2）。
 */
import { ApiError, apiGet, apiPost } from './request'
import type { KugouCredential } from '@/types/kugou'

/** 上游统一响应壳 */
export interface KugouBody<T> {
  status?: number
  error_code?: number
  errcode?: number
  data?: T
  msg?: string
  message?: string
  error?: string
  /** 酷狗部分接口用 error_msg 承载文案（如 /youth/*） */
  error_msg?: string
  /** 部分内容接口用 errmsg */
  errmsg?: string
}

/** 扫码二维码 */
export interface QrTicket {
  key: string
  /** DataURL，可直接放进 <img src> */
  image: string
}

/** 扫码轮询结果：0 过期 / 1 等待 / 2 已扫描待确认 / 3·4 授权成功 */
export interface QrCheckResult {
  status: number
  credential: KugouCredential | null
}

const AUTH_HINT = /(token|票据|登录|登陆|失效|过期|未登录|重新登录)/i

/** 酷狗业务错误码：20017 = token 失效/未登录 */
const AUTH_ERROR_CODES = new Set([20017])

function messageOf(body: KugouBody<unknown> | undefined, fallback: string): string {
  const message = body?.error || body?.msg || body?.message
  if (typeof message === 'string' && message.trim()) return message.trim()
  const code = body?.error_code ?? body?.errcode
  return code ? `${fallback}（错误码 ${code}）` : fallback
}

function failure(body: KugouBody<unknown> | undefined, fallback: string): ApiError {
  const message = messageOf(body, fallback)
  const code = body?.error_code ?? body?.errcode
  // 上游失败时常常只回状态码、不回文案，必须靠 20017 判定登录失效，
  // 否则有效凭证会被一直当成「临时失败」而永远不清理。
  const invalid = (typeof code === 'number' && AUTH_ERROR_CODES.has(code)) || AUTH_HINT.test(message)
  return new ApiError(message, {
    code: invalid ? 'AUTH_INVALID' : 'LOGIN_FAILED',
    payload: body,
  })
}

/** 从登录响应中收敛凭证；字段不全（缺 token / userid 为 0）视为无效 */
export function toCredential(data: Record<string, unknown> | undefined): KugouCredential | null {
  if (!data) return null
  const token = typeof data.token === 'string' ? data.token : ''
  const rawUserid = data.userid !== undefined && data.userid !== null ? String(data.userid) : ''
  if (!token || !rawUserid || rawUserid === '0') return null

  return {
    token,
    userid: rawUserid,
    vip_type: Number(data.vip_type ?? 0) || 0,
    vip_token: typeof data.vip_token === 'string' ? data.vip_token : '',
    t1: typeof data.t1 === 'string' && data.t1 ? data.t1 : undefined,
  }
}

/**
 * 生成扫码二维码。
 *
 * /login/qr/key 已经带回 qrcode_img，但仍调用 /login/qr/create 取标准 DataURL，
 * 万一 create 失败再回退到 key 接口自带的图片，保证扫码入口不会整体不可用。
 */
export async function createQrTicket(): Promise<QrTicket> {
  const keyBody = await apiGet<KugouBody<{ qrcode?: string; qrcode_img?: string }>>('/login/qr/key', {
    type: 'web',
    timestamp: Date.now(),
  })

  const key = keyBody?.data?.qrcode
  if (!key) throw failure(keyBody, '获取二维码标识失败')

  const createBody = await apiGet<KugouBody<{ url?: string; base64?: string }>>('/login/qr/create', {
    key,
    qrimg: 'true',
    timestamp: Date.now(),
  })

  const image = createBody?.data?.base64 || keyBody?.data?.qrcode_img || ''
  if (!image) {
    throw new ApiError('二维码图片生成失败，请刷新重试', { code: 'QR_CREATE_FAILED', payload: createBody })
  }

  return { key, image }
}

/** 轮询扫码状态；status=4 时返回可由调用方直接持久化的凭证 */
export async function checkQrStatus(key: string): Promise<QrCheckResult> {
  const body = await apiGet<
    KugouBody<Record<string, unknown> & { status?: number }>
  >('/login/qr/check', { key, timestamp: Date.now() })

  if (body?.status !== undefined && body.status !== 1) {
    // 上游自身失败（非酷狗业务状态），交给调用方决定是否继续轮询
    throw failure(body, '扫码状态查询失败')
  }

  const status = Number(body?.data?.status ?? -1)
  if (status === 4) {
    return { status, credential: toCredential(body?.data) }
  }
  return { status, credential: null }
}

/** 手机号 + 验证码登录（验证码由用户在酷狗官方端获取，上游不下发） */
export async function loginByCellphone(mobile: string, code: string): Promise<KugouCredential> {
  const body = await apiPost<KugouBody<Record<string, unknown>>>('/login/cellphone', {
    mobile,
    code,
    timestamp: Date.now(),
  })

  const credential = toCredential(body?.data)
  if (body?.status === 1 && credential) return credential
  throw failure(body, '手机号登录失败')
}

/** 账号 / 邮箱 + 密码登录 */
export async function loginByPassword(
  username: string,
  password: string,
  code?: string
): Promise<KugouCredential> {
  const body = await apiPost<KugouBody<Record<string, unknown>>>('/login', {
    username,
    password,
    ...(code ? { code } : {}),
    timestamp: Date.now(),
  })

  const credential = toCredential(body?.data)
  if (body?.status === 1 && credential) return credential
  throw failure(body, '账号密码登录失败')
}

/**
 * token 续期。
 *
 * 返回合并后的凭证：续期响应可能只回 t1/vip 字段，保留旧 token 以免把有效凭证冲掉。
 * status !== 1 时按错误抛出，由 auth store 判断是「失效」还是「临时失败」。
 */
export async function refreshLoginToken(credential: KugouCredential): Promise<KugouCredential> {
  const body = await apiPost<KugouBody<Record<string, unknown>>>('/login/token', {
    token: credential.token,
    userid: credential.userid,
    timestamp: Date.now(),
  })

  if (body?.status !== 1) throw failure(body, '登录态校验失败')

  const refreshed = toCredential(body?.data)
  if (!refreshed) return credential

  return {
    ...credential,
    ...refreshed,
    // 续期响应缺失的字段用旧值兜底，避免 VIP 标识被清空
    vip_type: refreshed.vip_type || credential.vip_type,
    vip_token: refreshed.vip_token || credential.vip_token,
    t1: refreshed.t1 ?? credential.t1,
  }
}
