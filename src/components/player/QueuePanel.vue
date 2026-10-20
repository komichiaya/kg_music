<script setup lang="ts">
/**
 * 播放队列面板
 *
 * 支持：点击切歌、移除单曲、清空、拖拽排序（HTML5 DnD，仅列表内重排）。
 * 面板不参与主布局，固定在播放栏上方，避免挤压内容区。
 */
import { ref } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { usePlayerStore } from '@/stores/player'
import { formatTime } from '@/utils/format'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const player = usePlayerStore()
const dragging = ref<number | null>(null)

function onDragStart(index: number, event: DragEvent) {
  dragging.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function onDrop(index: number) {
  if (dragging.value !== null) player.move(dragging.value, index)
  dragging.value = null
}

async function clearAll() {
  player.clear()
  emit('close')
}
</script>

<template>
  <Transition name="queue">
    <aside v-if="open" class="queue">
      <header class="queue__head">
        <div>
          <p class="queue__eyebrow">Queue</p>
          <h3 class="queue__title">播放队列 · {{ player.queue.length }}</h3>
        </div>
        <div class="queue__actions">
          <button
            class="icon-button"
            type="button"
            title="清空队列"
            :disabled="!player.hasQueue"
            @click="clearAll"
          >
            <AppIcon name="close" :size="15" />
          </button>
          <button class="icon-button" type="button" title="收起" @click="emit('close')">
            <AppIcon name="chevron-right" :size="15" />
          </button>
        </div>
      </header>

      <div class="queue__list">
        <div
          v-for="(track, index) in player.queue"
          :key="track.hash"
          class="item"
          :class="{ 'item--active': index === player.currentIndex, 'item--dragging': dragging === index }"
          draggable="true"
          @dragstart="onDragStart(index, $event)"
          @dragover.prevent
          @drop.prevent="onDrop(index)"
          @dragend="dragging = null"
          @click="player.playAt(index)"
        >
          <span class="item__index tabular">
            <AppIcon
              v-if="index === player.currentIndex && player.playing"
              name="volume"
              :size="13"
            />
            <template v-else>{{ String(index + 1).padStart(2, '0') }}</template>
          </span>

          <span class="item__cover">
            <img v-if="track.cover" :src="track.cover" alt="" referrerpolicy="no-referrer" />
            <AppIcon v-else name="music" :size="14" />
          </span>

          <span class="item__meta">
            <span class="item__name">{{ track.name }}</span>
            <span class="item__singer">{{ track.singer }}</span>
          </span>

          <span class="item__time tabular">{{ formatTime(track.duration) }}</span>

          <button
            class="icon-button item__remove"
            type="button"
            title="从队列移除"
            @click.stop="player.removeAt(index)"
          >
            <AppIcon name="close" :size="13" />
          </button>
        </div>

        <EmptyState
          v-if="!player.hasQueue"
          compact
          icon="list"
          title="播放队列为空"
          description="从搜索或歌单中选一首歌开始播放。"
        />
      </div>

      <footer class="queue__foot">
        <span class="queue__hint">拖拽曲目可调整顺序</span>
        <span class="queue__hint tabular">{{ player.modeLabel }}</span>
      </footer>
    </aside>
  </Transition>
</template>

<style scoped>
.queue {
  position: fixed;
  right: 16px;
  bottom: calc(var(--playerbar-h) + 6px);
  z-index: 40;
  display: flex;
  flex-direction: column;
  width: 372px;
  max-height: min(62vh, 560px);
  border-radius: var(--r-lg);
  border: 1px solid var(--stroke-strong);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0) 40%),
    var(--glass-strong);
  backdrop-filter: blur(28px) saturate(150%);
  -webkit-backdrop-filter: blur(28px) saturate(150%);
  box-shadow: var(--shadow-2);
  overflow: hidden;
}

.queue__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--stroke);
}

.queue__eyebrow {
  font-size: 9.5px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--brand-1);
}

.queue__title {
  margin-top: 4px;
  font-size: 14px;
  font-weight: 600;
}

.queue__actions {
  display: flex;
  gap: 2px;
}

.queue__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease);
}

.item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.item--active {
  background: linear-gradient(90deg, rgba(44, 230, 230, 0.14), rgba(45, 127, 249, 0.06));
}

.item--dragging {
  opacity: 0.4;
}

.item__index {
  width: 22px;
  flex: none;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-3);
}

.item--active .item__index {
  color: var(--brand-1);
}

.item__cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 8px;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-3);
  overflow: hidden;
}

.item__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.item__meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.item__name {
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item--active .item__name {
  color: var(--brand-1);
}

.item__singer {
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item__time {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-3);
}

.item__remove {
  width: 24px;
  height: 24px;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);
}

.item:hover .item__remove {
  opacity: 1;
}

.queue__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--stroke);
}

.queue__hint {
  font-size: 10.5px;
  color: var(--text-3);
}

.queue-enter-active,
.queue-leave-active {
  transition:
    opacity var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}

.queue-enter-from,
.queue-leave-to {
  opacity: 0;
  transform: translate3d(0, 12px, 0) scale(0.98);
}
</style>
