/**
 * 全局「添加到歌单」弹框的开关状态
 *
 * 做成 store 而不是页面内 state 的原因：
 * - 选择器是**全局单例 UI**（挂在 App.vue 上、teleport 到 body），
 *   任何页面 / 列表想加歌只需要 `picker.open(track)`；
 * - 若每个页面各自维护一份弹框，会出现同时打开两个、层级互相压盖的问题。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Track } from '@/types/kugou'

export const usePlaylistPickerStore = defineStore('playlistPicker', () => {
  const visible = ref(false)
  /** 待添加的目标曲目；关闭后保留（便于关闭动画期间继续渲染标题） */
  const track = ref<Track | null>(null)

  function open(target: Track) {
    track.value = target
    visible.value = true
  }

  function close() {
    visible.value = false
  }

  return { visible, track, open, close }
})
