<script setup lang="ts">
/**
 * 迷你播放器（文档 §5.5）
 *
 * 380×120 悬浮小窗：封面 / 曲名 / 进度 / 上一首 / 播放暂停 / 下一首，
 * 双击封面或点「恢复」回到普通窗口。窗口尺寸与置顶由 Main 处理，
 * 本组件只负责视觉与播放控制。
 */
import { computed } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { getBridge } from '@/bridge'
import { usePlayerStore } from '@/stores/player'
import { useSettingsStore } from '@/stores/settings'
import { formatTime } from '@/utils/format'

const player = usePlayerStore()
const settings = useSettingsStore()

const progressPercent = computed(() => `${(player.progress * 100).toFixed(2)}%`)

function restore() {
  void settings.setMini(false)
}

function close() {
  // 与标题栏关闭一致：交给 Main 处理（后续托盘/关闭策略都在那一侧）
  getBridge()?.window.close()
}
</script>

<template>
  <div class="mini">
    <div class="mini__drag drag-region" aria-hidden="true" />

    <button
      class="mini__cover"
      type="button"
      :class="{ 'mini__cover--spinning': player.playing }"
      :disabled="!player.hasCurrent"
      title="双击回到主界面"
      @dblclick="restore"
      @click="player.toggle()"
    >
      <img
        v-if="player.current?.cover"
        :src="player.current.cover"
        :alt="player.current.name"
        referrerpolicy="no-referrer"
      />
      <AppIcon v-else name="music" :size="22" />
    </button>

    <div class="mini__meta">
      <p class="mini__title">{{ player.current?.name ?? '尚未开始播放' }}</p>
      <p class="mini__sub">
        <span class="mini__singer">{{ player.current?.singer ?? '在搜索中挑选一首歌' }}</span>
        <span v-if="player.previewMode" class="mini__tag">试听</span>
      </p>
      <p class="mini__time tabular">
        {{ formatTime(player.currentTime) }} / {{ formatTime(player.duration) }}
      </p>
    </div>

    <div class="mini__controls no-drag">
      <button
        class="mini__button"
        type="button"
        title="上一首"
        :disabled="!player.hasQueue"
        @click="player.prev()"
      >
        <AppIcon name="prev" :size="16" />
      </button>
      <button
        class="mini__button mini__button--play"
        type="button"
        :title="player.playing ? '暂停' : '播放'"
        :disabled="!player.hasCurrent"
        @click="player.toggle()"
      >
        <span v-if="player.loading || player.buffering" class="mini__spinner" />
        <AppIcon v-else :name="player.playing ? 'pause' : 'play'" :size="17" />
      </button>
      <button
        class="mini__button"
        type="button"
        title="下一首"
        :disabled="!player.hasQueue"
        @click="player.next()"
      >
        <AppIcon name="next" :size="16" />
      </button>
    </div>

    <div class="mini__actions no-drag">
      <button class="mini__action" type="button" title="恢复主界面（Esc）" @click="restore">
        <AppIcon name="expand" :size="12" />
      </button>
      <button class="mini__action" type="button" title="关闭" @click="close">
        <AppIcon name="close" :size="12" />
      </button>
    </div>

    <div class="mini__progress">
      <span class="mini__progress-fill" :style="{ width: progressPercent }" />
    </div>
  </div>
</template>

<style scoped>
/* 极简风格：迷你窗同样不要封面光晕，纯黑 / 纯白底 */
:root[data-style='minimal'] .mini {
  background: var(--bg-0);
}

.mini {
  position: relative;
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  height: 100vh;
  padding: 16px 16px 18px;
  border-radius: 0;
  background:
    radial-gradient(120% 140% at 8% 0%, color-mix(in srgb, var(--cover-1) 34%, transparent), transparent 64%),
    radial-gradient(120% 140% at 92% 100%, color-mix(in srgb, var(--cover-2) 26%, transparent), transparent 68%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0) 55%),
    var(--glass-strong);
  overflow: hidden;
}

.mini__drag {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.mini__cover,
.mini__meta,
.mini__controls,
.mini__actions,
.mini__progress {
  position: relative;
  z-index: 1;
}

.mini__cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 68px;
  height: 68px;
  flex: none;
  border-radius: 50%;
  border: 1px solid var(--stroke);
  background: linear-gradient(135deg, rgba(44, 230, 230, 0.18), rgba(45, 127, 249, 0.22));
  color: var(--text-2);
  overflow: hidden;
  box-shadow: var(--shadow-1);
  animation: vinyl-spin 18s linear infinite;
  animation-play-state: paused;
}

.mini__cover--spinning {
  animation-play-state: running;
}

.mini__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mini__cover:disabled {
  animation: none;
}

.mini__meta {
  min-width: 0;
  padding-right: 44px;
}

.mini__title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mini__sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-2);
}

.mini__singer {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mini__tag {
  flex: none;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--warn) 16%, transparent);
  color: var(--warn);
  font-size: 9.5px;
  line-height: 15px;
}

.mini__time {
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-3);
}

.mini__controls {
  display: flex;
  align-items: center;
  gap: 2px;
}

.mini__button {
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

.mini__button:hover:not(:disabled) {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.07);
}

.mini__button:disabled {
  opacity: 0.4;
  cursor: default;
}

.mini__button--play {
  width: 38px;
  height: 38px;
  background: var(--brand-grad);
  color: #06121a;
  box-shadow: 0 6px 18px rgba(45, 127, 249, 0.32);
}

.mini__button--play:hover:not(:disabled) {
  color: #06121a;
  background: var(--brand-grad);
}

.mini__spinner {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 2px solid rgba(6, 18, 26, 0.28);
  border-top-color: #06121a;
  animation: mini-spin 720ms linear infinite;
}

.mini__actions {
  position: absolute;
  top: 6px;
  right: 8px;
  z-index: 2;
  display: flex;
  gap: 2px;
  opacity: 0.5;
  transition: opacity var(--dur-fast) var(--ease);
}

.mini:hover .mini__actions {
  opacity: 1;
}

.mini__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: var(--text-2);
}

.mini__action:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.1);
}

.mini__progress {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 9px;
  height: 2px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.mini__progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--brand-grad);
  transition: width 240ms linear;
}

@keyframes mini-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
