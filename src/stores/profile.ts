/**
 * 账号扩展信息：听歌等级与会员状态（文档 §3.5 / §4.4.3）
 *
 * 与 auth store 分开：auth 关心「是否登录 / 凭证」，这里关心「登录后的账号画像」，
 * 避免 auth 承担过多网络请求，也便于个人中心独立刷新。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { fetchGradeInfo, fetchVipDetail } from '@/api/user'
import type { GradeInfo, VipInfo } from '@/types/kugou'

function readable(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '账号信息加载失败'
}

export const useProfileMetaStore = defineStore('profileMeta', () => {
  const grade = ref<GradeInfo | null>(null)
  const vip = ref<VipInfo | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** 进行中的加载，供并发调用共享 */
  let inflight: Promise<void> | null = null

  const level = computed(() => grade.value?.level ?? null)
  const isVip = computed(() => vip.value?.isVip === true)
  const totalMinutes = computed(() =>
    grade.value ? Math.round(grade.value.totalSeconds / 60) : null
  )

  async function load(force = false) {
    if (!force && grade.value && vip.value) return
    // 并发调用共享同一次请求，避免个人中心与其它入口各拉一遍
    if (inflight) {
      await inflight
      return
    }

    loading.value = true
    error.value = null
    inflight = (async () => {
      try {
        const [gradeResult, vipResult] = await Promise.allSettled([fetchGradeInfo(), fetchVipDetail()])
        if (gradeResult.status === 'fulfilled') grade.value = gradeResult.value
        if (vipResult.status === 'fulfilled') vip.value = vipResult.value

        const failures = [gradeResult, vipResult].filter((item) => item.status === 'rejected')
        if (failures.length === 2) {
          const reason = (failures[0] as PromiseRejectedResult).reason
          error.value = readable(reason)
        }
      } finally {
        loading.value = false
        inflight = null
      }
    })()

    await inflight
  }

  /** 用上报返回的等级结构覆盖本地快照（服务端已含本次增量） */
  function applyGrade(next: GradeInfo) {
    grade.value = next
  }

  function reset() {
    grade.value = null
    vip.value = null
    error.value = null
  }

  return { grade, vip, loading, error, level, isVip, totalMinutes, load, applyGrade, reset }
})
