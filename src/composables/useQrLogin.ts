/**
 * 扫码登录状态机（文档 §4.1.2）
 *
 * 流程：/login/qr/key → /login/qr/create → 每 2s 轮询 /login/qr/check
 * - TTL 180s，倒计时归零即判定过期，需手动刷新
 * - 轮询带并发保护：上一次请求未返回时跳过本轮，避免弱网下请求堆积
 * - 连续 3 次网络失败才进入错误态，偶发抖动不打断扫码
 * - 组件卸载（onScopeDispose）或切 Tab 时立即停止轮询
 */
import { computed, onScopeDispose, ref } from 'vue'
import { checkQrStatus, createQrTicket } from '@/api/login'
import type { KugouCredential, QrPhase } from '@/types/kugou'

const POLL_INTERVAL_MS = 2_000
const TTL_MS = 180_000
const MAX_CONSECUTIVE_FAILURES = 3

interface QrLoginOptions {
  onSuccess: (credential: KugouCredential) => void | Promise<void>
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '网络异常，请稍后重试'
}

export function useQrLogin(options: QrLoginOptions) {
  const phase = ref<QrPhase>('idle')
  const image = ref('')
  const message = ref('')
  const error = ref<string | null>(null)
  const remaining = ref(0)

  let key = ''
  let deadline = 0
  let pollTimer: number | null = null
  let tickTimer: number | null = null
  let inFlight = false
  let failures = 0
  let stopped = true
  let disposed = false

  const active = computed(() => phase.value === 'waiting' || phase.value === 'scanned')

  function clearTimers() {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer)
      pollTimer = null
    }
    if (tickTimer !== null) {
      window.clearInterval(tickTimer)
      tickTimer = null
    }
  }

  function stop() {
    stopped = true
    clearTimers()
  }

  function expire() {
    stop()
    phase.value = 'expired'
    remaining.value = 0
    message.value = '二维码已过期'
  }

  function startTimers() {
    clearTimers()

    tickTimer = window.setInterval(() => {
      remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      if (remaining.value === 0) expire()
    }, 1_000)

    pollTimer = window.setInterval(() => {
      void poll()
    }, POLL_INTERVAL_MS)
  }

  async function poll() {
    if (stopped || inFlight) return
    if (Date.now() > deadline) {
      expire()
      return
    }

    inFlight = true
    try {
      const result = await checkQrStatus(key)
      failures = 0

      if (result.status === 0) {
        expire()
        return
      }

      if (result.status === 2) {
        phase.value = 'scanned'
        message.value = '已扫码，请在手机上确认登录'
        return
      }

      if (result.status === 3) {
        phase.value = 'confirmed'
        message.value = '已确认，正在完成登录…'
        return
      }

      if (result.status === 4) {
        if (!result.credential) {
          // 已授权但未带回 token：上游异常，继续轮询只会白等到 TTL
          stop()
          phase.value = 'error'
          error.value = '授权成功但未获取到登录凭证，请刷新二维码重试'
          return
        }
        phase.value = 'confirmed'
        message.value = '登录成功，正在同步账号…'
        stop()
        await options.onSuccess(result.credential)
        return
      }

      // status=1 或未知状态：保持等待
      if (phase.value !== 'scanned') {
        phase.value = 'waiting'
        message.value = '请使用酷狗 App 扫码登录'
      }
    } catch (err) {
      failures += 1
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        stop()
        phase.value = 'error'
        error.value = errorMessage(err)
      }
    } finally {
      inFlight = false
    }
  }

  async function start() {
    if (disposed) return
    stop()
    stopped = false
    phase.value = 'loading'
    error.value = null
    message.value = '正在生成二维码…'
    image.value = ''
    remaining.value = Math.ceil(TTL_MS / 1000)

    try {
      const ticket = await createQrTicket()
      key = ticket.key
      image.value = ticket.image
      deadline = Date.now() + TTL_MS
      failures = 0
      phase.value = 'waiting'
      message.value = '请使用酷狗 App 扫码登录'
      startTimers()
    } catch (err) {
      stopped = true
      phase.value = 'error'
      error.value = errorMessage(err)
      message.value = '二维码获取失败'
    }
  }

  function refresh() {
    void start()
  }

  onScopeDispose(() => {
    disposed = true
    stop()
  })

  return { phase, image, message, error, remaining, active, start, refresh, stop }
}
