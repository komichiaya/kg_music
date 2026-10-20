/**
 * HTTP 请求封装
 *
 * 约定（文档 §2.2 / §7.4 / §7.5）：
 * - baseURL 由 Main 注入：启动时调用 setApiBase(appInfo.apiBase)，缺省回退 VITE_API_BASE。
 * - 鉴权统一走 Authorization 头，内容为 `token=xxx;userid=xxx;vip_token=xxx`。
 *   由 auth store 在凭证变化时写入快照，避免 api 层反向依赖 Pinia。
 * - **必须 proxy: false**：axios 默认继承 HTTP_PROXY/HTTPS_PROXY，会让本地请求走系统代理，
 *   调酷狗服务时表现为 socket hang up。
 * - 上游把错误也放在 200 响应体里（status/errcode），业务判定交给各 api 模块，
 *   这里只统一网络层异常与 401。
 */
import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios'

const DEFAULT_BASE = 'http://127.0.0.1:3000'

function normalizeBase(raw: string): string {
  return raw.replace(/\/+$/, '')
}

let apiBase = normalizeBase(import.meta.env.VITE_API_BASE || DEFAULT_BASE)

/** 鉴权头快照：由 auth store 维护 */
let authHeader: string | null = null

/** 401 回调：token 失效时由 auth store 清凭证并跳转登录 */
let unauthorizedHandler: (() => void) | null = null

export function setApiBase(base: string) {
  if (!base) return
  apiBase = normalizeBase(base)
  http.defaults.baseURL = apiBase
}

export function getApiBase(): string {
  return apiBase
}

export function setAuthToken(value: string | null) {
  authHeader = value && value.length > 0 ? value : null
}

export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string | number | null
  readonly payload: unknown

  constructor(
    message: string,
    options: { status?: number; code?: string | number | null; payload?: unknown } = {}
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status ?? 0
    this.code = options.code ?? null
    this.payload = options.payload
  }
}

export const http: AxiosInstance = axios.create({
  baseURL: apiBase,
  timeout: 15_000,
  // 关闭 axios 的代理继承，详见文件头说明
  proxy: false,
  headers: {
    'Content-Type': 'application/json',
  },
})

http.interceptors.request.use((config) => {
  if (authHeader) {
    config.headers.set('Authorization', authHeader)
  }
  return config
})

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => Promise.reject(toApiError(error))
)

function toApiError(error: AxiosError): ApiError {
  const response = error.response
  if (response) {
    if (response.status === 401 && unauthorizedHandler) unauthorizedHandler()

    const body = response.data as Record<string, unknown> | undefined
    const rawCode = body?.error_code ?? body?.errcode ?? body?.code
    const upstreamCode =
      typeof rawCode === 'number' || typeof rawCode === 'string' ? rawCode : undefined

    // 酷狗的失败响应常常只有状态码没有文案（例如 token 失效返回 502 + error_code 20017），
    // 这里把错误码透出到 message 与 ApiError.code，供上层判定失效/降级。
    const message =
      (typeof body?.msg === 'string' && body.msg) ||
      (typeof body?.message === 'string' && body.message) ||
      (typeof body?.error === 'string' && body.error) ||
      (typeof body?.error_msg === 'string' && body.error_msg) ||
      (upstreamCode !== undefined
        ? `请求失败（错误码 ${upstreamCode}）`
        : `请求失败（HTTP ${response.status}）`)

    return new ApiError(message, {
      status: response.status,
      code: upstreamCode ?? response.status,
      payload: response.data,
    })
  }

  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return new ApiError('请求超时，请检查本地服务是否响应缓慢', { code: error.code })
  }

  // 本地服务未起来时最常见的一类：ECONNREFUSED / ERR_NETWORK
  if (error.code === 'ERR_NETWORK' || error.code === 'ECONNREFUSED') {
    return new ApiError('无法连接本地服务，请确认 KuGouMusicApi 已启动', {
      code: error.code,
      payload: { baseURL: apiBase },
    })
  }

  return new ApiError(error.message || '未知网络错误', { code: error.code ?? null })
}

export async function apiGet<T>(
  url: string,
  params?: Record<string, unknown>,
  config?: AxiosRequestConfig
): Promise<T> {
  const response = await http.get<T>(url, { ...config, params })
  return response.data
}

export async function apiPost<T>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<T> {
  const response = await http.post<T>(url, data, config)
  return response.data
}
