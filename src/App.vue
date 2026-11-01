<script setup lang="ts">
/**
 * 根布局（文档 §2.3）
 *
 * 结构：TitleBar + (Sidebar + Stage) + PlayerBar
 * - 登录页走 blank 布局，不渲染任何框架层
 * - 桌面歌词窗口（transparent）只渲染 RouterView，并跳过主窗口的所有初始化逻辑
 * - 歌词改为独立路由页 /lyrics（点击播放栏封面进入），不再有侧栏 / 全屏两种形态
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Backdrop from '@/components/layout/Backdrop.vue'
import TitleBar from '@/components/layout/TitleBar.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import PlayerBar from '@/components/player/PlayerBar.vue'
import MiniPlayer from '@/components/player/MiniPlayer.vue'
import PlaylistPicker from '@/components/common/PlaylistPicker.vue'
import ArtistPicker from '@/components/common/ArtistPicker.vue'
import ContextMenu from '@/components/common/ContextMenu.vue'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { usePlayerStore } from '@/stores/player'
import { useLyricStore } from '@/stores/lyric'
import { useCheckinStore } from '@/stores/checkin'
import { usePlaylistPickerStore } from '@/stores/playlistPicker'
import { useUpstream } from '@/composables/useUpstream'
import { useShortcuts } from '@/composables/useShortcuts'
import { getBridge } from '@/bridge'
import { wordFill } from '@/utils/lyric'
import { BRAND_PALETTE, applyCoverPalette, extractPalette } from '@/utils/palette'
import type { DesktopLyricPayload } from '@/types/kugou'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const settings = useSettingsStore()
const player = usePlayerStore()
const lyric = useLyricStore()
const checkin = useCheckinStore()
const picker = usePlaylistPickerStore()
const { healthy: upstreamHealthy } = useUpstream()

const isBlank = computed(() => route.meta.blank === true)
const isTransparent = computed(() => route.meta.transparent === true)
/** 迷你模式只在主窗口生效；登录页与桌面歌词窗口不参与 */
const isMini = computed(() => settings.miniMode && !isBlank.value && !isTransparent.value)

/**
 * 页面滚动容器。
 *
 * 整个应用只有 `.app__stage` 在滚，window 本身不滚（body overflow: hidden），
 * 所以 router 的 `scrollBehavior` 对它无效 —— 那是给 window/document 用的。
 */
const stage = ref<HTMLElement | null>(null)

/**
 * 把滚动容器归零。
 *
 * 容器上有 `scroll-behavior: smooth`，直接赋 `scrollTop = 0` 会让归零变成一段
 * 肉眼可见的回滚动画，必须显式指定 `behavior: 'instant'`。
 */
function resetStageScroll() {
  stage.value?.scrollTo({ top: 0, behavior: 'instant' })
}

/** 上一次的路由名，用来区分「换页」与「同一页换参数」 */
let previousRouteName: unknown = null

/**
 * 路由变化后重置滚动位置。
 *
 * `.app__stage` 在路由切换时是复用的同一个 DOM 节点，浏览器不会自动重置 scrollTop，
 * 于是「在歌手 A 页滑到中段 → 切到歌手 B」时，新页面会停在上一位歌手的中段位置。
 *
 * 分两种情况处理，否则会有可见的跳动：
 * - **同一页换参数**（`/artist/A → /artist/B`、`/search?q=x → ?q=y`）：组件实例被复用，
 *   连 Transition 都不会跑，只能在这里立刻归零；
 * - **换页**：交给 Transition 的 `after-leave` —— 那时旧页已移除、新页还没插入，
 *   归零不会让正在淡出的旧页「跳」一下（在路由变化瞬间归零就会看到这个跳动）。
 */
