<script setup lang="ts">
/**
 * 侧栏导航
 *
 * 折叠态只保留图标（宽度 76px），折叠状态持久化在 settings store。
 * 「我的音乐 / 个人中心」需要登录，未登录时点击会由路由守卫重定向到登录页。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import AppIcon from '@/components/common/AppIcon.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'

interface NavItem {
  label: string
  to: string
  icon: string
  requiresAuth?: boolean
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const settings = useSettingsStore()

const browseNav: NavItem[] = [
  { label: '发现', to: '/discover', icon: 'compass' },
  { label: '搜索', to: '/search', icon: 'search' },
  { label: '排行榜', to: '/rank', icon: 'rank' },
]

const mineNav: NavItem[] = [
  { label: '我的音乐', to: '/library', icon: 'disc', requiresAuth: true },
  { label: '个人中心', to: '/profile', icon: 'user', requiresAuth: true },
]

const collapsed = computed(() => settings.sidebarCollapsed)

function isActive(path: string) {
  return route.path === path || route.path.startsWith(`${path}/`)
}

function goLogin() {
  void router.push({ name: 'login', query: { redirect: route.fullPath } })
}

async function logout() {
  await auth.logout()
  void router.push('/discover')
}
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

      <p class="sidebar__group">我的</p>
      <RouterLink
        v-for="item in mineNav"
        :key="item.to"
        :to="item.to"
        class="nav-item"
        :class="{ 'nav-item--active': isActive(item.to) }"
        :title="collapsed ? item.label : undefined"
      >
        <AppIcon :name="item.icon" :size="18" />
        <span class="nav-item__label">{{ item.label }}</span>
        <AppIcon v-if="item.requiresAuth && !auth.isLoggedIn" class="nav-item__lock" name="login" :size="13" />
      </RouterLink>
    </nav>

    <div class="sidebar__footer">
      <template v-if="auth.isLoggedIn">
        <div class="user-card">
          <UserAvatar :src="auth.profile?.avatar" :name="auth.displayName" :size="32" />
          <span class="user-card__meta">
            <span class="user-card__name">
              {{ auth.displayName }}
              <span v-if="auth.vipActive" class="user-card__vip">VIP</span>
            </span>
            <span class="user-card__id tabular">ID {{ auth.userId }}</span>
          </span>
          <button class="icon-button user-card__logout" type="button" title="退出登录" @click="logout">
            <AppIcon name="logout" :size="15" />
          </button>
        </div>
      </template>

      <button v-else class="login-card" type="button" @click="goLogin">
        <span class="login-card__icon"><AppIcon name="sparkle" :size="16" /></span>
        <span class="login-card__meta">
          <span class="login-card__title">登录酷狗账号</span>
          <span class="login-card__desc">同步歌单 · 每日签到</span>
        </span>
      </button>

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
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: var(--sidebar-w);
  flex: none;
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
}

.sidebar__group {
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

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
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

.nav-item__label {
  transition: opacity var(--dur) var(--ease);
}

.nav-item__lock {
  margin-left: auto;
  color: var(--text-3);
}

.sidebar--collapsed .sidebar__group {
  opacity: 0;
}

.sidebar--collapsed .nav-item {
  justify-content: center;
  padding: 0;
}

.sidebar--collapsed .nav-item__label,
.sidebar--collapsed .nav-item__lock {
  display: none;
}

.sidebar__footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.user-card,
.login-card {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border-radius: var(--r-md);
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.03);
  text-align: left;
  transition:
    border-color var(--dur) var(--ease),
    background-color var(--dur) var(--ease);
}

.login-card:hover {
  border-color: rgba(44, 230, 230, 0.36);
  background: var(--brand-soft);
}

.user-card__vip {
  margin-left: 5px;
  padding: 0 5px;
  border-radius: 999px;
  border: 1px solid rgba(251, 191, 36, 0.36);
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--warn);
  vertical-align: middle;
}

.login-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 50%;
  background: var(--brand-soft);
  color: var(--brand-1);
}

.user-card__meta,
.login-card__meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  overflow: hidden;
}

.user-card__name,
.login-card__title {
  display: flex;
  align-items: center;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-card__id,
.login-card__desc {
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
}

.user-card__logout {
  margin-left: auto;
  width: 26px;
  height: 26px;
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

.sidebar--collapsed .user-card__meta,
.sidebar--collapsed .login-card__meta,
.sidebar--collapsed .user-card__logout {
  display: none;
}

.sidebar--collapsed .user-card,
.sidebar--collapsed .login-card {
  justify-content: center;
  padding: 8px 0;
}
</style>
