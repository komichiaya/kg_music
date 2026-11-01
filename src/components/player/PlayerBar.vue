<script setup lang="ts">
/**
 * 底部播放栏（文档 §5.4）
 *
 * P2：接入真实音频——进度拖动、音量、模式、音质切换、试听标记、错误重试、队列面板。
 * 歌词入口：点击歌曲封面进入歌词页（路由 /lyrics）。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  PLAY_MODE_LABEL,
  QUALITY_LABEL,
  usePlayerStore,
} from '@/stores/player'
import AppIcon from '@/components/common/AppIcon.vue'
import QueuePanel from '@/components/player/QueuePanel.vue'
import { useContextMenuStore } from '@/stores/contextMenu'
import { useSettingsStore } from '@/stores/settings'
import { formatTime } from '@/utils/format'
import { useTrackActions } from '@/composables/useTrackActions'
import type { SongQuality } from '@/types/kugou'

const router = useRouter()
const player = usePlayerStore()
const settings = useSettingsStore()
const queueOpen = ref(false)
const qualityOpen = ref(false)

function enterMini() {
  qualityOpen.value = false
  queueOpen.value = false
  void settings.setMini(true)
}

/** 点击封面进入歌词页；无在播曲目时不响应 */
function openLyrics() {
  if (!player.hasCurrent) return
  if (router.currentRoute.value.name === 'lyrics') return
  void router.push({ name: 'lyrics' })
}

const modeIcon = computed(() => {
  if (player.mode === 'single') return 'repeat-one'
  if (player.mode === 'random') return 'shuffle'
  return 'repeat'
})

const menu = useContextMenuStore()
const { navItems, openArtist, artistsOf } = useTrackActions()

/** 播放栏当前曲目右键：跳转歌手 / 专辑 */
function openNowMenu(event: MouseEvent) {
  const track = player.current
  if (!track) return
  menu.open(event, navItems(track))
}

/**
 * 歌手名能否点击：至少要有一位带 id 的歌手可跳转。
 * 与右键菜单同一判定（`useTrackActions.artistsOf`），避免两处规则分叉。
 */
const canOpenArtist = computed(() => {
  const track = player.current
  return track ? artistsOf(track).length > 0 : false
})

const artistLinkTitle = computed(() => {
  const track = player.current
  if (!track) return undefined
  return artistsOf(track).length > 1 ? '有多位歌手，点击选择要跳转的歌手' : '查看歌手详情'
})

/**
 * 点击歌手名：唯一歌手直接进详情页，多歌手弹「选择歌手」框，
 * 单/多的分流逻辑收在 openArtist 里，这里只负责转发当前曲目。
 */
function openCurrentArtist() {
  const track = player.current
  if (!track) return
  openArtist(track)
}

const qualityOptions = (Object.keys(QUALITY_LABEL) as SongQuality[]).map((value) => ({
  value,
  label: QUALITY_LABEL[value],
}))

/**
 * 播放栏展示的是**用户选的音质**（偏好），不是实际取到的音质。
 *
 * 之前这里取的是 `streamQuality ?? quality`，而取流会按权限降级
 * （`downgradeChain`：未登录直接只请求 128；无会员权限时逐级回退），
 * 于是选了 320K 也会一直显示「标准 128K」，看起来像设置没生效。
 * 实际音质放在 tooltip 与菜单里标注，避免把「降级结果」当成「设置值」。
 */
const qualityLabel = computed(() => QUALITY_LABEL[player.quality])

/** 实际拿到的音质，可能因权限低于所选 */
const actualQuality = computed<SongQuality | null>(() => player.streamQuality)
const degraded = computed(
  () => actualQuality.value !== null && actualQuality.value !== player.quality
)

const qualityTitle = computed(() => {
  const base = `音质：${qualityLabel.value}`
  if (!degraded.value || !actualQuality.value) return base
  return `${base}（当前实际 ${QUALITY_LABEL[actualQuality.value]}，无权限时自动降级）`
})