watch(
  () => route.fullPath,
  () => {
    const samePage = route.name === previousRouteName
    previousRouteName = route.name
    if (samePage) resetStageScroll()
  }
)

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
  useShortcuts()

  onMounted(() => {
    settings.applyTheme()
    player.setQuality(settings.quality)
    player.setMode(settings.playbackMode)
    // 守卫里已调用过 boot，这里兜底：直接进入非受限页时也能恢复登录态
    if (!auth.booted) void auth.boot()

    // 渲染层热重载后 Main 可能仍处于迷你形态，这里同步一次避免「小窗里塞满主界面」
    const bridge = getBridge()
    if (bridge) {
      void bridge.window
        .isMini()
        .then((mini) => {
          if (mini !== settings.miniMode) settings.miniMode = mini
        })
        .catch(() => undefined)
    }
  })

  // 设置页改音质 → 立即用新音质重载当前曲；播放栏切模式 → 回写偏好
  watch(
    () => settings.quality,
    (next) => {
      void player.setQuality(next)
    }
  )

  // 播放栏也能切音质：回写偏好，否则重启后会退回设置页里的旧值（模式同理）
  watch(
    () => player.quality,
    (next) => {
      settings.quality = next
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

  /**
   * 封面主色：随当前曲目更新极光背景。
   * 提取是异步的，用 token 丢弃过期结果，避免快速切歌时颜色错位。
   */
  let paletteToken = 0
  watch(
    () => player.current?.cover,
    async (cover) => {
      if (!cover) {
        applyCoverPalette(null, BRAND_PALETTE)
        return
      }
      const token = ++paletteToken
      const palette = await extractPalette(cover)
      if (token === paletteToken) applyCoverPalette(cover, palette)
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
        // 会话失效会跳到登录页，迷你小窗放不下登录表单，先恢复普通窗口
        if (settings.miniMode) void settings.setMini(false)
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

  /** 迷你模式下弹框会超出 380×120 的可视区，进入时先关掉 */
  watch(isMini, (mini) => {
    if (mini) picker.close()
  })

  /** 设置开关 ⇄ 桌面歌词窗口 */
  watch(
    () => settings.lyricDesktop,    async (enabled) => {
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

    /**
     * 系统偏好以 Main 为准：托盘菜单也能改「开机自启」，
     * 那条路径不经过本页开关，必须靠广播回填，否则界面与系统状态不一致。
     */
    onBeforeUnmount(settings.bindSystemBridge())

    /**
     * 托盘菜单的「迷你播放器 / 设置」由 Main 转发过来。
     * 迷你态与路由都在渲染层，Main 直接改窗口几何会让两边状态脱节。
     */
    if (bridge.system) {
      onBeforeUnmount(
        bridge.system.onTrayCommand((command) => {
          if (command === 'mini') {
            void settings.setMini(true)
            return
          }
          if (command === 'restore') {
            void settings.setMini(false)
            return
          }
          if (command === 'settings' && route.name !== 'settings') {
            void router.push({ name: 'settings' })
          }
        })
      )
    }
  }
}
</script>

<template>
  <div
    class="app"
    :class="{ 'app--blank': isBlank, 'app--transparent': isTransparent, 'app--mini': isMini }"
  >
    <Backdrop v-if="!isTransparent" />

    <template v-if="!isBlank">
      <!-- 迷你模式只隐藏主界面而不卸载，返回时保留当前页面与滚动位置 -->
      <div v-show="!isMini" class="app__shell">
        <TitleBar />
        <div class="app__body">
          <Sidebar />
          <main ref="stage" class="app__stage">
            <RouterView v-slot="{ Component }">
              <!--
                after-leave 时旧页已移除、新页尚未插入，此刻归零不会让淡出的旧页跳动；
                这正是「换页时新页面从顶部开始」的实现位置（同页换参数见上面的 watch）。
              -->
              <Transition name="page" mode="out-in" @after-leave="resetStageScroll">
                <component :is="Component" />
              </Transition>
            </RouterView>
          </main>
        </div>
        <PlayerBar />
        <!-- 全局单例：任何页面通过 playlistPicker store 唤起「添加到歌单」 -->
        <PlaylistPicker />
        <!-- 全局单例：多歌手歌曲右键「跳转到歌手」时选择具体歌手 -->
        <ArtistPicker />
        <!-- 全局单例右键菜单：曲目行 / 侧栏歌单通过 contextMenu store 唤起 -->
        <ContextMenu />
      </div>

      <MiniPlayer v-if="isMini" />
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

.app__shell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
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
