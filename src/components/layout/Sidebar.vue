<script setup lang="ts">
/**
 * 侧栏导航
 *
 * 结构（2026-10-21 调整）：
 * - 浏览：发现 / 排行榜
 * - 我的：直接展示账号歌单列表，不再有「我的音乐」页入口
 * - 个人中心入口移到标题栏头像（见 TitleBar），侧栏不再显示用户卡片与退出按钮
 * - 搜索入口统一收敛到标题栏搜索框（见 TitleBar）：搜索不是「要浏览的目的地」，
 *   而是一个随时可用的全局动作，放侧栏会与标题栏形成两个重复入口
 *
 * 折叠态只保留图标（76px），歌单列表隐藏；展开态列表区独立滚动。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useContextMenuStore } from '@/stores/contextMenu'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import AppIcon from '@/components/common/AppIcon.vue'
import CreatePlaylistDialog from '@/components/common/CreatePlaylistDialog.vue'
import EditPlaylistDialog from '@/components/common/EditPlaylistDialog.vue'
import type { PlaylistSummary } from '@/types/kugou'

interface NavItem {
  label: string
  to: string
  icon: string
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const library = useLibraryStore()
const settings = useSettingsStore()
const menu = useContextMenuStore()

const browseNav: NavItem[] = [
  { label: '发现', to: '/discover', icon: 'compass' },
  { label: '排行榜', to: '/rank', icon: 'rank' },
]

const collapsed = computed(() => settings.sidebarCollapsed)
const playlists = computed(() => library.playlists)
const createOpen = ref(false)

/** 右键的歌单 + 编辑弹框开关 */
const editing = ref<PlaylistSummary | null>(null)
const editOpen = ref(false)

/**
 * 歌单右键菜单。
 *
 * 只有自己创建的歌单才给编辑项：收藏来的歌单上游拒写（30205），
 * 弹一个点不动的菜单不如不弹。缺 listid 同理（写接口只认 listid）。
 */
function openPlaylistMenu(event: MouseEvent, playlist: PlaylistSummary) {
  if (!playlist.mine || !playlist.listid) return
  menu.open(event, [
    {
      key: 'edit',
      label: '编辑歌单信息',
      icon: 'sliders',
      action: () => {
        editing.value = playlist
        editOpen.value = true
      },
    },
  ])
}

function isActive(path: string) {
  return route.path === path || route.path.startsWith(`${path}/`)
}

function isPlaylistActive(id: string) {
  return route.name === 'playlist' && String(route.params.id ?? '') === String(id)
}

function ensurePlaylists(force = false) {
  if (!auth.isLoggedIn || !auth.userId) return
  void library.loadPlaylists(auth.userId, force)
}

function reloadPlaylists() {
  ensurePlaylists(true)
}

function goLogin() {
  void router.push({ name: 'login', query: { redirect: route.fullPath } })
}

/** 创建成功后跳到新歌单；未能匹配到新歌单时留在原地（列表已刷新） */
function onCreated(playlist: PlaylistSummary | null) {
  if (playlist?.id) {
    void router.push({ name: 'playlist', params: { id: playlist.id } })
  }
}

onMounted(() => ensurePlaylists())

// 登录完成 / 切换账号后补拉歌单；登出由 auth 调用 library.reset()
watch(
  () => auth.userId,
  (userid) => {
    if (userid) ensurePlaylists()
  }
)
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar--collapsed': collapsed }">
    <nav class="sidebar__nav">
      <p class="sidebar__group">浏览</p>
      <RouterLink
        v-for="item in browseNav"
        :key="item.to"
        :to="item.to"
        class="nav-item"
        :class="{ 'nav-item--active': isActive(item.to) }"
        :title="collapsed ? item.label : undefined"
      >
        <AppIcon :name="item.icon" :size="18" />
        <span class="nav-item__label">{{ item.label }}</span>
      </RouterLink>

      <div class="sidebar__group-row">
        <p class="sidebar__group">我的</p>
        <button
          v-if="auth.isLoggedIn"
          class="sidebar__add"
          type="button"
          title="新建歌单"
          aria-label="新建歌单"
          @click="createOpen = true"
        >
          <AppIcon name="plus" :size="13" />
        </button>
      </div>

      <!-- 未登录：只提示登录，不在侧栏放用户卡片（头像在标题栏） -->
      <button
        v-if="!auth.isLoggedIn"
        class="nav-item nav-item--hint"
        type="button"
        :title="collapsed ? '登录后同步歌单' : undefined"
        @click="goLogin"
      >
        <AppIcon name="login" :size="17" />
        <span class="nav-item__label">登录后同步歌单</span>
      </button>

      <div v-else class="sidebar__playlists">
        <template v-if="library.loadingPlaylists && playlists.length === 0">
          <span v-for="index in 3" :key="index" class="skeleton sidebar__skeleton" />
        </template>

        <p v-else-if="library.playlistError && playlists.length === 0" class="sidebar__note sidebar__note--err">
          {{ library.playlistError }}
          <button class="sidebar__retry" type="button" @click="reloadPlaylists">重试</button>
        </p>

        <p v-else-if="playlists.length === 0" class="sidebar__note">还没有歌单</p>

        <template v-else>
          <RouterLink
            v-for="playlist in playlists"
            :key="playlist.id"
            :to="{ name: 'playlist', params: { id: playlist.id } }"
            class="playlist-item"
            :class="{ 'playlist-item--active': isPlaylistActive(playlist.id) }"
            :title="playlist.name"
            @contextmenu.prevent="openPlaylistMenu($event, playlist)"
          >
            <span class="playlist-item__cover">
              <img
                v-if="playlist.cover"
                :src="playlist.cover"
                alt=""
                referrerpolicy="no-referrer"
              />
              <AppIcon v-else name="disc" :size="12" />
            </span>
            <span class="playlist-item__name">{{ playlist.name }}</span>
            <span class="playlist-item__count tabular">{{ playlist.count }}</span>
          </RouterLink>
        </template>
      </div>
    </nav>

    <div class="sidebar__footer">
      <button
        class="collapse-button"
        type="button"
        :title="collapsed ? '展开侧栏' : '收起侧栏'"
        @click="settings.toggleSidebar()"
      >
        <AppIcon name="panel-left" :size="16" />
        <span class="collapse-button__label">收起侧栏</span>
      </button>
    </div>
    <CreatePlaylistDialog v-model="createOpen" @created="onCreated" />
    <EditPlaylistDialog v-model="editOpen" :playlist="editing" />
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  width: var(--sidebar-w);
  flex: none;
  min-height: 0;
  padding: 18px 12px 14px;
  border-right: 1px solid var(--stroke);
  transition: width var(--dur) var(--ease);
  overflow: hidden;
}

