<script setup lang="ts">
/**
 * 歌词页（路由 /lyrics）
 *
 * 替代原来的「侧栏歌词 + 全屏歌词」两种形态：
 * - 入口：点击底部播放栏的歌曲封面；返回：标题栏后退 / Esc / 页内关闭按钮。
 * - 沉浸背景（封面模糊）、当前行居中、KRC 逐字扫光、点击任意行跳转进度。
 * - 播放控制（进度 / 上一首 / 播放暂停 / 下一首）不在此页重复实现：
 *   底部 PlayerBar 常驻可见，全站唯一的播放控制入口在那里，页内只保留歌词交互。
 *
 * 与旧 FullscreenLyrics 的差异：不再用 Teleport 覆盖层，而是真实路由页面，
 * 因此可以被浏览器历史 / 标题栏返回接管。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/common/AppIcon.vue'
import { useLyricStore } from '@/stores/lyric'
import { usePlayerStore } from '@/stores/player'
import { useSettingsStore } from '@/stores/settings'
import { lineFill, wordFill, type LyricLine, type LyricWord } from '@/utils/lyric'

const router = useRouter()
const player = usePlayerStore()
const lyric = useLyricStore()
const settings = useSettingsStore()

const scrollRef = ref<HTMLElement | null>(null)
/** 用户手动滚动后的静默期（毫秒时间戳） */
let pauseAutoScrollUntil = 0

/**
 * 逐字扫光的时间轴。
 *
 * 不能用 `player.currentTime`：它只在 timeupdate 时更新（约 4Hz），
 * 扫光会一格一格跳。这里在播放时用 rAF 直接读 audio.currentTime，
 * 暂停时退回 store 的值（此时它已经准确）。
 */
const timeMs = ref(player.getPlaybackTime() * 1000)
let rafId = 0

function tick() {
  timeMs.value = player.getPlaybackTime() * 1000
  rafId = requestAnimationFrame(tick)
}

function stopTick() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

watch(
  () => player.playing,
  (playing) => {
    stopTick()
    if (playing) rafId = requestAnimationFrame(tick)
    else timeMs.value = player.getPlaybackTime() * 1000
  },
  { immediate: true }
)

// 暂停状态下的拖动 / 点歌词跳转：此时没有 rAF 循环，靠这个同步
watch(
  () => player.currentTime,
  (seconds) => {
    if (!player.playing) timeMs.value = seconds * 1000
  }
)
const sourceLabel = computed(() =>
  lyric.status === 'ready' ? (lyric.source === 'krc' ? 'KRC 逐字' : 'LRC 逐行') : null
)
/** 只有 KRC 带译文；纯音乐 / 中文歌通常没有，此时不显示翻译按钮 */
const hasTranslation = computed(() => lyric.lines.some((line) => Boolean(line.translation)))
/** 只有部分日文歌带罗马音；没有时不显示罗马音按钮 */
const hasRomaji = computed(() => lyric.lines.some((line) => Boolean(line.transliteration)))

function isActive(index: number) {
  return index === lyric.activeIndex
}

function wordStyle(word: LyricWord) {
  return { '--fill': `${(wordFill(word, timeMs.value) * 100).toFixed(1)}%` }
}

function lineStyle(line: LyricLine) {
  return { '--fill': `${(lineFill(line, timeMs.value) * 100).toFixed(1)}%` }
}

function scrollToActive() {
  const container = scrollRef.value
  if (!container) return
  if (Date.now() < pauseAutoScrollUntil) return

  const element = container.querySelector<HTMLElement>('.lyric-line--active')
  if (!element) return

  container.scrollTo({
    top: element.offsetTop - container.clientHeight / 2 + element.offsetHeight / 2,
    behavior: 'smooth',
  })
}

watch(
  () => lyric.activeIndex,
  () => {
    void nextTick(scrollToActive)
  }
)

watch(
  () => lyric.lines,
  () => {
    // 换歌后回到新歌词的当前行，不做平滑（从头滚会很怪）
    pauseAutoScrollUntil = 0
    void nextTick(() => {
      scrollToActive()
    })
  }
)

function pauseAutoScroll() {
  pauseAutoScrollUntil = Date.now() + 2_600
}

function seekTo(line: LyricLine) {
  player.seek(line.start / 1000)
}

async function retry() {
  lyric.reset()
  await lyric.load(player.current)
}

/** 关闭歌词页：优先走历史回退，保证从哪来回哪去；历史里没有前页时退回发现页 */
function close() {
  if (window.history.length > 1) router.back()
  else void router.push({ name: 'discover' })
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  // 路由过渡（180ms）结束后再对齐一次，避免拿错布局高度
  window.setTimeout(scrollToActive, 220)
})

