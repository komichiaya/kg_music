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
import { formatTime } from '@/utils/format'
import type { SongQuality } from '@/types/kugou'

const router = useRouter()
const player = usePlayerStore()
const queueOpen = ref(false)
const qualityOpen = ref(false)

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

const qualityOptions = (Object.keys(QUALITY_LABEL) as SongQuality[]).map((value) => ({
  value,
  label: QUALITY_LABEL[value],
}))

const activeQuality = computed<SongQuality>(() => player.streamQuality ?? player.quality)
const qualityLabel = computed(() => QUALITY_LABEL[activeQuality.value])

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
      <div class="now">
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
              <span class="now__singer">{{ player.current.singer }}</span>
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

        <div class="quality">
          <button
            class="pill pill--plain quality__trigger"
            type="button"
            :title="`音质：${qualityLabel}`"
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
                <span v-else-if="option.value === activeQuality" class="menu__hint">当前</span>
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
  gap: 6px;
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
