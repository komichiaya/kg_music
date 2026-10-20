/**
 * 我的音乐（文档 §6.4）
 *
 * 懒加载：进入「我的音乐」页才请求，且同一账号内不重复拉取。
 * 登出时 reset，避免换账号后看到上一个账号的数据。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { fetchUserHistory, fetchUserPlaylists } from '@/api/playlist'
import type { PlaylistSummary, Track } from '@/types/kugou'

function readable(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '加载失败，请稍后重试'
}

export const useLibraryStore = defineStore('library', () => {
  const playlists = ref<PlaylistSummary[]>([])
  const history = ref<Track[]>([])
  const loadingPlaylists = ref(false)
  const loadingHistory = ref(false)
  const playlistError = ref<string | null>(null)
  const historyError = ref<string | null>(null)

  const loaded = computed(() => playlists.value.length > 0 || history.value.length > 0)

  let loadedUser = ''

  async function loadPlaylists(userid: string, force = false) {
    if (!userid) return
    if (loadingPlaylists.value) return
    if (!force && loadedUser === userid && playlists.value.length > 0) return

    loadingPlaylists.value = true
    playlistError.value = null
    try {
      playlists.value = await fetchUserPlaylists(userid)
      loadedUser = userid
    } catch (error) {
      playlistError.value = readable(error)
    } finally {
      loadingPlaylists.value = false
    }
  }

  async function loadHistory(force = false) {
    if (loadingHistory.value) return
    if (!force && history.value.length > 0) return

    loadingHistory.value = true
    historyError.value = null
    try {
      history.value = await fetchUserHistory()
    } catch (error) {
      historyError.value = readable(error)
    } finally {
      loadingHistory.value = false
    }
  }

  /**
   * 往歌单成功加歌后同步本地曲目数。
   * 不重新拉列表（代价高），只 +1 保持「我的音乐」与选择器里的数字不落后。
   */
  function noteTrackAdded(playlistId: string) {
    playlists.value = playlists.value.map((item) =>
      item.id === playlistId ? { ...item, count: item.count + 1 } : item
    )
  }

  function reset() {
    playlists.value = []
    history.value = []
    playlistError.value = null
    historyError.value = null
    loadedUser = ''
  }

  return {
    playlists,
    history,
    loadingPlaylists,
    loadingHistory,
    playlistError,
    historyError,
    loaded,
    loadPlaylists,
    loadHistory,
    noteTrackAdded,
    reset,
  }
})