const progressPercent = computed(() => `${(player.progress * 100).toFixed(2)}%`)
const volumePercent = computed(() => `${(player.effectiveVolume * 100).toFixed(0)}%`)

function onSeek(event: Event) {
  player.seek(Number((event.target as HTMLInputElement).value))
}

function onVolume(event: Event) {
  player.setVolume(Number((event.target as HTMLInputElement).value) / 100)
}

async function chooseQuality(value: SongQuality) {
  qualityOpen.value = false
  await player.setQuality(value)
}
</script>

<template>
  <footer class="playerbar">
    <div v-if="player.error" class="error-strip">
      <AppIcon name="activity" :size="14" />
      <span class="error-strip__text">{{ player.error }}</span>
      <button class="error-strip__action" type="button" @click="player.retry()">重试</button>
      <button class="error-strip__close" type="button" title="关闭" @click="player.error = null">
        <AppIcon name="close" :size="12" />
      </button>
    </div>

    <div class="playerbar__inner">
      <div class="now" @contextmenu.prevent="openNowMenu">
        <button
          class="now__cover"
          type="button"
          :class="{ 'now__cover--spinning': player.playing, 'now__cover--clickable': player.hasCurrent }"
          :title="player.hasCurrent ? '查看歌词' : undefined"
          :disabled="!player.hasCurrent"
          @click="openLyrics"
        >
          <img
            v-if="player.current?.cover"
            :src="player.current.cover"
            :alt="player.current.name"
            referrerpolicy="no-referrer"
          />
          <AppIcon v-else name="music" :size="22" />
        </button>
        <div class="now__meta">
          <p class="now__title">{{ player.current?.name ?? '尚未开始播放' }}</p>
          <p class="now__sub">
            <template v-if="player.current">
              <button
                v-if="canOpenArtist"
                class="now__singer now__singer--link"
                type="button"
                :title="artistLinkTitle"
                @click="openCurrentArtist"
              >
                {{ player.current.singer }}
              </button>
              <span v-else class="now__singer">{{ player.current.singer }}</span>
              <span v-if="player.previewMode" class="now__tag now__tag--warn">
                试听 {{ player.previewSeconds }} 秒
              </span>
            </template>
            <template v-else>在发现或搜索中挑选一首歌</template>
          </p>
        </div>
      </div>

      <div class="center">
        <div class="center__controls">
          <button
            class="icon-button"
            type="button"
            title="上一首"
            :disabled="!player.hasQueue"
            @click="player.prev()"
          >
            <AppIcon name="prev" :size="17" />
          </button>
          <button
            class="play-button"
            type="button"
            :title="player.playing ? '暂停' : '播放'"
            :disabled="!player.hasCurrent"
            @click="player.toggle()"
          >
            <span v-if="player.loading || player.buffering" class="play-button__spinner" />
            <AppIcon v-else :name="player.playing ? 'pause' : 'play'" :size="18" />
          </button>
          <button
            class="icon-button"
            type="button"
            title="下一首"
            :disabled="!player.hasQueue"
            @click="player.next()"
          >
            <AppIcon name="next" :size="17" />
          </button>
        </div>

        <div class="center__progress">
          <span class="time tabular">{{ formatTime(player.currentTime) }}</span>
          <input
            class="slider"
            type="range"
            min="0"
            :max="player.duration || 0"
            step="0.1"
            :value="player.currentTime"
            :style="{ '--fill': progressPercent }"
            :disabled="!player.hasCurrent"
            aria-label="播放进度"
            @input="onSeek"
          />
          <span class="time tabular">{{ formatTime(player.duration) }}</span>
        </div>
      </div>

      <div class="tools">
        <button class="icon-button" type="button" :title="PLAY_MODE_LABEL[player.mode]" @click="player.cycleMode()">
          <AppIcon :name="modeIcon" :size="17" />
        </button>

        <div class="volume">
          <button
            class="icon-button"
            type="button"
            :title="player.muted ? '取消静音' : '静音'"
            @click="player.toggleMute()"
          >
            <AppIcon :name="player.muted ? 'volume-mute' : 'volume'" :size="17" />
          </button>
          <input
            class="slider slider--volume"
            type="range"
            min="0"
            max="100"
            step="1"
            :value="Math.round(player.effectiveVolume * 100)"
            :style="{ '--fill': volumePercent }"
            aria-label="音量"
            @input="onVolume"
          />
        </div>

        <button
          class="icon-button"
          type="button"
          title="播放队列"
          :class="{ 'icon-button--active': queueOpen }"
          @click="queueOpen = !queueOpen"
        >
          <AppIcon name="list" :size="17" />
        </button>

        <button class="icon-button" type="button" title="迷你模式" @click="enterMini">
          <AppIcon name="mini" :size="17" />
        </button>

        <div class="quality">
          <button
            class="pill pill--plain quality__trigger"
            type="button"
            :title="qualityTitle"
            @click="qualityOpen = !qualityOpen"
          >
            {{ qualityLabel }}
            <span v-if="player.previewMode" class="quality__preview">试听</span>
          </button>

          <div v-if="qualityOpen" class="menu-mask" @click="qualityOpen = false" />
          <Transition name="menu">
            <div v-if="qualityOpen" class="menu">
              <button
                v-for="option in qualityOptions"
                :key="option.value"
                class="menu__item"
                :class="{ 'menu__item--active': option.value === player.quality }"
                type="button"
                @click="chooseQuality(option.value)"
              >
                <span>{{ option.label }}</span>
                <AppIcon
                  v-if="option.value === player.quality"
                  name="check"
                  :size="13"
                />
                <span
                  v-else-if="degraded && option.value === actualQuality"
                  class="menu__hint"
                >
                  实际
                </span>
              </button>
              <p class="menu__note">
                高音质需登录并具备会员权限，无权限时自动降级。
              </p>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <div v-if="queueOpen" class="queue-mask" @click="queueOpen = false" />
    <QueuePanel :open="queueOpen" @close="queueOpen = false" />
  </footer>
