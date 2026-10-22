<script setup lang="ts">
/**
 * 桌面歌词窗口（透明置顶小窗）
 *
 * 这是一个独立的 BrowserWindow（见 electron/services/lyricWindow.ts），
 * 通过 IPC 接收主窗口推送的三行歌词与逐字进度，自身不发起任何请求。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { getBridge } from '@/bridge'
import type { DesktopLyricPayload } from '@/types/kugou'

const data = ref<DesktopLyricPayload | null>(null)
let unsubscribe: (() => void) | null = null

onMounted(() => {
  document.documentElement.classList.add('transparent-window')
  unsubscribe = getBridge()?.lyric.onData((payload) => {
    data.value = payload
  }) ?? null
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('transparent-window')
  unsubscribe?.()
})

function closeWindow() {
  getBridge()?.lyric.close()
}

function wordStyle(fill: number) {
  return { '--fill': `${(fill * 100).toFixed(1)}%` }
}
</script>

<template>
  <div class="dl">
    <div class="dl__card drag-region">
      <div class="dl__bar no-drag">
        <span class="dl__signal" :class="{ 'dl__signal--playing': data?.playing }" />
        <span class="dl__meta">{{ data?.title || '未在播放' }} · {{ data?.artist || '—' }}</span>
        <button class="dl__close no-drag" type="button" title="关闭桌面歌词" @click="closeWindow">
          <AppIcon name="close" :size="12" />
        </button>
      </div>

      <div class="dl__body">
        <p class="dl__side">{{ data?.prev ?? '' }}</p>

        <p class="dl__current">
          <template v-if="data?.current?.words?.length">
            <span
              v-for="(word, index) in data.current.words"
              :key="index"
              class="dl__word"
              :style="wordStyle(word.fill)"
            >{{ word.text }}</span>
          </template>
          <template v-else>{{ data?.current?.text ?? '纯音乐，请欣赏' }}</template>
        </p>

        <p class="dl__side">{{ data?.next ?? '' }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dl {
  display: flex;
  height: 100vh;
  padding: 6px;
}

.dl__card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  padding: 10px 22px 12px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(11, 14, 20, 0.74);
  backdrop-filter: blur(26px) saturate(150%);
  -webkit-backdrop-filter: blur(26px) saturate(150%);
  box-shadow: 0 18px 52px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.dl__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 16px;
}

.dl__signal {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--text-3);
}

.dl__signal--playing {
  background: var(--brand-1);
  box-shadow: 0 0 10px rgba(44, 230, 230, 0.8);
  animation: dl-pulse 1.6s ease-in-out infinite;
}

@keyframes dl-pulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}

.dl__meta {
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dl__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-left: auto;
  flex: none;
  border-radius: 50%;
  color: var(--text-3);
  opacity: 0.35;
  transition:
    opacity var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.dl__card:hover .dl__close {
  opacity: 1;
}

.dl__close:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.1);
}

.dl__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.dl__side {
  max-width: 100%;
  font-size: 11px;
  color: var(--text-3);
  opacity: 0.62;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dl__current {
  max-width: 100%;
  font-size: 21px;
  font-weight: 600;
  line-height: 1.4;
  text-align: center;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 6px 30px rgba(44, 230, 230, 0.25);
}

.dl__word {
  background-image: var(--lyric-grad);
  background-repeat: no-repeat;
  background-size: var(--fill, 0%) 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: rgba(242, 245, 250, 0.34);
}
</style>
