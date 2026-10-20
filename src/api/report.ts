/**
 * 听歌上报（文档 §4.3.1 / §3.5）
 *
 * `/user/listen/report` 由上游完成 CSCC 的会话握手与加密上报，结束时可用
 * `d_sec` + `diff_sec` 联动 `/user/grade/info` 同步累计时长。
 *
 * 注意：
 * - `timestamp` 必须放在 URL query（上游按 URL 做 2 分钟 apicache，放 body 绕不过去）。
 * - 结束事件不自动重试：超时也可能已记账，重发会导致时长重复累计。
 * - 设备标识（uuid/mid）必须与 start/end 一致，否则上游会重建会话。
 */
import { ApiError, apiPost } from './request'
import { normalizeGrade } from './user'
import { getDeviceIdentity } from '@/utils/device'
import type { GradeInfo } from '@/types/kugou'

interface ReportBody {
  status?: number
  errcode?: number
  error_code?: number
  msg?: string | { message?: string }
  message?: string
  error_msg?: string
  data?: {
    playback_accepted?: boolean
    grade_synced?: boolean
    grade?: {
      status?: number
      errcode?: number
      error_code?: number
      data?: Record<string, unknown>
    }
  }
}

export interface PlaybackReportResult {
  playbackAccepted: boolean
  gradeSynced: boolean
  grade: GradeInfo | null
  message: string | null
}

const REPORT_TIMEOUT = 30_000

function messageOf(body: ReportBody | undefined, fallback: string): string {
  if (!body) return fallback
  for (const value of [body.msg, body.message, body.error_msg]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (value && typeof value === 'object' && typeof value.message === 'string' && value.message.trim()) {
      return value.message.trim()
    }
  }
  const code = body.error_code ?? body.errcode
  return code ? `${fallback}（错误码 ${code}）` : fallback
}

/** CSCC 的 start 响应只有 `{status:1, errcode:0}`，没有 data 包一层 */
function isAccepted(body: ReportBody | undefined): boolean {
  if (!body) return false
  if (body.status === 1) return true
  return body.errcode === 0 || body.error_code === 0
}

function devicePayload() {
  const device = getDeviceIdentity()
  return {
    uuid: device.uuid,
    mid: device.mid,
    device_model: device.deviceModel,
    system_version: device.systemVersion,
    screen_width: device.screenWidth,
    screen_height: device.screenHeight,
    local_ip: device.localIp,
  }
}

/** 播放开始事件：建立 CSCC 会话并记录一次播放 */
export async function reportPlayStart(mixsongid: string): Promise<void> {
  const body = await apiPost<ReportBody>(
    '/user/listen/report',
    { event: 'start', mixsongid, ...devicePayload() },
    { params: { timestamp: Date.now() }, timeout: REPORT_TIMEOUT }
  )

  if (!isAccepted(body)) {
    throw new ApiError(messageOf(body, '播放开始上报失败'), {
      code: 'REPORT_FAILED',
      payload: body,
    })
  }
}

/**
 * 播放结束事件。传入 `dSec` / `diffSec` 时联动等级同步。
 * @param durationMs 实际播放毫秒数（扣除暂停与拖动）
 */
export async function reportPlayEnd(input: {
  mixsongid: string
  durationMs: number
  state?: string
  dSec?: number
  diffSec?: number
}): Promise<PlaybackReportResult> {
  const sync = input.dSec !== undefined && input.diffSec !== undefined
  const body = await apiPost<ReportBody>(
    '/user/listen/report',
    {
      event: 'end',
      mixsongid: input.mixsongid,
      duration: Math.max(0, Math.round(input.durationMs)),
      state: input.state ?? '完整播放',
      ...(sync ? { d_sec: Math.max(0, Math.round(input.dSec as number)), diff_sec: Math.max(0, Math.round(input.diffSec as number)) } : {}),
      ...devicePayload(),
    },
    { params: { timestamp: Date.now() }, timeout: REPORT_TIMEOUT }
  )

  const data = body?.data
  const playbackAccepted = data?.playback_accepted ?? isAccepted(body)
  const gradeSynced = data?.grade_synced === true
  const gradeData = data?.grade?.data

  if (!playbackAccepted && !gradeSynced) {
    throw new ApiError(messageOf(body, '播放结束上报失败'), {
      code: 'REPORT_FAILED',
      payload: body,
    })
  }

  return {
    playbackAccepted,
    gradeSynced,
    grade: gradeData ? normalizeGrade(gradeData) : null,
    message: messageOf(body, '') || null,
  }
}
