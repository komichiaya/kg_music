<script setup lang="ts">
/**
 * 我的音乐（文档 §6.4）
 *
 * 自建歌单与听歌历史懒加载：进入本页才请求，同一账号不重复拉取。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PageShell from '@/components/common/PageShell.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import TrackTable from '@/components/common/TrackTable.vue'
import { useAuthStore } from '@/stores/auth'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'

type TabKey = 'created' | 'favorite' | 'recent'

const TABS: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: 'created', label: '自建歌单', icon: 'list' },
  { key: 'favorite', label: '收藏', icon: 'sparkle' },
  { key: 'recent', label: '最近播放', icon: 'activity' },
]

const router = useRouter()
const auth = useAuthStore()
const library = useLibraryStore()
const player = usePlayerStore()

const activeTab = ref<TabKey>('created')

const currentPlaylists = computed(() =>
  library.playlists.filter((item) => (activeTab.value === 'favorite' ? !item.mine : item.mine))
)

onMounted(() => {
  if (auth.userId) void library.loadPlaylists(auth.userId)
})

watch(activeTab, (tab) => {
  if (tab === 'recent') void library.loadHistory()
})

function openPlaylist(id: string) {
  void router.push({ name: 'playlist', params: { id } })
}

async function playAt(index: number) {
  await player.play(library.history[index], library.history)
}

async function reload() {
  if (auth.userId) await library.loadPlaylists(auth.userId, true)
  if (activeTab.value === 'recent') await library.loadHistory(true)
}
</script>

<template>
  <PageShell eyebrow="Library" title="我的音乐" subtitle="账号下的自建歌单与听歌历史。">
    <template #actions>
      <span class="pill pill--plain">ID {{ auth.userId }}</span>
      <button class="ghost-button" type="button" @click="reload">
        <AppIcon name="refresh" :size="14" />
        刷新
      </button>
    </template>

    <div class="tabs">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        class="tab"
        :class="{ 'tab--active': activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        <AppIcon :name="tab.icon" :size="14" />
        {{ tab.label }}
      </button>
    </div>

    <!-- 自建歌单 / 收藏 -->
    <template v-if="activeTab !== 'recent'">
      <p v-if="library.playlistError" class="error">{{ library.playlistError }}</p>

      <div v-if="library.loadingPlaylists" class="grid">
        <div v-for="index in 6" :key="index" class="card panel">
          <span class="skeleton card__cover" />
          <span class="skeleton card__line" />
        </div>
      </div>

      <div v-else-if="currentPlaylists.length > 0" class="grid">
        <button
          v-for="playlist in currentPlaylists"
          :key="playlist.id"
          class="card panel panel--interactive"
          type="button"
          @click="openPlaylist(playlist.id)"
        >
          <span class="card__cover">
            <img v-if="playlist.cover" :src="playlist.cover" alt="" referrerpolicy="no-referrer" />
            <AppIcon v-else name="disc" :size="28" />
            <span class="card__count tabular">{{ playlist.count }} 首</span>
          </span>
          <span class="card__name">{{ playlist.name }}</span>
          <span class="card__meta">by {{ playlist.creator }}</span>
        </button>
      </div>

      <div v-else class="panel">
        <EmptyState
          icon="disc"
          :title="activeTab === 'favorite' ? '还没有收藏的歌单' : '还没有自建歌单'"
          description="在酷狗客户端创建歌单后，这里会自动同步。"
        >
          <template #action>
            <button class="ghost-button" type="button" @click="reload">重新加载</button>
          </template>
        </EmptyState>
      </div>
    </template>

    <!-- 最近播放 -->
    <template v-else>
      <p v-if="library.historyError" class="error">{{ library.historyError }}</p>

      <div class="panel list">
        <TrackTable
          :tracks="library.history"
          :loading="library.loadingHistory"
          :skeleton-rows="6"
          :active-hash="player.current?.hash"
          :playing="player.playing"
          @play="playAt"
        />
        <EmptyState
          v-if="!library.loadingHistory && library.history.length === 0"
          compact
          icon="activity"
          title="暂无播放记录"
          description="账号在酷狗端的听歌排行会同步到这里。"
        />
      </div>
    </template>
  </PageShell>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 12.5px;
  color: var(--text-2);
  transition:
    color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.tab:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.05);
}

.tab--active {
  color: var(--text-1);
  border-color: var(--stroke-strong);
  background: rgba(255, 255, 255, 0.06);
}

.error {
  margin-bottom: 14px;
  padding: 10px 14px;
  border-radius: var(--r-sm);
  border: 1px solid rgba(248, 113, 113, 0.28);
  background: rgba(248, 113, 113, 0.1);
  font-size: 12px;
  color: var(--err);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 14px;
}

.card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 12px;
  text-align: left;
  border-radius: var(--r-md);
}

.card__cover {
  position: relative;
  flex: 0 0 auto;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  border-radius: var(--r-sm);
  background:
    radial-gradient(circle at 30% 20%, rgba(44, 230, 230, 0.2), transparent 60%),
    linear-gradient(140deg, rgba(45, 127, 249, 0.24), rgba(124, 92, 255, 0.16));
  color: var(--text-3);
  overflow: hidden;
}

.card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card__count {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  font-size: 9.5px;
  color: #fff;
}

.card__name {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card__meta {
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card__line {
  height: 9px;
  border-radius: 999px;
}

.list {
  padding: 4px 4px 8px;
}
</style>
