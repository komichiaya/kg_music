<script setup lang="ts">
/**
 * 自定义标题栏
 *
 * 无边框窗口下承担：拖拽区域、品牌标识、全局搜索入口、窗口控制。
 *
 * 搜索入口是全应用唯一的一处（侧栏没有「搜索」导航项，搜索页也没有输入框）：
 * 点输入框不跳页，而是在下方弹出「搜索历史 + 热门搜索」面板；输入后回车才跳搜索页。
 * 这样「看历史热词」和「搜一个词」不再需要两个入口，也不会出现「点了输入框先跳页」的绕路。
 *
 * **no-drag 必须标在「交互元素」上，不能标在容器上**（曾踩过的坑）：
 * 一度把 no-drag 加在 .titlebar__center / .titlebar__actions 两个容器上，
 * 结果中间列（flex:1）与右侧整块都变成不可拖，全窗口只剩左侧 206px 的品牌区能拖动。
 * 正确做法：容器保持可拖，只给 button / label / 控件组加 no-drag，
 * 这样容器撑开的留白仍然是拖拽区。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getBridge } from '@/bridge'
import { useAuthStore } from '@/stores/auth'
import { useDiscoverStore } from '@/stores/discover'
import { useSearchHistoryStore } from '@/stores/searchHistory'
import { useSettingsStore } from '@/stores/settings'
import AppIcon from '@/components/common/AppIcon.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const discover = useDiscoverStore()
const searchHistory = useSearchHistoryStore()
const settings = useSettingsStore()

const isMac = /Mac OS X/.test(navigator.userAgent)
const maximized = ref(false)
const keyword = ref('')

/* ---------- 搜索下拉面板 ---------- */

const searchBoxRef = ref<HTMLElement | null>(null)
const panelOpen = ref(false)

/**
 * 面板里的历史词：关键词为空时给最近几条，有输入时按包含关系过滤（当轻量补全用）。
 * 上限 6 条，避免面板撑得太高盖住内容。
 */
const historyWords = computed(() => {
  const typed = keyword.value.trim().toLowerCase()
  const items = searchHistory.items
  const matched = typed ? items.filter((item) => item.toLowerCase().includes(typed)) : items
  return matched.slice(0, 6)
})

/** 热词只在关键词为空时出现：正在输入时用户要的是补全，不是热搜榜 */
const showHot = computed(() => keyword.value.trim().length === 0)
const hotWords = computed(() => discover.hotKeywords.slice(0, 8))
const panelVisible = computed(
  () => panelOpen.value && (historyWords.value.length > 0 || (showHot.value && hotWords.value.length > 0))
)

function openPanel() {
  panelOpen.value = true
  // 热搜来自 /search/hot，store 内部有 10 分钟 TTL，重复调用不会重复请求
  void discover.loadHot()
}

/** 焦点离开整个搜索框（含面板）才收起；点面板里的按钮时焦点仍在内部，不会误关 */
function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget as Node | null
  if (next && searchBoxRef.value?.contains(next)) return
  panelOpen.value = false
}

/** 点历史 / 热词：填词后直接搜，省掉「点一下再回车」 */
function pick(word: string) {
  keyword.value = word
  panelOpen.value = false
  submitSearch()
}

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
  panelOpen.value = false
  if (!value) return
  // 已在搜索页用 replace：改关键词不该在历史里堆一层，后退仍然回到进入搜索前的页面
  if (route.name === 'search') {
    void router.replace({ name: 'search', query: { q: value } })
  } else {
    void router.push({ name: 'search', query: { q: value } })
  }
}

function minimize() {
  getBridge()?.window.minimize()
}

