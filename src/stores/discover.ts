/**
 * 发现页数据（文档 §4.4.3）
 *
 * 为什么要放到 store 而不是留在 Discover.vue：
 * 路由切走时 `<component :is>` 会卸载页面组件，组件内状态随之销毁，
 * 每次回到发现页都会重新请求 —— 私人 FM 会因此「换一批歌」，连续性被破坏，
 * 每日推荐 / 排行榜 / 热搜也在做无谓的重复请求。
 * 这里把四块数据提到 store，生命周期跟随账号会话而非页面。
 *
 * 缓存策略：
 * - 私人 FM：仅「换一批」或登录态变化时重取（推荐结果随账号变化）。
 * - 每日推荐：同一登录会话内只取一次（上游本身就是每日固定）。
 * - 排行榜 / 热搜：10 分钟 TTL，避免长时间挂着应用时内容过期。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { fetchEverydayRecommend, fetchHotSearch, fetchPersonalFm, fetchRankList } from '@/api/content'
import { ApiError } from '@/api/request'
import { useAuthStore } from '@/stores/auth'
import type { RankSummary, Track } from '@/types/kugou'

/** 榜单 / 热搜的过期时间：上游更新频率以小时计，10 分钟足够新鲜 */
const SIDE_TTL = 10 * 60 * 1000

const FALLBACK_HOT = ['夜曲', '周杰伦', '经典老歌', '纯音乐', '粤语金曲', '国风']

function readable(error: unknown): string {
  return error instanceof ApiError ? error.message : '加载失败，请稍后重试'
}

export const useDiscoverStore = defineStore('discover', () => {
  const auth = useAuthStore()

  /* ---------- 私人 FM ---------- */
  const fmTracks = ref<Track[]>([])
  const fmReason = ref('')
  const fmLoading = ref(false)
  const fmError = ref<string | null>(null)
  let fmLoaded = false

  /* ---------- 每日推荐 ---------- */
  const everyday = ref<Track[]>([])
  const everydayLoading = ref(false)
  const everydayError = ref<string | null>(null)
  let everydayLoadedFor = ''

  /* ---------- 排行榜 / 热搜 ---------- */
  const ranks = ref<RankSummary[]>([])
  const hotKeywords = ref<string[]>([...FALLBACK_HOT])
  let ranksLoadedAt = 0
  let hotLoadedAt = 0

  const fmLead = computed<Track | null>(() => fmTracks.value[0] ?? null)

  /**
   * 取一批私人 FM。
   * `force` 为假时命中缓存直接返回 —— 页面重新挂载不会再来一次。
   */
  async function loadFm(force = false) {
    if (fmLoading.value) return
    if (!force && fmLoaded) return

    fmLoading.value = true
    fmError.value = null
    try {
      const batch = await fetchPersonalFm()
      fmTracks.value = batch.tracks
      fmReason.value = batch.reason
      fmLoaded = batch.tracks.length > 0
      if (batch.tracks.length === 0) fmError.value = '私人 FM 未返回可播放曲目'
    } catch (error) {
      fmError.value = readable(error)
    } finally {
      fmLoading.value = false
    }
  }

  async function loadEveryday(force = false) {
    const userid = auth.userId ?? ''
    if (!auth.isLoggedIn || !userid) return
    if (everydayLoading.value) return
    // 换账号必须重取：每日推荐是按账号生成的
    if (!force && everydayLoadedFor === userid && everyday.value.length > 0) return

    everydayLoading.value = true
    everydayError.value = null
    try {
      everyday.value = await fetchEverydayRecommend()
      everydayLoadedFor = userid
    } catch (error) {
      everydayError.value = readable(error)
    } finally {
      everydayLoading.value = false
    }
  }

  async function loadRanks(force = false) {
    if (!force && ranks.value.length > 0 && Date.now() - ranksLoadedAt < SIDE_TTL) return
    try {
      const list = await fetchRankList()
      ranks.value = list.slice(0, 4)
      ranksLoadedAt = Date.now()
    } catch (error) {
      console.warn('[discover] 排行榜加载失败', error)
    }
  }

  async function loadHot(force = false) {
    if (!force && hotLoadedAt > 0 && Date.now() - hotLoadedAt < SIDE_TTL) return
    try {
      const words = await fetchHotSearch()
      if (words.length > 0) hotKeywords.value = words
      hotLoadedAt = Date.now()
    } catch (error) {
      console.warn('[discover] 热搜加载失败', error)
    }
  }

  /** 登出：清掉与账号绑定的内容，匿名 FM 与榜单 / 热搜可以保留 */
  function resetForLogout() {
    everyday.value = []
    everydayError.value = null
    everydayLoadedFor = ''
    fmLoaded = false
  }

  return {
    fmTracks,
    fmReason,
    fmLoading,
    fmError,
    fmLead,
    everyday,
    everydayLoading,
    everydayError,
    ranks,
    hotKeywords,
    loadFm,
    loadEveryday,
    loadRanks,
    loadHot,
    resetForLogout,
  }
})
