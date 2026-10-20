/**
 * 每日一天 VIP 状态（文档 §4.3）
 *
 * 触发时机：
 * 1. 登录成功 → auth.completeLogin() 落盘与补水完成后自动领取
 * 2. 冷启动已登录 → auth.hydrate() 会话校验通过后自动领取
 *
 * 幂等（双键）：
 * - 本地 lastClaimDate（按 userid 分开存 localStorage），同日不重复请求
 * - 服务端 /youth/month/vip/record 领取记录核对，避免本地状态丢失后重复领
 *
 * 容错：领取失败只置 failed + 文案，绝不抛给登录流程，也不阻塞播放。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { claimDayVip, hasClaimedOn, todayString } from '@/api/youth'
import { ApiError } from '@/api/request'

const STORAGE_KEY = 'kugou.concept.dayvip.v1'

interface VipRecord {
  lastClaimDate: string
  expireAt: string | null
  message: string
  updatedAt: number
}

type VipStorage = Record<string, VipRecord>

function readStorage(): VipStorage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as VipStorage
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStorage(storage: VipStorage) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storage))
  } catch {
    // 隐私模式 / 配额受限时静默失败，不影响本次会话
  }
}

function readableError(error: unknown): string {
  if (error instanceof ApiError) {
    // 20002 / 51002 是酷狗侧「未登录」类错误码；非 2xx 响应时不会走 AUTH_INVALID 分支
    if (error.code === 'AUTH_INVALID' || error.code === 20002 || error.code === 51002) {
      return '登录态已失效，请重新登录后再领取'
    }
    if (error.message) return error.message
  }
  if (error instanceof Error && error.message) return error.message
  return '领取失败，请稍后重试'
}

export const useVipStore = defineStore('vip', () => {
  const claiming = ref(false)
  const lastClaimDate = ref<string | null>(null)
  const expireAt = ref<string | null>(null)
  const message = ref<string | null>(null)
  const failed = ref(false)
  const alreadyClaimed = ref(false)
  /** 当前状态对应的账号，切换账号时必须重置，避免串号 */
  let activeUserId: string | null = null

  const claimedToday = computed(() => lastClaimDate.value === todayString())

  const statusLabel = computed(() => {
    if (claiming.value) return '领取中…'
    if (claimedToday.value) return '今日已领取'
    if (failed.value) return '领取失败'
    return '未领取'
  })

  const tone = computed<'ok' | 'warn' | 'err' | 'muted'>(() => {
    if (claiming.value) return 'muted'
    if (claimedToday.value) return 'ok'
    if (failed.value) return 'err'
    return 'warn'
  })

  function reset() {
    claiming.value = false
    lastClaimDate.value = null
    expireAt.value = null
    message.value = null
    failed.value = false
    alreadyClaimed.value = false
    activeUserId = null
  }

  /** 切换到某个账号时载入其本地领取记录 */
  function syncUser(userid: string) {
    if (activeUserId === userid) return
    activeUserId = userid
    const record = readStorage()[userid]
    lastClaimDate.value = record?.lastClaimDate ?? null
    expireAt.value = record?.expireAt ?? null
    message.value = record?.message ?? null
    failed.value = false
    alreadyClaimed.value = false
  }

  function persist(userid: string) {
    if (!lastClaimDate.value) return
    const storage = readStorage()
    storage[userid] = {
      lastClaimDate: lastClaimDate.value,
      expireAt: expireAt.value,
      message: message.value ?? '',
      updatedAt: Date.now(),
    }
    writeStorage(storage)
  }

  function markClaimed(userid: string, payload: { message: string; expireAt: string | null; already: boolean }) {
    lastClaimDate.value = todayString()
    expireAt.value = payload.expireAt ?? expireAt.value
    message.value = payload.message
    failed.value = false
    alreadyClaimed.value = payload.already
    persist(userid)
  }

  /**
   * 领取今日一天 VIP。
   * @param userid 当前账号
   * @param options.force 跳过本地日期幂等（手动「立即领取」时使用）
   * @param options.remoteCheck 领取前核对服务端记录（默认开启）
   */
  async function claimToday(
    userid: string,
    options: { force?: boolean; remoteCheck?: boolean } = {}
  ) {
    if (!userid) return
    syncUser(userid)
    if (claiming.value) return
    if (!options.force && claimedToday.value) return

    claiming.value = true
    failed.value = false
    message.value = null

    try {
      if (options.remoteCheck !== false) {
        const remoteClaimed = await hasClaimedOn(todayString())
        if (remoteClaimed === true) {
          markClaimed(userid, {
            message: '今日已领取一天 VIP（服务端记录）',
            expireAt: expireAt.value,
            already: true,
          })
          return
        }
      }

      const outcome = await claimDayVip()
      markClaimed(userid, {
        message: outcome.message,
        expireAt: outcome.expireAt,
        already: outcome.alreadyClaimed,
      })
    } catch (error) {
      failed.value = true
      message.value = readableError(error)
      console.warn('[vip] 领取一天 VIP 失败（不阻塞主流程）', error)
    } finally {
      claiming.value = false
    }
  }

  return {
    claiming,
    lastClaimDate,
    expireAt,
    message,
    failed,
    alreadyClaimed,
    claimedToday,
    statusLabel,
    tone,
    claimToday,
    syncUser,
    reset,
  }
})
