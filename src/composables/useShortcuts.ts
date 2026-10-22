/**
 * 应用内快捷键（文档 §4.4.1「媒体键」/ §5.6 可访问性）
 *
 * 硬件媒体键由 Media Session（SMTC）负责，这里补的是窗口聚焦时的键盘操作：
 * - 空格        播放 / 暂停
 * - ← / →       快退 / 快进 5 秒
 * - Ctrl + ← / → 上一首 / 下一首
 * - ↑ / ↓       音量 ±5%
 * - M           静音切换
 * - Esc         退出迷你模式
 *
 * 输入框、文本域、下拉框与可编辑区域内一律不拦截，避免影响搜索与表单输入。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { useSettingsStore } from '@/stores/settings'

const SEEK_STEP = 5
const VOLUME_STEP = 0.05

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
    return true
  }
  return element.isContentEditable
}

export function useShortcuts() {
  const player = usePlayerStore()
  const settings = useSettingsStore()

  function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing) return
    // 系统级组合键交给系统，不抢占
    if (event.metaKey || event.altKey) return
    if (isTypingTarget(event.target)) return

    if (event.ctrlKey) {
      if (event.code === 'ArrowRight') {
        event.preventDefault()
        if (player.hasQueue) void player.next()
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault()
        if (player.hasQueue) void player.prev()
      }
      return
    }

    switch (event.code) {
      case 'Space': {
        // 按钮/链接自带空格激活语义，避免「按下按钮 + 切换播放」双触发
        const tag = (event.target as HTMLElement | null)?.tagName
        if (tag === 'BUTTON' || tag === 'A') return
        if (!player.hasCurrent) return
        event.preventDefault()
        void player.toggle()
        break
      }
      case 'ArrowRight':
        if (!player.hasCurrent) return
        event.preventDefault()
        player.seek(player.currentTime + SEEK_STEP)
        break
      case 'ArrowLeft':
        if (!player.hasCurrent) return
        event.preventDefault()
        player.seek(player.currentTime - SEEK_STEP)
        break
      case 'ArrowUp':
        event.preventDefault()
        player.setVolume(player.volume + VOLUME_STEP)
        break
      case 'ArrowDown':
        event.preventDefault()
        player.setVolume(player.volume - VOLUME_STEP)
        break
      case 'KeyM':
        event.preventDefault()
        player.toggleMute()
        break
      case 'Escape':
        if (settings.miniMode) {
          event.preventDefault()
          void settings.setMini(false)
        }
        break
      default:
        break
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
