import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    /** 页面标题，用于窗口标题 */
    title?: string
    /** 是否为无框架页面（登录页不显示标题栏/侧栏/播放栏） */
    blank?: boolean
    /** 透明窗口（桌面歌词），需要隐藏背景层并跳过窗口初始化逻辑 */
    transparent?: boolean
    /** 是否需要登录态 */
    requiresAuth?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录', blank: true },
  },
  {
    path: '/lyric-window',
    name: 'lyric-window',
    component: () => import('@/views/DesktopLyric.vue'),
    meta: { title: '桌面歌词', blank: true, transparent: true },
  },
  {
    path: '/',
    redirect: '/discover',
  },
  {
    path: '/discover',
    name: 'discover',
    component: () => import('@/views/Discover.vue'),
    meta: { title: '发现' },
  },
  {
    path: '/lyrics',
    name: 'lyrics',
    component: () => import('@/views/Lyrics.vue'),
    meta: { title: '歌词' },
  },
  {
    path: '/search',
    name: 'search',
    component: () => import('@/views/Search.vue'),
    meta: { title: '搜索' },
  },
  {
    path: '/playlist/:id',
    name: 'playlist',
    component: () => import('@/views/Playlist.vue'),
    meta: { title: '歌单' },
  },
  {
    path: '/album/:id',
    name: 'album',
    component: () => import('@/views/Album.vue'),
    meta: { title: '专辑' },
  },
  {
    path: '/artist/:id',
    name: 'artist',
    component: () => import('@/views/Artist.vue'),
    meta: { title: '歌手' },
  },
  {
    path: '/rank',
    name: 'rank',
    component: () => import('@/views/Rank.vue'),
    meta: { title: '排行榜' },
  },
  {
    path: '/library',
    name: 'library',
    component: () => import('@/views/Library.vue'),
    meta: { title: '我的音乐', requiresAuth: true },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/views/Profile.vue'),
    meta: { title: '个人中心', requiresAuth: true },
  },
  {
    path: '/favorites',
    name: 'favorites',
    component: () => import('@/views/Favorites.vue'),
    meta: { title: '我的收藏', requiresAuth: true },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/Settings.vue'),
    meta: { title: '设置' },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/discover',
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  /**
   * 注意：这个 scrollBehavior 实际上不会生效 —— 本应用 window 不滚（`body{overflow:hidden}`），
   * 真正滚动的是 `App.vue` 里的 `.app__stage`。页面滚动位置由 `App.vue` 监听 `route.fullPath` 归零，
   * 保留这里只是为了让「假设将来改成 window 滚动」时行为一致。
   */
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // 冷启动只恢复一次凭证，避免每次跳转都读磁盘
  if (!auth.booted) await auth.boot()

  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if (to.name === 'login' && auth.isLoggedIn) {
    return { name: 'discover' }
  }

  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · 酷狗音乐概念版` : '酷狗音乐概念版'
})

export default router