/** 个人中心入口：未登录时由路由守卫转登录页并带回跳地址 */
function openProfile() {
  if (route.name === 'profile') return
  void router.push({ name: 'profile' })
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

    <!-- 容器保持可拖：flex:1 撑开的留白是窗口的主要拖拽区 -->
    <div class="titlebar__center">
      <button class="nav-arrow no-drag" type="button" title="后退" @click="router.back()">
        <AppIcon name="chevron-left" :size="16" />
      </button>
      <button class="nav-arrow no-drag" type="button" title="前进" @click="router.forward()">
        <AppIcon name="chevron-right" :size="16" />
      </button>

      <div ref="searchBoxRef" class="search-box no-drag" @focusout="onFocusOut">
        <label class="search-field">
          <AppIcon name="search" :size="15" />
          <input
            v-model="keyword"
            type="text"
            placeholder="搜索歌曲、歌手、歌单"
            spellcheck="false"
            @focus="openPanel"
            @click="openPanel"
            @keyup.enter="submitSearch"
            @keydown.esc="panelOpen = false"
          />
          <kbd>ENTER</kbd>
        </label>

        <!-- 下拉面板：历史在上、热词在下，只在标题栏里，搜索页不再重复一套。
             mousedown.prevent 让焦点始终留在输入框，否则 blur 会把面板先关掉、点击落空 -->
        <div v-if="panelVisible" class="search-panel" @mousedown.prevent>
          <section v-if="historyWords.length > 0" class="search-panel__block">
            <div class="search-panel__head">
              <span class="search-panel__title">搜索历史</span>
              <button class="search-panel__clear" type="button" @click="searchHistory.clear()">
                清空
              </button>
            </div>
            <div class="search-panel__chips">
              <button
                v-for="item in historyWords"
                :key="item"
                class="search-chip"
                type="button"
                :title="item"
                @click="pick(item)"
              >
                {{ item }}
              </button>
            </div>
          </section>

          <section v-if="showHot" class="search-panel__block">
            <div class="search-panel__head">
              <span class="search-panel__title">热门搜索</span>
            </div>
            <div class="search-panel__chips">
              <button
                v-for="item in hotWords"
                :key="item"
                class="search-chip"
                type="button"
                :title="item"
                @click="pick(item)"
              >
                {{ item }}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>

    <div class="titlebar__actions">
      <button
        class="title-avatar no-drag"
        type="button"
        :class="{ 'title-avatar--active': route.name === 'profile' }"
        :title="auth.isLoggedIn ? `个人中心 · ${auth.displayName}` : '登录酷狗账号'"
        aria-label="个人中心"
        @click="openProfile"
      >
        <UserAvatar
          v-if="auth.isLoggedIn"
          :src="auth.profile?.avatar"
          :name="auth.displayName"
          :size="24"
        />
        <AppIcon v-else name="user" :size="16" />
      </button>

      <button class="title-action no-drag" type="button" title="设置" @click="router.push('/settings')">
        <AppIcon name="sliders" :size="16" />
      </button>

      <div v-if="!isMac" class="window-controls no-drag">
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
  background: var(--chrome-bg);
  backdrop-filter: var(--chrome-blur);
  flex: none;
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

/* 搜索框 + 下拉面板的定位容器：面板绝对定位挂在这里，宽度跟随输入框 */
.search-box {
  position: relative;
  width: min(420px, 46vw);
  margin-left: 8px;
  flex: none;
}

.search-field {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
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

/* ---------- 搜索下拉面板 ---------- */

.search-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 40;
  padding: 6px 6px 10px;
  border-radius: var(--r-md);
  border: 1px solid var(--stroke);
  background: var(--glass-strong);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  box-shadow: var(--shadow-2);
}

.search-panel__block + .search-panel__block {
  margin-top: 2px;
  border-top: 1px solid var(--stroke);
}

.search-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px 8px;
}

.search-panel__title {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.16em;
  color: var(--text-3);
}

.search-panel__clear {
  font-size: 11px;
  color: var(--text-3);
  transition: color var(--dur-fast) var(--ease);
}

.search-panel__clear:hover {
  color: var(--text-1);
}

.search-panel__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 10px 4px;
}

.search-chip {
  max-width: 100%;
  height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.03);
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition:
    color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.search-chip:hover {
  color: var(--text-1);
  border-color: rgba(44, 230, 230, 0.4);
  background: var(--brand-soft);
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

.title-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: var(--text-2);
  transition:
    box-shadow var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.title-avatar:hover {
  background: var(--fill-2);
}

.title-avatar--active {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand-1) 45%, transparent);
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