onBeforeUnmount(() => {
  stopTick()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <section class="lyric-page">
    <img
      v-if="player.current?.cover"
      class="lyric-page__bg"
      :src="player.current.cover"
      alt=""
      referrerpolicy="no-referrer"
    />
    <div class="lyric-page__veil" />

    <header class="lyric-page__head">
      <div class="lyric-page__meta">
        <p class="lyric-page__eyebrow">Now Playing</p>
        <h1 class="lyric-page__title">{{ player.current?.name ?? '未在播放' }}</h1>
        <p class="lyric-page__singer">
          {{ player.current?.singer ?? '—' }}
          <span v-if="player.previewMode" class="lyric-page__tag">试听 {{ player.previewSeconds }} 秒</span>
        </p>
      </div>

      <div class="lyric-page__actions">
        <button
          v-if="hasTranslation"
          class="icon-button"
          :class="{ 'icon-button--active': settings.lyricTranslation }"
          type="button"
          :title="settings.lyricTranslation ? '隐藏翻译' : '显示翻译'"
          @click="settings.lyricTranslation = !settings.lyricTranslation"
        >
          <AppIcon name="translate" :size="17" />
        </button>
        <button
          v-if="hasRomaji"
          class="icon-button"
          :class="{ 'icon-button--active': settings.lyricRomaji }"
          type="button"
          :title="settings.lyricRomaji ? '隐藏罗马音' : '显示罗马音'"
          @click="settings.lyricRomaji = !settings.lyricRomaji"
        >
          <AppIcon name="latin" :size="17" />
        </button>
        <span v-if="sourceLabel" class="pill pill--plain">{{ sourceLabel }}</span>
        <button class="icon-button" type="button" title="返回（Esc）" @click="close">
          <AppIcon name="chevron-right" :size="17" />
        </button>
      </div>
    </header>

    <div class="lyric-page__stage">
      <!-- 加载中 -->
      <div v-if="lyric.status === 'loading'" class="lyric-page__center lyric-page__center--placeholder">
        <span v-for="index in 5" :key="index" class="skeleton" :style="{ width: `${92 - index * 8}%` }" />
      </div>

      <!-- 无歌词 -->
      <div v-else-if="lyric.status === 'empty'" class="lyric-page__center">
        <div class="lyric-page__disc" :class="{ 'lyric-page__disc--spinning': player.playing }">
          <img
            v-if="player.current?.cover"
            :src="player.current.cover"
            :alt="player.current.name"
            referrerpolicy="no-referrer"
          />
          <AppIcon v-else name="music" :size="36" />
        </div>
        <p class="lyric-page__hint-title">纯音乐，请欣赏</p>
        <p class="lyric-page__hint">这首歌暂时没有收录歌词。</p>
      </div>

      <!-- 加载失败 -->
      <div v-else-if="lyric.status === 'error'" class="lyric-page__center">
        <p class="lyric-page__hint-title">歌词加载失败</p>
        <p class="lyric-page__hint">{{ lyric.error }}</p>
        <button class="ghost-button" type="button" @click="retry">重试</button>
      </div>

      <!-- 歌词列表 -->
      <div
        v-else-if="lyric.status === 'ready'"
        ref="scrollRef"
        class="lyric-page__scroll"
        @wheel="pauseAutoScroll"
        @touchmove="pauseAutoScroll"
      >
        <div class="lyric-page__pad" />
        <p
          v-for="(line, index) in lyric.lines"
          :key="`${line.start}-${index}`"
          class="lyric-line"
          :class="{ 'lyric-line--active': isActive(index) }"
          @click="seekTo(line)"
        >
          <template v-if="isActive(index) && line.words.length > 0">
            <span
              v-for="(word, wordIndex) in line.words"
              :key="wordIndex"
              class="lyric-line__word"
              :style="wordStyle(word)"
            >{{ word.text }}</span>
          </template>
          <span v-else class="lyric-line__text" :style="isActive(index) ? lineStyle(line) : undefined">
            {{ line.text }}
          </span>
          <span
            v-if="settings.lyricRomaji && line.transliteration"
            class="lyric-line__roma"
          >{{ line.transliteration }}</span>
          <span
            v-if="settings.lyricTranslation && line.translation"
            class="lyric-line__trans"
          >{{ line.translation }}</span>
        </p>
        <div class="lyric-page__pad" />
      </div>

      <!-- 尚无歌曲 -->
      <div v-else class="lyric-page__center">
        <span class="lyric-page__icon"><AppIcon name="lyric" :size="30" /></span>
        <p class="lyric-page__hint-title">还没有播放歌曲</p>
        <p class="lyric-page__hint">播放后歌词会自动加载，并随进度逐行高亮。</p>
        <button class="ghost-button" type="button" @click="close">返回发现页</button>
      </div>
    </div>

    <footer class="lyric-page__foot">
    </footer>
  </section>
</template>

<style scoped>
.lyric-page {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  /* 舞台是滚动容器，这里必须铺满整个 stage */
  margin: 0;
  border-radius: 0;
  background: var(--bg-0);
  animation: lyric-page-in var(--dur-slow) var(--ease);
}

@keyframes lyric-page-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.lyric-page__bg {
  position: absolute;
  inset: -8%;
  width: 116%;
  height: 116%;
  object-fit: cover;
  filter: blur(64px) saturate(160%) brightness(0.72);
  transform: scale(1.05);
  opacity: 0.92;
  pointer-events: none;
}

.lyric-page__veil {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(120% 90% at 50% 18%, rgba(11, 14, 20, 0.1), rgba(11, 14, 20, 0.86) 82%),
    linear-gradient(180deg, rgba(11, 14, 20, 0.32), rgba(11, 14, 20, 0.82));
  pointer-events: none;
}

:root[data-theme='light'] .lyric-page__veil {
  background:
    radial-gradient(120% 90% at 50% 18%, rgba(255, 255, 255, 0.16), rgba(244, 246, 251, 0.88) 82%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.38), rgba(244, 246, 251, 0.86));
}

/* ---------- 头部 ---------- */

.lyric-page__head {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 28px 36px 0;
}

.lyric-page__eyebrow {
  font-size: 9.5px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--brand-1);
  opacity: 0.85;
}

