/**
 * 关注歌手（文档 §4.7）
 *
 * 上游没有「某歌手是否已关注」的查询接口，`/artist/detail` 也不带关注态，
 * 只能把 `/user/follow` 的整份列表拉到前端比对 singerid。
 * 所以这里做成全局单例：歌手页每次判断关注态都读同一份缓存，
 * 关注 / 取关后原地更新，避免每个页面各拉一次列表。
 *
 * 懒加载：进入歌手页或「我的收藏」页才请求，同一账号内不重复拉取。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { fetchFollowedArtists, followArtist, unfollowArtist } from '@/api/artist'
import type { FollowedArtist } from '@/types/kugou'

function readable(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '关注列表加载失败，请稍后重试'
}

export const useFollowStore = defineStore('follow', () => {
  const artists = ref<FollowedArtist[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** 正在提交关注 / 取关的歌手 id，用于禁用按钮防连点 */
  const pending = ref<string | null>(null)

  const loaded = computed(() => artists.value.length > 0)
  /** 已关注歌手 id 集合，`isFollowing` 用它做 O(1) 判断 */
  const idSet = computed(() => new Set(artists.value.map((item) => item.id)))

  let loadedUser = ''
  let inflight: Promise<void> | null = null

  function isFollowing(id: string): boolean {
    return idSet.value.has(id)
  }

  async function load(userid: string, force = false) {
    if (!userid) return
    if (!force && loadedUser === userid && artists.value.length > 0) return

    if (inflight) {
      await inflight
      if (!force) return
    }

    const task = (async () => {
      loading.value = true
      error.value = null
      try {
        artists.value = await fetchFollowedArtists()
        loadedUser = userid
      } catch (err) {
        error.value = readable(err)
      } finally {
        loading.value = false
      }
    })()

    inflight = task
    try {
      await task
    } finally {
      if (inflight === task) inflight = null
    }
  }

  /**
   * 切换关注态。
   *
   * 两个接口都是幂等的（重复关注、重复取关上游都回 status:1），
   * 因此不必先查后写。成功后原地维护列表：关注时补一条占位条目（头像 / 名字由调用方传入），
   * 取关时移除——这样歌手页按钮和「我的收藏」页立刻同步，不用重拉整份列表。
   */
  async function toggle(id: string, seed: { name: string; avatar: string | null }): Promise<boolean> {
    if (!id || pending.value) return isFollowing(id)

    const following = isFollowing(id)
    pending.value = id
    error.value = null
    try {
      if (following) {
        await unfollowArtist(id)
        artists.value = artists.value.filter((item) => item.id !== id)
        return false
      }

      await followArtist(id)
      if (!isFollowing(id)) {
        artists.value = [
          { id, name: seed.name, avatar: seed.avatar, addTime: Math.floor(Date.now() / 1000) },
          ...artists.value,
        ]
      }
      return true
    } catch (err) {
      error.value = readable(err)
      throw err
    } finally {
      pending.value = null
    }
  }

  function reset() {
    artists.value = []
    error.value = null
    loading.value = false
    pending.value = null
    loadedUser = ''
  }

  return {
    artists,
    loading,
    error,
    pending,
    loaded,
    isFollowing,
    load,
    toggle,
    reset,
  }
})