.sidebar--collapsed {
  width: var(--sidebar-w-collapsed);
}

.sidebar__nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.sidebar__group {
  flex: none;
  padding: 0 12px;
  margin: 18px 0 6px;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-3);
  transition: opacity var(--dur) var(--ease);
}

.sidebar__group:first-child {
  margin-top: 4px;
}

.sidebar__group-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  margin: 18px 0 6px;
  padding: 0 6px 0 12px;
}

.sidebar__group-row .sidebar__group {
  margin: 0;
  padding: 0;
}

.sidebar__add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: var(--text-3);
  transition:
    color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.sidebar__add:hover {
  color: var(--text-1);
  background: var(--fill-2);
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
  height: 40px;
  padding: 0 12px;
  border-radius: var(--r-sm);
  color: var(--text-2);
  font-size: 13.5px;
  white-space: nowrap;
  transition:
    color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.nav-item:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.05);
}

.nav-item--active {
  color: var(--text-1);
  background: linear-gradient(90deg, rgba(44, 230, 230, 0.16), rgba(45, 127, 249, 0.08));
}

.nav-item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 3px;
  height: 18px;
  border-radius: 3px;
  background: var(--brand-grad);
  transform: translateY(-50%);
}

.nav-item--hint {
  color: var(--text-3);
}

.nav-item__label {
  transition: opacity var(--dur) var(--ease);
}

.sidebar__playlists {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: none;
}

.playlist-item {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: none;
  height: 34px;
  padding: 0 12px;
  border-radius: var(--r-sm);
  color: var(--text-2);
  font-size: 12.5px;
  transition:
    color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.playlist-item:hover {
  color: var(--text-1);
  background: var(--fill-1);
}

.playlist-item--active {
  color: var(--text-1);
  background: linear-gradient(90deg, rgba(44, 230, 230, 0.14), rgba(45, 127, 249, 0.06));
}

.playlist-item__cover {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 6px;
  overflow: hidden;
  background: var(--fill-2);
  color: var(--text-3);
}

.playlist-item__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.playlist-item__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-item__count {
  flex: none;
  font-size: 10px;
  color: var(--text-3);
}

.sidebar__skeleton {
  flex: none;
  height: 12px;
  margin: 8px 12px;
}

.sidebar__note {
  flex: none;
  padding: 6px 12px 8px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-3);
}

.sidebar__note--err {
  color: var(--err);
}

.sidebar__retry {
  margin-left: 6px;
  color: var(--brand-1);
  font-size: 11px;
  text-decoration: underline;
}

.sidebar--collapsed .sidebar__group {
  opacity: 0;
}

.sidebar--collapsed .nav-item {
  justify-content: center;
  padding: 0;
}

.sidebar--collapsed .sidebar__group-row {
  display: none;
}

.sidebar--collapsed .nav-item__label {
  display: none;
}

/* 折叠态：歌单只留封面，纵向排列在导航下方 */
.sidebar--collapsed .sidebar__playlists {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--stroke);
}

.sidebar--collapsed .playlist-item {
  width: 46px;
  height: 46px;
  padding: 0;
  justify-content: center;
  background: transparent;
}

.sidebar--collapsed .playlist-item__cover {
  width: 36px;
  height: 36px;
  border-radius: 9px;
}

.sidebar--collapsed .playlist-item__name,
.sidebar--collapsed .playlist-item__count,
.sidebar--collapsed .sidebar__skeleton,
.sidebar--collapsed .sidebar__note {
  display: none;
}

.sidebar__footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: none;
  padding-top: 8px;
}

.collapse-button {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 12px;
  border-radius: var(--r-sm);
  color: var(--text-3);
  font-size: 12px;
  transition:
    color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.collapse-button:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.05);
}

.sidebar--collapsed .collapse-button {
  justify-content: center;
  padding: 0;
}

.sidebar--collapsed .collapse-button__label {
  display: none;
}
</style>
