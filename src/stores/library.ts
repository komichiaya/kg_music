/**
 * 我的音乐（文档 §6.4）
 *
 * 懒加载：进入「我的音乐」页才请求，且同一账号内不重复拉取。
 * 登出时 reset，避免换账号后看到上一个账号的数据。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  createPlaylist as createPlaylistRequest,
  fetchUserHistory,
  fetchUserPlaylists,
  updatePlaylist as updatePlaylistRequest,
} from '@/api/playlist'
import { ApiError } from '@/api/request'
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
  /** 进行中的歌单请求；创建歌单后需要等它结束再强制刷新，否则新歌单不会出现在侧栏 */
  let playlistsInflight: Promise<void> | null = null

  async function loadPlaylists(userid: string, force = false) {
    if (!userid) return
    if (!force && loadedUser === userid && playlists.value.length > 0) return

    if (playlistsInflight) {
      await playlistsInflight
      if (!force) return
    }

    const task = (async () => {
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
    })()

    playlistsInflight = task
    try {
      await task
    } finally {
      if (playlistsInflight === task) playlistsInflight = null
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

  /** 从歌单移除成功后同步曲目数，避免侧栏数字虚高 */
  function noteTrackRemoved(playlistId: string) {
    playlists.value = playlists.value.map((item) =>
      item.id === playlistId ? { ...item, count: Math.max(0, item.count - 1) } : item
    )
  }

  /**
   * 保存歌单信息（名称 / 简介）。
   *
   * 上游没有局部更新：一次提交会带上 name 与 intro 的全量，所以这里也要求两者一起传。
   * 改完强制刷新列表 —— 歌单名同时出现在侧栏与详情页，局部改容易和线上不一致。
   */
  async function updatePlaylistInfo(
    userid: string,
    playlist: PlaylistSummary,
    patch: { name: string; intro: string }
  ): Promise<void> {
    if (!playlist.listid) {
      throw new ApiError('该歌单不支持编辑（缺少 listid）', { code: 'PLAYLIST_NOT_EDITABLE' })
    }
    await updatePlaylistRequest(playlist.listid, {
      name: patch.name,
      intro: patch.intro,
      totalVer: playlist.totalVer,
    })
    await loadPlaylists(userid, true)
  }

  /**
   * 新建空白歌单，成功后刷新列表并返回新歌单。
   * 上游创建响应字段不稳定，优先按 gid / listid 匹配，最后退回名称匹配。
   */
  async function createPlaylist(
    userid: string,
    name: string,
    options: { private?: boolean } = {}
  ): Promise<PlaylistSummary | null> {
    const created = await createPlaylistRequest(name, options)
    await loadPlaylists(userid, true)

    const trimmed = name.trim()
    const matched =
      (created.gid ? playlists.value.find((item) => item.id === created.gid) : undefined) ??
      (created.listid
        ? playlists.value.find((item) => item.listid === created.listid)
        : undefined) ??
      playlists.value.find((item) => item.name === trimmed)

    return matched ?? null
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
    createPlaylist,
    noteTrackAdded,
    noteTrackRemoved,
    updatePlaylistInfo,
    reset,
  }
})