</template>

<style scoped>
.playerbar {
  position: relative;
  z-index: 15;
  flex: none;
  padding: 0 16px 14px;
}

.playerbar__inner {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(320px, 1.5fr) minmax(240px, 1fr);
  align-items: center;
  gap: 24px;
  height: calc(var(--playerbar-h) - 14px);
  padding: 0 20px;
  border-radius: var(--r-lg);
  border: 1px solid var(--stroke);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0) 46%),
    var(--glass-strong);
  backdrop-filter: blur(28px) saturate(150%);
  -webkit-backdrop-filter: blur(28px) saturate(150%);
  box-shadow: var(--shadow-2);
}

/* ---------- 液态玻璃（设置 → 外观 → 播放栏液态玻璃） ---------- */

/*
 * 开关落在 <html data-liquid="on">：settings store 只在「极光风格 + 开关打开」时写这个属性，
 * 极简风格下属性不存在，这里不必再判断 data-style。
 *
 * 质感全部由「多层背景渐变 + 内缘 inset 高光」表达：玻璃厚度、斜向光泽、
 * 青/蓝折射色，都是静态绘制，没有任何额外图层与动画。
 *
 * **这一层里禁止出现无限循环动画、更厚的 backdrop-filter、brightness()**
 * （曾踩过的坑）：`.playerbar__inner` 带 backdrop-filter，它内部任何持续动画
 * 都会让 Chromium 每帧重算一次大面积背景模糊；再叠加 `background-position`
 * 这种走主线程重绘的动画，合成线程被饿死。更厚的 blur 或 `brightness()`
 * 还会把 Windows 上的 backdrop-filter 推进软件回退路径。两者的表现都是
 * **整窗鼠标失效**——光标不再变成手型、点击无响应，而键盘（由主进程直接派发，
 * 不经过命中测试）仍可用。玻璃质感靠静态光影表达，不靠动。
 *
 * 也因此这里不用 ::before 叠层：负 z-index + isolation 会在模糊层里再开一个
 * 合成上下文，斜向光泽直接并进背景渐变更省一次绘制。
 *
 * **:global() 必须把整条选择器括进去**（曾踩过的坑）：写成
 * `:global(html[data-liquid='on']) .playerbar__inner` 时，scoped 编译器会把
 * 括号之后的后代部分整个丢掉，产出 `html[data-liquid='on'] { … }`——样式全落在
 * <html> 上，播放栏一点没变，开关拨了也看不出区别。正确写法是
 * `:global(html[data-liquid='on'] .playerbar__inner)`。
 *
 * 不用 overflow: hidden，否则会把 .quality 向上弹出的音质菜单裁掉。
 */
