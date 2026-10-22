/**
 * 右键菜单状态（全局单例）
 *
 * 为什么做成 store + 单例组件：
 * - 菜单会从多种目标上唤起（曲目行、侧栏歌单），但 DOM 只应存在一份，
 *   否则连续右键两处会叠出两层菜单；
 * - 菜单项由调用方决定（曲目菜单与歌单菜单不同），store 只负责「位置 + 开关 + 项列表」。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ContextMenuItem {
  key: string
  label: string
  /** AppIcon 名称 */
  icon?: string
  /** 危险操作（移出歌单等）标红 */
  danger?: boolean
  action: () => void | Promise<void>
}

export const useContextMenuStore = defineStore('contextMenu', () => {
  const visible = ref(false)
  const x = ref(0)
  const y = ref(0)
  const items = ref<ContextMenuItem[]>([])

  /** 在鼠标位置打开菜单；没有可执行项时直接不弹 */
  function open(event: MouseEvent, menuItems: ContextMenuItem[]) {
    if (menuItems.length === 0) return
    event.preventDefault()
    items.value = menuItems
    x.value = event.clientX
    y.value = event.clientY
    visible.value = true
  }

  function close() {
    visible.value = false
  }

  return { visible, x, y, items, open, close }
})
