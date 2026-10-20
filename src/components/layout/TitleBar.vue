<script setup lang="ts">
/**
 * 自定义标题栏
 *
 * 无边框窗口下承担：拖拽区域、品牌标识、全局搜索入口、窗口控制。
 * 交互元素必须标记 no-drag，否则点击会被窗口拖拽吞掉。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getBridge } from '@/bridge'
import { useSettingsStore } from '@/stores/settings'
import AppIcon from '@/components/common/AppIcon.vue'

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()

const isMac = /Mac OS X/.test(navigator.userAgent)
const maximized = ref(false)
const keyword = ref('')

let disposeMaximize: (() => void) | null = null

onMounted(async () => {
  const bridge = getBridge()
  if (!bridge) return
  maximized.value = await bridge.window.isMaximized()
  disposeMaximize = bridge.window.onMaximizeChange((value) => {
    maximized.value = value
  })
})

onBeforeUnmount(() => disposeMaximize?.())

// 路由变化时同步搜索框（例如从侧栏进入搜索页）
watch(
  () => route.query.q,
  (value) => {
    keyword.value = typeof value === 'string' ? value : ''
  },
  { immediate: true }
)

function submitSearch() {
  const value = keyword.value.trim()
  if (!value) return
  if (route.name === 'search') {
    void router.replace({ name: 'search', query: { q: value } })
  } else {
    void router.push({ name: 'search', query: { q: value } })
  }
}

function minimize() {
  getBridge()?.window.minimize()
}

async function toggleMaximize() {
  const bridge = getBridge()
  if (!bridge) return
  maximized.value = await bridge.window.toggleMaximize()
}

function close() {
  getBridge()?.window.close()
}
</script>

<template>
  <header class="titlebar drag-region" :class="{ 'titlebar--mac': isMac }">
    <div
      class="titlebar__brand"
      :class="{ 'titlebar__brand--compact': settings.sidebarCollapsed }"
    >
      <span class="brand-mark">
        <span class="brand-mark__bar" />
        <span class="brand-mark__bar brand-mark__bar--tall" />
        <span class="brand-mark__bar" />
      </span>
      <span class="brand-copy">
        <span class="brand-copy__main">KUGO</span>
        <span class="brand-copy__sub">CONCEPT</span>
      </span>
    </div>

    <div class="titlebar__center no-drag">
      <button class="nav-arrow" type="button" title="后退" @click="router.back()">
        <AppIcon name="chevron-left" :size="16" />
      </button>
      <button class="nav-arrow" type="button" title="前进" @click="router.forward()">
        <AppIcon name="chevron-right" :size="16" />
      </button>

      <label class="search-field">
        <AppIcon name="search" :size="15" />
        <input
          v-model="keyword"
          type="text"
          placeholder="搜索歌曲、歌手、歌单"
          spellcheck="false"
          @keyup.enter="submitSearch"
        />
        <kbd>ENTER</kbd>
      </label>
    </div>

    <div class="titlebar__actions no-drag">
      <button class="title-action" type="button" title="设置" @click="router.push('/settings')">
        <AppIcon name="sliders" :size="16" />
      </button>

      <div v-if="!isMac" class="window-controls">
        <button type="button" title="最小化" @click="minimize">
          <AppIcon name="minimize" :size="14" />
        </button>
        <button type="button" :title="maximized ? '还原' : '最大化'" @click="toggleMaximize">
          <AppIcon :name="maximized ? 'restore' : 'maximize'" :size="14" />
        </button>
        <button class="window-controls__close" type="button" title="关闭" @click="close">
          <AppIcon name="close" :size="14" />
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  position: relative;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 16px;
  height: var(--titlebar-h);
  padding: 0 8px 0 18px;
  border-bottom: 1px solid var(--stroke);
  background: linear-gradient(180deg, rgba(11, 14, 20, 0.72), rgba(11, 14, 20, 0.36));
  backdrop-filter: blur(18px);
  flex: none;
}

:root[data-theme='light'] .titlebar {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0.45));
}

.titlebar--mac {
  padding-left: 86px;
}

.titlebar__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  width: calc(var(--sidebar-w) - 26px);
  flex: none;
  transition: width var(--dur) var(--ease);
}

.titlebar__brand--compact {
  width: calc(var(--sidebar-w-collapsed) - 26px);
}

.brand-mark {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2.5px;
  width: 26px;
  height: 26px;
  padding-bottom: 6px;
  border-radius: 8px;
  background: var(--brand-grad);
  box-shadow: 0 6px 18px rgba(45, 127, 249, 0.35);
}

.brand-mark__bar {
  width: 2.5px;
  height: 7px;
  border-radius: 2px;
  background: rgba(6, 18, 26, 0.72);
}

.brand-mark__bar--tall {
  height: 12px;
}

.brand-copy {
  display: flex;
  align-items: baseline;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
}

.brand-copy__main {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.18em;
}

.brand-copy__sub {
  font-size: 9px;
  letter-spacing: 0.22em;
  color: var(--text-3);
}

.titlebar__brand--compact .brand-copy {
  display: none;
}

.titlebar__center {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.nav-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: var(--text-3);
  transition:
    color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.nav-arrow:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.07);
}

.search-field {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(420px, 46vw);
  height: 30px;
  margin-left: 8px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-3);
  transition:
    border-color var(--dur) var(--ease),
    background-color var(--dur) var(--ease);
}

.search-field:focus-within {
  border-color: rgba(44, 230, 230, 0.4);
  background: rgba(255, 255, 255, 0.07);
}

.search-field input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  color: var(--text-1);
}

.search-field input::placeholder {
  color: var(--text-3);
}

.search-field kbd {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--text-3);
  opacity: 0.7;
}

.titlebar__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.title-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: var(--text-2);
  transition:
    color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.title-action:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.07);
}

.window-controls {
  display: flex;
  align-items: center;
  margin-left: 6px;
}

.window-controls button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: var(--titlebar-h);
  color: var(--text-2);
  transition:
    color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.window-controls button:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.08);
}

.window-controls__close:hover {
  color: #fff;
  background: #e5484d;
}
</style>