:global(html[data-liquid='on'] .playerbar__inner) {
  border-color: rgba(255, 255, 255, 0.22);
  background:
    /* 斜向光泽：原 ::before 的那道光，并进背景层省一次绘制 */
    linear-gradient(
      115deg,
      transparent 18%,
      rgba(255, 255, 255, 0.26) 40%,
      rgba(255, 255, 255, 0.1) 50%,
      rgba(255, 255, 255, 0.02) 58%,
      transparent 74%
    ),
    /* 反向弱光泽：让玻璃不是「一道光」而是「一块料」 */
    linear-gradient(
      62deg,
      rgba(255, 255, 255, 0.07),
      transparent 34%,
      transparent 72%,
      rgba(255, 255, 255, 0.05)
    ),
    /* 顶部玻璃厚度 */
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.2),
      rgba(255, 255, 255, 0.04) 40%,
      rgba(255, 255, 255, 0) 64%
    ),
    /* 折射色：青 / 蓝各一团，比之前更浓一档 */
    radial-gradient(120% 150% at 10% -24%, rgba(44, 230, 230, 0.34), transparent 56%),
    radial-gradient(96% 130% at 90% -12%, rgba(45, 127, 249, 0.32), transparent 58%),
    radial-gradient(80% 120% at 52% 130%, rgba(124, 92, 255, 0.18), transparent 62%),
    /* bloom：白芯 → 冰蓝 → 透明，四段软停靠（取自 shuding/liquid-glass 的
       bloom 配方）。不用子层 + filter: blur()——那会在模糊层里再开一个合成
       上下文，正是下面注释里禁止的构造；渐变本身自带柔和过渡，视觉等价。 */
    radial-gradient(
      46% 132% at 16% -18%,
      rgba(255, 255, 255, 0.46),
      rgba(186, 244, 255, 0.2) 36%,
      rgba(108, 224, 255, 0.05) 64%,
      rgba(108, 224, 255, 0) 100%
    ),
    radial-gradient(
      38% 112% at 84% -14%,
      rgba(214, 247, 255, 0.28),
      rgba(110, 221, 255, 0.12) 46%,
      rgba(110, 221, 255, 0) 100%
    ),
    var(--glass-strong);
  /* 与普通磨砂同档 blur：差异只留在渐变与内缘高光上，不加大模糊开销。
     saturate 略高一点不会触发软件回退，只有大半径 blur 才会。 */
  backdrop-filter: blur(28px) saturate(165%);
  -webkit-backdrop-filter: blur(28px) saturate(165%);
  /* 内缘：上亮下暗 + 一圈内发光，模拟玻璃的厚度与弧面反射 */
  /* 外缘：rim 的双层 drop-shadow 换成 box-shadow——圆角矩形下两者等价，
     但 box-shadow 不创建图层、不参与命中测试。这是「玻璃边缘发亮」的来源。 */
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.46),
    inset 0 2px 1px rgba(255, 255, 255, 0.12),
    inset 0 -1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -14px 24px -18px rgba(255, 255, 255, 0.22),
    inset 0 0 48px rgba(255, 255, 255, 0.09),
    0 0 6px rgba(170, 240, 255, 0.28),
    0 0 18px rgba(122, 225, 255, 0.16),
    var(--shadow-2);
}

