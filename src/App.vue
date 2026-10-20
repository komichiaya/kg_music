<script setup lang="ts">
/**
 * 根布局（文档 §2.3）
 *
 * 结构：TitleBar + (Sidebar + Stage) + PlayerBar
 * - 登录页走 blank 布局，不渲染任何框架层
 * - 桌面歌词窗口（transparent）只渲染 RouterView，并跳过主窗口的所有初始化逻辑
 * - 歌词改为独立路由页 /lyrics（点击播放栏封面进入），不再有侧栏 / 全屏两种形态
 */
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Backdrop from '@/components/layout/Backdrop.vue'
import TitleBar from '@/components/layout/TitleBar.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import PlayerBar from '@/components/player/PlayerBar.vue'
import PlaylistPicker from '@/components/common/PlaylistPicker.vue'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { usePlayerStore } from '@/stores/player'
import { useLyricStore } from '@/stores/lyric'
import { useCheckinStore } from '@/stores/checkin'
import { useUpstream } from '@/composables/useUpstream'
import { getBridge } from '@/bridge'
import { wordFill } from '@/utils/lyric'
import type { DesktopLyricPayload } from '@/types/kugou'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const settings = useSettingsStore()
const player = usePlayerStore()
const lyric = useLyricStore()
const checkin = useCheckinStore()
const { healthy: upstreamHealthy } = useUpstream()

const isBlank = computed(() => route.meta.blank === true)
const isTransparent = computed(() => route.meta.transparent === true)

/** 把当前行与相邻两行推给桌面歌词窗口（含逐字填充比例） */
let lastPushAt = 0

function pushDesktopLyric(force = false) {
  if (isTransparent.value) return
  const bridge = getBridge()
  if (!bridge || !settings.lyricDesktop) return

  const now = Date.now()
  if (!force && now - lastPushAt < 120) return
  lastPushAt = now

  const index = lyric.activeIndex
  const current = index >= 0 ? lyric.lines[index] : null
  const timeMs = player.currentTime * 1000

  const payload: DesktopLyricPayload = {
    title: player.current?.name ?? '',
    artist: player.current?.singer ?? '',
    playing: player.playing,
    prev: index > 0 ? lyric.lines[index - 1].text : null,
    next: index >= 0 && index + 1 < lyric.lines.length ? lyric.lines[index + 1].text : null,
    current: current
      ? {
          text: current.text,
          words: current.words.map((word) => ({ text: word.text, fill: wordFill(word, timeMs) })),
        }
      : null,
  }

  bridge.lyric.sync(payload)
}

// ---------------- 主窗口专属逻辑 ----------------

if (!isTransparent.value) {
  onMounted(() => {
    settings.applyTheme()
    player.setQuality(settings.quality)
    player.setMode(settings.playbackMode)
    // 守卫里已调用过 boot，这里兜底：直接进入非受限页时也能恢复登录态
    if (!auth.booted) void auth.boot()
  })

  // 设置页改音质 → 立即用新音质重载当前曲；播放栏切模式 → 回写偏好
  watch(
    () => settings.quality,
    (next) => {
      void player.setQuality(next)
    }
  )

  watch(
    () => player.mode,
    (next) => {
      settings.playbackMode = next
    }
  )

  // 切歌载歌词；进度驱动当前行（store 内部只在行变化时写状态）
  watch(
    () => player.current?.hash,
    () => {
      void lyric.load(player.current)
    },
    { immediate: true }
  )

  watch(
    () => player.currentTime,
    (time) => {
      lyric.sync(time)
      pushDesktopLyric()
    }
  )

  watch(
    () => [lyric.activeIndex, player.playing, player.current?.hash],
    () => {
      pushDesktopLyric(true)
    }
  )

  /**
   * 上游就绪后再补水登录态：冷启动时凭证读取是同步快的，
   * 但会话校验依赖本地服务，晚于窗口创建的启动顺序需要有这个补触点。
   */
  watch(
    upstreamHealthy,
    (healthy) => {
      if (healthy && auth.isLoggedIn && !auth.sessionChecked) void auth.hydrate()
    },
    { immediate: true }
  )

  /**
   * 签到链：会话校验通过后按序执行「等级查询 → 一天 VIP → 首播上报（由播放触发）」。
   * 内部按账号 + 日期幂等，登录成功与冷启动两条路径都会汇入这里。
   */
  watch(
    () => [auth.isLoggedIn, auth.sessionChecked] as const,
    ([loggedIn, checked]) => {
      if (!loggedIn) {
        checkin.reset()
        return
      }
      if (checked) void checkin.run()
    },
    { immediate: true }
  )

  /** 会话失效发生在当前页面时，路由守不会再执行，这里主动送回登录页 */
  watch(
    () => auth.isLoggedIn,
    (loggedIn) => {
      if (!loggedIn && route.meta.requiresAuth) {
        void router.replace({ name: 'login', query: { redirect: route.fullPath } })
      }
    }
  )

  /** 设置开关 ⇄ 桌面歌词窗口 */
  watch(
    () => settings.lyricDesktop,
    async (enabled) => {
      const bridge = getBridge()
      if (!bridge) return
      try {
        if (enabled) {
          await bridge.lyric.open()
          pushDesktopLyric(true)
        } else {
          await bridge.lyric.close()
        }
      } catch (error) {
        console.warn('[lyric] 桌面歌词窗口操作失败', error)
      }
    },
    { immediate: true }
  )

  const bridge = getBridge()
  if (bridge) {
    const offState = bridge.lyric.onState((open) => {
      if (settings.lyricDesktop !== open) settings.lyricDesktop = open
    })
    onBeforeUnmount(offState)
  }
}
</script>

<template>
  <div class="app" :class="{ 'app--blank': isBlank, 'app--transparent': isTransparent }">
    <Backdrop v-if="!isTransparent" />

    <template v-if="!isBlank">
      <TitleBar />
      <div class="app__body">
        <Sidebar />
        <main class="app__stage">
          <RouterView v-slot="{ Component }">
            <Transition name="page" mode="out-in">
              <component :is="Component" />
            </Transition>
          </RouterView>
        </main>
      </div>
      <PlayerBar />
      <!-- 全局单例：任何页面通过 playlistPicker store 唤起「添加到歌单」 -->
      <PlaylistPicker />
    </template>

    <RouterView v-else />
  </div>
</template>

<style scoped>
.app {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app--transparent {
  background: transparent;
}

.app__body {
  position: relative;
  z-index: 5;
  display: flex;
  flex: 1;
  min-height: 0;
}

.app__stage {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scroll-behavior: smooth;
}
</style>