.lyric-page__title {
  margin-top: 8px;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-1);
}

.lyric-page__singer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--text-2);
}

.lyric-page__tag {
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid rgba(251, 191, 36, 0.3);
  font-size: 10px;
  color: var(--warn);
}

.lyric-page__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ---------- 歌词区 ---------- */

.lyric-page__stage {
  position: relative;
  z-index: 2;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 36px 4px;
}

.lyric-page__scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 12%, #000 88%, transparent);
  mask-image: linear-gradient(180deg, transparent, #000 12%, #000 88%, transparent);
}

.lyric-page__scroll::-webkit-scrollbar {
  display: none;
}

.lyric-page__pad {
  height: 38%;
}

.lyric-line {
  padding: 10px 8px;
  font-size: 17px;
  line-height: 1.7;
  color: var(--text-3);
  cursor: pointer;
  transition:
    color var(--dur) var(--ease),
    opacity var(--dur) var(--ease),
    font-size var(--dur) var(--ease);
  opacity: 0.72;
  transform-origin: left center;
}

.lyric-line:hover {
  opacity: 1;
  color: var(--text-2);
}

.lyric-line--active {
  opacity: 1;
  padding-top: 16px;
  padding-bottom: 16px;
}

.lyric-line--active .lyric-line__text {
  font-size: 30px;
  font-weight: 600;
  letter-spacing: 0.01em;
  background: var(--lyric-grad);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: none;
}

/* 逐字扫光：未唱到的字保留弱色，已唱到的字被亮白→品牌色渐变填充 */
.lyric-line__word {
  font-size: 30px;
  font-weight: 600;
  background-image: var(--lyric-grad);
  background-repeat: no-repeat;
  background-size: var(--fill, 0%) 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: var(--text-3);
}


/* 罗马音：紧贴原文下方，比译文更弱；同样不做渐变裁切 */
.lyric-line__roma {
  display: block;
  margin-top: 3px;
  font-size: 12.5px;
  line-height: 1.5;
  letter-spacing: 0.02em;
  color: var(--text-3);
  -webkit-text-fill-color: currentColor;
}

.lyric-line--active .lyric-line__roma {
  font-size: 15px;
  color: var(--text-2);
}

/* 译文：跟在原文下方，弱一档；当前行也放大一点，但不用渐变裁切 */
.lyric-line__trans {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.55;
  letter-spacing: 0;
  color: var(--text-3);
  -webkit-text-fill-color: currentColor;
}

.lyric-line--active .lyric-line__trans {
  font-size: 17px;
  color: var(--text-2);
}

/* ---------- 空态 / 占位 ---------- */

.lyric-page__center {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
}

.lyric-page__center--placeholder {
  gap: 18px;
  padding: 40px 20%;
}

.lyric-page__center--placeholder .skeleton {
  height: 13px;
  border-radius: 999px;
}

.lyric-page__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-3);
}

.lyric-page__hint-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
}

.lyric-page__hint {
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-2);
  max-width: 320px;
}

.lyric-page__disc {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 168px;
  height: 168px;
  margin-bottom: 10px;
  border-radius: 50%;
  border: 1px solid var(--stroke-strong);
  background: linear-gradient(135deg, rgba(44, 230, 230, 0.18), rgba(45, 127, 249, 0.22));
  color: var(--text-2);
  overflow: hidden;
  box-shadow: var(--shadow-2);
}

.lyric-page__disc img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.lyric-page__disc--spinning img {
  animation: vinyl-spin 18s linear infinite;
}

/* ---------- 底部提示 ---------- */

/* 播放控制统一由全局 PlayerBar 承担，这里只留一行操作提示 */
.lyric-page__foot {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 36px 18px;
}

.lyric-page__tip {
  font-size: 11px;
  letter-spacing: 0.01em;
  color: var(--text-3);
  opacity: 0.8;
  text-align: center;
}

@media (max-width: 900px) {
  .lyric-page__head,
  .lyric-page__stage,
  .lyric-page__foot {
    padding-left: 20px;
    padding-right: 20px;
  }

  .lyric-line--active .lyric-line__text,
  .lyric-line__word {
    font-size: 22px;
  }

  .lyric-page__title {
    font-size: 20px;
  }
}
</style>