/* 亮色下白玻璃需要更实的高光、更淡的内阴影，否则玻璃厚度看不出来 */
:global(html[data-liquid='on'][data-theme='light'] .playerbar__inner) {
  border-color: rgba(255, 255, 255, 0.8);
  background:
    linear-gradient(
      115deg,
      transparent 20%,
      rgba(15, 180, 196, 0.26) 42%,
      rgba(45, 127, 249, 0.14) 52%,
      transparent 72%
    ),
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.94),
      rgba(255, 255, 255, 0.6) 44%,
      rgba(255, 255, 255, 0.42) 100%
    ),
    radial-gradient(120% 140% at 12% -20%, rgba(15, 180, 196, 0.22), transparent 58%),
    radial-gradient(90% 120% at 88% -10%, rgba(45, 127, 249, 0.2), transparent 60%),
    /* bloom 亮色版：白底上不能再加白，改用品牌青的浅色晕 */
    radial-gradient(
      46% 132% at 16% -18%,
      rgba(255, 255, 255, 0.9),
      rgba(186, 240, 250, 0.42) 36%,
      rgba(15, 180, 196, 0.08) 64%,
      rgba(15, 180, 196, 0) 100%
    ),
    radial-gradient(
      38% 112% at 84% -14%,
      rgba(255, 255, 255, 0.7),
      rgba(45, 127, 249, 0.1) 46%,
      rgba(45, 127, 249, 0) 100%
    ),
    var(--glass-strong);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 1),
    inset 0 2px 1px rgba(255, 255, 255, 0.7),
    inset 0 -1px 0 rgba(15, 23, 42, 0.08),
    inset 0 -16px 26px -20px rgba(15, 23, 42, 0.14),
    inset 0 0 48px rgba(255, 255, 255, 0.5),
    /* 亮色下外缘发光要压到很淡，否则白底上会糊成一圈脏边 */
    0 0 6px rgba(15, 180, 196, 0.16),
    0 0 18px rgba(45, 127, 249, 0.1),
    var(--shadow-2);
}

/* ---------- 错误条 ---------- */

.error-strip {
  position: absolute;
  left: 50%;
  bottom: calc(var(--playerbar-h) + 4px);
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(640px, 80vw);
  padding: 8px 10px 8px 14px;
  border-radius: 999px;
  border: 1px solid rgba(248, 113, 113, 0.32);
  background: rgba(30, 12, 14, 0.92);
  color: var(--err);
  font-size: 11.5px;
  transform: translateX(-50%);
  box-shadow: var(--shadow-1);
}

.error-strip__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.error-strip__action {
  flex: none;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid rgba(248, 113, 113, 0.4);
  color: var(--err);
  font-size: 11px;
}

.error-strip__close {
  display: inline-flex;
  flex: none;
  opacity: 0.7;
}

/* ---------- 当前曲目 ---------- */

.now {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.now__cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  flex: none;
  border-radius: 12px;
  border: 1px solid var(--stroke);
  background: linear-gradient(135deg, rgba(44, 230, 230, 0.18), rgba(45, 127, 249, 0.22));
  color: var(--text-2);
  overflow: hidden;
  cursor: default;
  transition:
    transform var(--dur-fast) var(--ease),
    filter var(--dur-fast) var(--ease);
}

.now__cover--clickable {
  cursor: pointer;
}

.now__cover--clickable:hover {
  filter: brightness(1.06);
  transform: scale(1.04);
}

.now__cover:disabled {
  cursor: default;
}

.now__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.now__cover--spinning img {
  animation: vinyl-spin 18s linear infinite;
  border-radius: 50%;
}

.now__meta {
  min-width: 0;
}

