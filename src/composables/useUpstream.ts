/**
 * 上游服务状态（组合式）
 *
 * 状态在模块级别共享：任一组件首次调用时拉取一次并订阅 Main 的广播，
 * 之后所有调用方拿到同一份响应式状态。
 */
import { computed, ref } from 'vue'
import { getBridge } from '@/bridge'
import type { UpstreamState, UpstreamStatus } from '@/types/kugou'

const STATE_LABEL: Record<UpstreamState, string> = {
  idle: '服务待启动',
  starting: '服务启动中',
  running: '本地服务就绪',
  external: '外部服务就绪',
  failed: '服务未连接',
  stopped: '服务已停止',
}

const status = ref<UpstreamStatus | null>(null)
const restarting = ref(false)
let initialized = false

function init() {
  if (initialized) return
  initialized = true

  const bridge = getBridge()
  if (!bridge) return

  void bridge.upstream
    .status()
    .then((value) => {
      status.value = value
    })
    .catch((error) => console.warn('[upstream] 获取状态失败', error))

  bridge.upstream.onStatus((value) => {
    status.value = value
  })
}

export function useUpstream() {
  init()

  const state = computed<UpstreamState>(() => status.value?.state ?? 'idle')
  const healthy = computed(() => state.value === 'running' || state.value === 'external')
  const label = computed(() => STATE_LABEL[state.value])
  const tone = computed<'ok' | 'warn' | 'err' | 'muted'>(() => {
    if (healthy.value) return 'ok'
    if (state.value === 'failed' || state.value === 'stopped') return 'err'
    return 'warn'
  })
  const baseUrl = computed(() => status.value?.baseUrl ?? '—')
  const detail = computed(() => status.value?.lastError ?? null)

  async function restart() {
    const bridge = getBridge()
    if (!bridge || restarting.value) return
    restarting.value = true
    try {
      status.value = await bridge.upstream.restart()
    } catch (error) {
      console.warn('[upstream] 重启失败', error)
    } finally {
      restarting.value = false
    }
  }

  /** 按需拉取一次最新状态（日志等非状态字段不会主动广播） */
  async function refresh() {
    const bridge = getBridge()
    if (!bridge) return
    try {
      status.value = await bridge.upstream.status()
    } catch (error) {
      console.warn('[upstream] 刷新状态失败', error)
    }
  }

  return { status, state, healthy, label, tone, baseUrl, detail, restart, refresh, restarting }
}
