/**
 * 「选择歌手」弹框的开关状态
 *
 * 多歌手歌曲点右键「跳转到歌手」时，先让用户选具体是哪一位。
 * 与 playlistPicker 同样的理由做成全局单例：菜单在任意页面都能唤起，
 * DOM 只应存在一份，避免连续右键叠出多个弹框。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TrackArtist } from '@/types/kugou'

export const useArtistPickerStore = defineStore('artistPicker', () => {
  const visible = ref(false)
  const artists = ref<TrackArtist[]>([])
  /** 当前曲目名，仅用于弹框副标题，帮助确认在选哪首歌的歌手 */
  const songName = ref('')

  function open(list: TrackArtist[], song = '') {
    artists.value = list
    songName.value = song
    visible.value = true
  }

  function close() {
    visible.value = false
  }

  return { visible, artists, songName, open, close }
})