.now__title {
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.now__sub {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.now__singer {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 歌手名可点击：继承 .now__singer 的省略号截断，只补交互态样式 */
.now__singer--link {
  min-width: 0;
  padding: 0;
  color: inherit;
  font: inherit;
  white-space: nowrap;
  text-align: left;
  transition: color var(--dur-fast) var(--ease);
}

.now__singer--link:hover {
  color: var(--brand-1);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.now__tag {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--stroke-strong);
  font-size: 10px;
  color: var(--text-2);
}

.now__tag--warn {
  border-color: rgba(251, 191, 36, 0.3);
  color: var(--warn);
}

/* ---------- 中部控制 ---------- */

.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  /* 上下边距：内容高 59px（控件 38 + 间隙 3 + 进度行 18）+ 上下 margin 4px = 67px，
     配合 --playerbar-h: 96px（栏内 82px）居中余 15px，视觉上上下各约 11px */
  margin: 4px 0;
}

.center__controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.play-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--brand-grad);
  color: #06121a;
  box-shadow: 0 8px 22px rgba(45, 127, 249, 0.32);
  transition:
    transform var(--dur-fast) var(--ease),
    filter var(--dur-fast) var(--ease);
}

.play-button:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: scale(1.04);
}

.play-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
}

.play-button__spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(6, 18, 26, 0.24);
  border-top-color: #06121a;
  animation: qr-spin 0.8s linear infinite;
}

@keyframes qr-spin {
  to {
    transform: rotate(360deg);
  }
}

.center__progress {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.time {
  width: 38px;
  flex: none;
  font-size: 10.5px;
  color: var(--text-3);
  text-align: center;
  font-family: var(--font-mono);
}

/* ---------- 滑块 ---------- */

.slider {
  --fill: 0%;
  flex: 1;
  height: 18px;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  cursor: pointer;
}

.slider:disabled {
  cursor: default;
  opacity: 0.5;
}

.slider::-webkit-slider-runnable-track {
  height: 3px;
  border-radius: 999px;
  background:
    linear-gradient(90deg, var(--brand-1), var(--brand-2)) 0 / var(--fill) 100% no-repeat,
    rgba(255, 255, 255, 0.12);
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  margin-top: -3.5px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);
}

.slider:hover::-webkit-slider-thumb,
.slider:focus-visible::-webkit-slider-thumb {
  opacity: 1;
}

.slider--volume {
  flex: none;
  width: 76px;
}

/* ---------- 右侧工具 ---------- */

.tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}

.volume {
  display: flex;
  align-items: center;
  gap: 2px;
}

.quality {
  position: relative;
  margin-left: 8px;
}

.quality__trigger {
  gap: 6px;
  font-size: 10.5px;
  color: var(--text-2);
  cursor: pointer;
}

.quality__preview {
  padding-left: 6px;
  border-left: 1px solid var(--stroke);
  color: var(--warn);
  font-size: 9.5px;
}

.menu-mask {
  position: fixed;
  inset: 0;
  z-index: 45;
}

.menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 10px);
  z-index: 46;
  width: 180px;
  padding: 6px;
  border-radius: var(--r-md);
  border: 1px solid var(--stroke-strong);
  background: var(--glass-strong);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow: var(--shadow-2);
}

.menu__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--r-xs);
  font-size: 12px;
  color: var(--text-2);
  transition:
    color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.menu__item:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.06);
}

.menu__item--active {
  color: var(--brand-1);
}

.menu__hint {
  font-size: 9.5px;
  color: var(--text-3);
}

.menu__note {
  margin-top: 4px;
  padding: 8px 10px 4px;
  border-top: 1px solid var(--stroke);
  font-size: 10px;
  line-height: 1.6;
  color: var(--text-3);
}

.menu-enter-active,
.menu-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease);
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.queue-mask {
  position: fixed;
  inset: 0;
  z-index: 39;
}
</style>
