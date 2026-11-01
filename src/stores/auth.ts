/**
 * 登录态与凭证（文档 §4.1.5 / §6.1）
 *
 * 三通道最终收敛为同一份 KugouCredential，并统一走 completeLogin()：
 *   落盘 → /login/token 续期 → /user/info 补水
 *
 * 启动路径刻意做成两段式：
 *   boot()   只读本地凭证（快，路由守卫可 await）
 *   hydrate() 校验会话 + 拉资料（慢，失败不阻塞界面）
 * 这样上游还没起来时不会把首屏拖住 10 秒。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getBridge } from '@/bridge'
import { ApiError, onUnauthorized, setAuthToken } from '@/api/request'
import {
  loginByCellphone,
  loginByPassword,
  refreshLoginToken,
} from '@/api/login'
import { fetchUserProfile } from '@/api/user'
import { useVipStore } from '@/stores/vip'
import { useLibraryStore } from '@/stores/library'
import { useProfileMetaStore } from '@/stores/profile'
import { useFollowStore } from '@/stores/follow'
import type { KugouCredential, LoginChannel, UserProfile } from '@/types/kugou'

/**
 * 凭证 → Authorization 头。
 * 上游 server.js 用 cookieToJson 解析该头，因此必须是 `k=v;k=v` 的裸格式。
 */
export function serializeCredential(credential: KugouCredential): string {
  const pairs = [`token=${credential.token}`, `userid=${credential.userid}`]
  if (credential.vip_token) pairs.push(`vip_token=${credential.vip_token}`)
  if (credential.t1) pairs.push(`t1=${credential.t1}`)
  if (credential.dfid) pairs.push(`dfid=${credential.dfid}`)
  return pairs.join(';')
}

/** 酷狗业务错误码：20017 = token 失效 / 未登录 */
const AUTH_INVALID_CODE = 20017

/** 网络/上游未就绪不应被当成登录失效，避免把有效凭证误删 */
function isAuthInvalid(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  if (error.code === 'AUTH_INVALID') return true
  if (error.status === 401 || error.status === 403) return true

  // 非 2xx 响应时错误码藏在响应体里（例如 502 + error_code 20017）
  if (error.code === AUTH_INVALID_CODE) return true
  const payload = error.payload as { error_code?: number; errcode?: number } | null | undefined
  return payload?.error_code === AUTH_INVALID_CODE || payload?.errcode === AUTH_INVALID_CODE
}

