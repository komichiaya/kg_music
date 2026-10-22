<script setup lang="ts">
/**
 * 右键菜单渲染器（全局单例，挂在 App.vue）
 *
 * 定位：先按鼠标位置渲染，然后在 nextTick（DOM 已更新、浏览器尚未绘制）里量出实际尺寸，
 * 把坐标夹到视口内。同一帧内改坐标，看不到跳动，也不会在右下角被裁掉。
 *
 * 关闭时机：点击菜单外部、Esc、页面滚动、窗口失焦 / 尺寸变化。
 * 滚动必须用捕获阶段监听，否则滚动的是内部 .app__stage，冒泡到 window 之前就被吞掉了。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { useContextMenuStore, type ContextMenuItem } from '@/stores/contextMenu'

const menu = useContextMenuStore()
const panelRef = ref<HTMLElement | null>(null)
const pos = ref({ left: 0, top: 0 })

const style = computed(() => ({ left: `${pos.value.left}px`, top: `${pos.value.top}px` }))

async function place() {
  pos.value = { left: menu.x, top: menu.y }
  await nextTick()
  const el = panelRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  pos.value = {
    left: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
    top: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
  }
}

watch(
  () => menu.visible,
  (open) => {
    if (open) void place()
  }
)

function close() {
  menu.close()
}

/** 先关菜单再执行动作：动作里可能会开弹框，菜单压在弹框上会很怪 */
function run(item: ContextMenuItem) {
  menu.close()
  void item.action()
}

function onPointerDown(event: PointerEvent) {
  if (!menu.visible) return
  if (panelRef.value?.contains(event.target as Node)) return
  menu.close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') menu.close()
}

onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('scroll', close, true)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('scroll', close, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('blur', close)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="ctx-fade">
      <div
        v-if="menu.visible"
        ref="panelRef"
        class="ctx-menu"
        :style="style"
        role="menu"
        @contextmenu.prevent
      >
        <button
          v-for="item in menu.items"
          :key="item.key"
          class="ctx-menu__item"
          :class="{ 'ctx-menu__item--danger': item.danger }"
          type="button"
          role="menuitem"
          @click="run(item)"
        >
          <AppIcon v-if="item.icon" :name="item.icon" :size="15" />
          <span class="ctx-menu__label">{{ item.label }}</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 3000;
  min-width: 172px;
  padding: 5px;
  border-radius: var(--r-sm);
  border: 1px solid var(--stroke-strong);
  background: var(--glass-strong);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  box-shadow: var(--shadow-2);
}

.ctx-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--text-1);
  text-align: left;
  transition: background-color var(--dur-fast) var(--ease);
}

.ctx-menu__item:hover {
  background: var(--brand-soft);
}

.ctx-menu__item--danger {
  color: var(--err);
}

.ctx-menu__item--danger:hover {
  background: color-mix(in srgb, var(--err) 14%, transparent);
}

.ctx-menu__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctx-fade-enter-active,
.ctx-fade-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease);
}

.ctx-fade-enter-from,
.ctx-fade-leave-to {
  opacity: 0;
  transform: scale(0.97);
}
</style>
