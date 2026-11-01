/**
 * 曲目跳转动作（歌手页 / 专辑页）
 *
 * 右键菜单在三个地方出现：曲目列表、播放队列、播放栏的当前曲目。
 * 菜单项的构造逻辑抽在这里，避免三处各写一遍、行为逐渐分叉。
 */
import { useRouter } from 'vue-router'
import { useArtistPickerStore } from '@/stores/artistPicker'
import type { ContextMenuItem } from '@/stores/contextMenu'
import type { Track, TrackArtist } from '@/types/kugou'

/** 部分来源会把 id 填成 0 / 空串，这类值不能当跳转参数用 */
export function linkId(value: string | number | undefined): string | null {
  if (value === undefined || value === null) return null
  const id = String(value).trim()
  return id && id !== '0' ? id : null
}

export function useTrackActions() {
  const router = useRouter()
  const artistPicker = useArtistPickerStore()

  function goArtist(id: string | number | undefined) {
    const value = linkId(id)
    if (value) void router.push({ name: 'artist', params: { id: value } })
  }

  function goAlbum(track: Track) {
    const id = linkId(track.albumId)
    if (id) void router.push({ name: 'album', params: { id } })
  }

  /**
   * 可跳转的歌手候选：优先结构化列表（多歌手时每一位都能选），
   * 退回单个 artistId；没有 id 的歌手无法跳转，直接过滤。
   */
  function artistsOf(track: Track): TrackArtist[] {
    if (track.artists && track.artists.length > 0) {
      return track.artists.filter((artist) => linkId(artist.id))
    }
    const single = linkId(track.artistId)
    return single ? [{ id: single, name: track.singer }] : []
  }

  /**
   * 跳转到曲目对应的歌手页。
   *
   * 右键菜单的「跳转到歌手」与播放栏的歌手名点击共用这一条规则：
   * 唯一歌手直接跳；多歌手不猜用户想去哪一位，弹框让用户选；
   * 没有可跳转歌手（缺 id）时什么都不做，调用方应据此禁用入口。
   */
  function openArtist(track: Track) {
    const artists = artistsOf(track)
    if (artists.length === 1) {
      goArtist(artists[0].id)
    } else if (artists.length > 1) {
      artistPicker.open(artists, track.name)
    }
  }

  /** 右键菜单里的「跳转到歌手 / 跳转到专辑」两项（没有可跳转目标时不生成） */
  function navItems(track: Track): ContextMenuItem[] {
    const items: ContextMenuItem[] = []
    const artists = artistsOf(track)

    if (artists.length === 1) {
      items.push({ key: 'artist', label: '跳转到歌手', icon: 'user', action: () => openArtist(track) })
    } else if (artists.length > 1) {
      items.push({ key: 'artist', label: '跳转到歌手…', icon: 'user', action: () => openArtist(track) })
    }

    if (linkId(track.albumId)) {
      items.push({ key: 'album', label: '跳转到专辑', icon: 'disc', action: () => goAlbum(track) })
    }

    return items
  }

  return { goArtist, goAlbum, artistsOf, openArtist, navItems }
}