export const useAuthStore = defineStore('auth', () => {
  const credential = ref<KugouCredential | null>(null)
  const profile = ref<UserProfile | null>(null)
  const booting = ref(false)
  const booted = ref(false)
  const hydrating = ref(false)
  /** 会话是否已完成一次服务端校验（失败或上游未就绪时为 false，可重试） */
  const sessionChecked = ref(false)
  /** 进行中的会话补水，App 与页面可共享同一次请求 */
  let hydratePromise: Promise<void> | null = null
  /** 是否因 token 失效被登出，登录页可据此提示 */
  const sessionExpired = ref(false)
  const lastChannel = ref<LoginChannel | null>(null)

  const isLoggedIn = computed(() => Boolean(credential.value?.token))
  const userId = computed(() => credential.value?.userid ?? profile.value?.userid ?? null)
  const authorization = computed(() =>
    credential.value ? serializeCredential(credential.value) : null
  )
  const displayName = computed(() => profile.value?.nickname ?? (isLoggedIn.value ? '酷狗用户' : '未登录'))
  const vipActive = computed(() => (credential.value?.vip_type ?? 0) > 0 || (profile.value?.vipType ?? 0) > 0)

  /** 单一写入口：内存状态与请求头快照必须同步，否则会出现「已登录但请求未带凭证」 */
  function applyCredential(next: KugouCredential | null) {
    credential.value = next
    setAuthToken(next ? serializeCredential(next) : null)
    if (!next) profile.value = null
  }

  /** 落盘 + 切内存。落盘失败不阻断登录（下次启动会失去免登录，但本次可用） */
  async function persist(next: KugouCredential) {
    try {
      await getBridge()?.credential.set(next)
    } catch (error) {
      console.warn('[auth] 凭证落盘失败', error)
    }
    applyCredential(next)
  }

  /** 冷启动恢复：只读凭证，随后在后台补水 */
  async function boot() {
    if (booted.value || booting.value) return
    booting.value = true
    try {
      const saved = await getBridge()?.credential.get()
      applyCredential(saved ?? null)
    } catch (error) {
      console.warn('[auth] 恢复凭证失败，按游客处理', error)
      applyCredential(null)
    } finally {
      booting.value = false
      booted.value = true
    }

    // 后台校验，不阻塞路由与首屏
    if (credential.value) {
      // 先载入本地领取状态，离线时个人中心也能展示上次结果
      useVipStore().syncUser(credential.value.userid)
      void hydrate()
    }
  }

  /**
   * 会话补水：续期 token + 拉取资料。
   * @param force 忽略 sessionChecked，登录成功后强制执行一次
   */
  async function hydrate(force = false) {
    if (!credential.value) return
    if (hydrating.value) {
      await hydratePromise
      return
    }
    if (sessionChecked.value && !force) return

    hydrating.value = true
    hydratePromise = (async () => {
      try {
        const refreshed = await refreshLoginToken(credential.value as KugouCredential)
        await persist(refreshed)
        profile.value = await fetchUserProfile()
        sessionChecked.value = true
      } catch (error) {
        if (isAuthInvalid(error)) {
          console.warn('[auth] 登录态已失效，清除本地凭证')
          await logout({ expired: true })
        } else {
          // 上游未就绪 / 网络抖动：保留凭证，等待 App 层在服务就绪后重试
          console.warn('[auth] 会话补水失败，保留本地凭证待重试', error)
        }
      } finally {
        hydrating.value = false
        hydratePromise = null
      }
    })()

    await hydratePromise
  }

  /** 刷新资料（续期失败按失效处理），供个人中心「刷新」使用 */
  async function refreshProfile(): Promise<boolean> {
    if (!credential.value) return false
    try {
      const refreshed = await refreshLoginToken(credential.value)
      await persist(refreshed)
      profile.value = await fetchUserProfile()
      sessionChecked.value = true
      return true
    } catch (error) {
      if (isAuthInvalid(error)) await logout({ expired: true })
      throw error
    }
  }

  /** 三通道公共收尾：先落盘保证「重启免登录」，再做续期与资料补水 */
  async function completeLogin(next: KugouCredential, channel: LoginChannel) {
    sessionExpired.value = false
    lastChannel.value = channel
    sessionChecked.value = false
    await persist(next)
    await hydrate(true)
  }

  async function loginByPhone(mobile: string, code: string) {
    const next = await loginByCellphone(mobile, code)
    await completeLogin(next, 'cellphone')
    return next
  }

  async function loginByPwd(username: string, password: string, code?: string) {
    const next = await loginByPassword(username, password, code)
    await completeLogin(next, 'password')
    return next
  }

  async function loginByQr(next: KugouCredential) {
    await completeLogin(next, 'qr')
    return next
  }

  async function logout(options: { expired?: boolean } = {}) {
    applyCredential(null)
    sessionChecked.value = false
    sessionExpired.value = options.expired === true
    lastChannel.value = null
    // 账号相关内存态必须清空，避免下一个账号读到上一次的结果
    useLibraryStore().reset()
    useProfileMetaStore().reset()
    useFollowStore().reset()
    try {
      await getBridge()?.credential.clear()
    } catch (error) {
      console.warn('[auth] 清除凭据失败', error)
    }
  }

  // 任意接口返回 401：清理凭证，路由守卫会把受限页面重定向到登录页
  onUnauthorized(() => {
    void logout({ expired: true })
  })

  return {
    credential,
    profile,
    booted,
    booting,
    hydrating,
    sessionChecked,
    sessionExpired,
    lastChannel,
    isLoggedIn,
    userId,
    authorization,
    displayName,
    vipActive,
    boot,
    hydrate,
    refreshProfile,
    loginByPhone,
    loginByPwd,
    loginByQr,
    logout,
  }
})
