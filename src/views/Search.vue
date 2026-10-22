<script setup lang="ts">
/**
 * 搜索页（文档 §3.3）
 *
 * 关键词的唯一来源是地址栏 `?q=`：本页不再有输入框，也不再渲染「初始界面」
 * （搜索历史 / 热门搜索已移到标题栏搜索框的下拉面板）。输入动作全部发生在标题栏，
 * 本页只负责「按 q 取结果 + 分类展示」。
 *
 * 因此没有 q 时本页没有可展示的内容，直接回发现页。
 *
 * 四类结果均已接通：
 * - 单曲：整列可播（TrackTable）
 * - 歌单：卡片 → 跳歌单详情（gid）
 * - 歌手：卡片 → 以歌手名反查歌曲
 * - 专辑：卡片 → 以专辑名反查歌曲
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageShell from '@/components/common/PageShell.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import TrackTable from '@/components/common/TrackTable.vue'
import {
  searchAlbums,
  searchAuthors,
  searchPlaylists,
  searchSongs,
  type AlbumSearchItem,
  type AuthorSearchItem,
  type PlaylistSearchItem,
  type SearchPage,
  type SongSearchResult,
} from '@/api/search'
import { ApiError } from '@/api/request'
import { usePlayerStore } from '@/stores/player'
import type { Track } from '@/types/kugou'
import { useSearchHistoryStore } from '@/stores/searchHistory'
import { formatCount } from '@/utils/format'

type SearchType = 'song' | 'special' | 'author' | 'album'

const TABS: Array<{ key: SearchType; label: string }> = [
  { key: 'song', label: '单曲' },
  { key: 'special', label: '歌单' },
  { key: 'author', label: '歌手' },
  { key: 'album', label: '专辑' },
]

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const searchHistory = useSearchHistoryStore()

const activeTab = ref<SearchType>('song')
const loading = ref(false)
const error = ref<string | null>(null)

const songResult = ref<SongSearchResult | null>(null)
const playlistResult = ref<SearchPage<PlaylistSearchItem> | null>(null)
const authorResult = ref<SearchPage<AuthorSearchItem> | null>(null)
const albumResult = ref<SearchPage<AlbumSearchItem> | null>(null)

/** 当前关键词：只读，唯一来源是地址栏 */
const query = computed(() => (typeof route.query.q === 'string' ? route.query.q.trim() : ''))

let lastKey = ''
let requestToken = 0
/** 反查单曲时是程序化切 Tab，跳过 Tab watcher 里那次「用旧关键词重搜」 */
let skipTabSearch = false

const songTracks = computed(() => songResult.value?.tracks ?? [])
const resultTotal = computed(() => {
  if (activeTab.value === 'song') return songResult.value?.total ?? 0
  if (activeTab.value === 'special') return playlistResult.value?.total ?? 0
  if (activeTab.value === 'author') return authorResult.value?.total ?? 0
  return albumResult.value?.total ?? 0
})
const hasResult = computed(() => {
  if (activeTab.value === 'song') return songTracks.value.length > 0
  if (activeTab.value === 'special') return (playlistResult.value?.items.length ?? 0) > 0
  if (activeTab.value === 'author') return (authorResult.value?.items.length ?? 0) > 0
  return (albumResult.value?.items.length ?? 0) > 0
})

function clearResults() {
  songResult.value = null
  playlistResult.value = null
  authorResult.value = null
  albumResult.value = null
}

async function performSearch(raw: string, force = false) {
  const keyword = raw.trim()
  if (!keyword) return

  const key = `${activeTab.value}:${keyword}`
  if (!force && key === lastKey && (loading.value || hasResult.value)) return

  lastKey = key
  const token = ++requestToken
  loading.value = true
  error.value = null
  clearResults()

  try {
    if (activeTab.value === 'song') {
      songResult.value = await searchSongs(keyword, { pageSize: 30 })
    } else if (activeTab.value === 'special') {
      playlistResult.value = await searchPlaylists(keyword, { pageSize: 18 })
    } else if (activeTab.value === 'author') {
      authorResult.value = await searchAuthors(keyword, { pageSize: 18 })
    } else {
      albumResult.value = await searchAlbums(keyword, { pageSize: 18 })
    }

    // 只有真的搜到东西才记历史，避免把「零结果」的词记进去
    if (hasResult.value) searchHistory.add(keyword)
  } catch (err) {
    if (token !== requestToken) return
    error.value = err instanceof ApiError ? err.message : '搜索失败，请稍后重试'
  } finally {
    if (token === requestToken) loading.value = false
  }
}

/**
 * 关键词变化（标题栏提交 / 浏览器前进后退 / 歌手专辑反查）即重搜。
 * 没有关键词时回发现页 —— 本页已经没有「初始界面」可展示了。
 */
watch(
  query,
  (value) => {
    if (!value) {
      void router.replace({ name: 'discover' })
      return
    }
    void performSearch(value, true)
  },
  { immediate: true }
)

watch(activeTab, () => {
  error.value = null
  if (skipTabSearch) {
    skipTabSearch = false
    return
  }
  if (query.value) void performSearch(query.value, true)
})

async function playTrack(track: Track, queue: Track[]) {
  await player.play(track, queue)
}

async function playAll() {
  if (songTracks.value.length === 0) return
  await player.play(songTracks.value[0], songTracks.value)
}

function openPlaylist(id: string) {
  void router.push({ name: 'playlist', params: { id } })
}

function retry() {
  if (query.value) void performSearch(query.value, true)
}

/** 歌手 / 专辑没有独立详情页，用名称反查单曲 */
function searchBy(name: string) {
  const next = name.trim()
  if (!next) return

  if (activeTab.value !== 'song') {
    skipTabSearch = true
    activeTab.value = 'song'
  }
  if (query.value === next) {
    void performSearch(next, true)
    return
  }
  void router.replace({ name: 'search', query: { q: next } })
}
</script>

<template>
  <PageShell
    eyebrow="Search"
    :title="query || '搜索'"
    subtitle="按单曲、歌单、歌手、专辑分类查看，换关键词用顶部搜索框。"
  >
    <template #actions>
      <span v-if="resultTotal > 0" class="pill pill--plain">共 {{ resultTotal }} 条</span>
      <button v-if="activeTab === 'song' && songTracks.length > 0" class="brand-button" type="button" @click="playAll">
        <AppIcon name="play" :size="14" />
        播放全部
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
        {{ tab.label }}
      </button>
    </div>

    <p v-if="error" class="alert">
      {{ error }}
      <button class="alert__action" type="button" @click="retry">重试</button>
    </p>

    <!-- 单曲 -->
    <div v-if="activeTab === 'song'" class="panel list">
      <TrackTable
        :tracks="songTracks"
        :loading="loading"
        :skeleton-rows="6"
        :active-hash="player.current?.hash"
        :playing="player.playing"
        @play="playTrack"
      />
      <EmptyState
        v-if="!loading && query && !error && songTracks.length === 0"
        compact
        icon="search"
        :title="`没有找到「${query}」相关的歌曲`"
        description="换个关键词试试。"
      />
    </div>

    <!-- 歌单 -->
    <div v-else-if="activeTab === 'special'">
      <div v-if="loading" class="grid">
        <div v-for="index in 6" :key="index" class="card panel">
          <span class="skeleton card__cover" />
          <span class="skeleton card__line" />
        </div>
      </div>
      <div v-else-if="playlistResult && playlistResult.items.length > 0" class="grid">
        <button
          v-for="item in playlistResult.items"
          :key="item.id"
          class="card panel panel--interactive"
          type="button"
          @click="openPlaylist(item.id)"
        >
          <span class="card__cover">
            <img v-if="item.cover" :src="item.cover" alt="" referrerpolicy="no-referrer" />
            <AppIcon v-else name="disc" :size="26" />
            <span class="card__count tabular">{{ item.count }} 首</span>
          </span>
          <span class="card__name">{{ item.name }}</span>
          <span class="card__meta">{{ item.creator }} · {{ formatCount(item.playCount) }} 播放</span>
        </button>
      </div>
      <div v-else-if="query && !error" class="panel">
        <EmptyState compact icon="disc" title="没有找到相关歌单" description="换个关键词再试试。" />
      </div>
    </div>

    <!-- 歌手 -->
    <div v-else-if="activeTab === 'author'">
      <div v-if="loading" class="grid">
        <div v-for="index in 6" :key="index" class="card panel">
          <span class="skeleton card__cover card__cover--round" />
          <span class="skeleton card__line" />
        </div>
      </div>
      <div v-else-if="authorResult && authorResult.items.length > 0" class="grid">
        <button
          v-for="item in authorResult.items"
          :key="item.id"
          class="card card--author panel panel--interactive"
          type="button"
          @click="searchBy(item.name)"
        >
          <span class="card__cover card__cover--round">
            <img v-if="item.avatar" :src="item.avatar" alt="" referrerpolicy="no-referrer" />
            <AppIcon v-else name="user" :size="26" />
          </span>
          <span class="card__name">{{ item.name }}</span>
          <span class="card__meta">{{ formatCount(item.fans) }} 粉丝 · {{ item.songCount }} 首</span>
        </button>
      </div>
      <div v-else-if="query && !error" class="panel">
        <EmptyState compact icon="user" title="没有找到相关歌手" description="换个关键词再试试。" />
      </div>
    </div>

    <!-- 专辑 -->
    <div v-else>
      <div v-if="loading" class="grid">
        <div v-for="index in 6" :key="index" class="card panel">
          <span class="skeleton card__cover" />
          <span class="skeleton card__line" />
        </div>
      </div>
      <div v-else-if="albumResult && albumResult.items.length > 0" class="grid">
        <button
          v-for="item in albumResult.items"
          :key="item.id"
          class="card panel panel--interactive"
          type="button"
          @click="searchBy(item.name)"
        >
          <span class="card__cover">
            <img v-if="item.cover" :src="item.cover" alt="" referrerpolicy="no-referrer" />
            <AppIcon v-else name="disc" :size="26" />
            <span class="card__count tabular">{{ item.songCount }} 首</span>
          </span>
          <span class="card__name">{{ item.name }}</span>
          <span class="card__meta">{{ item.singer }} · {{ item.publishTime || '—' }}</span>
        </button>
      </div>
      <div v-else-if="query && !error" class="panel">
        <EmptyState compact icon="disc" title="没有找到相关专辑" description="换个关键词再试试。" />
      </div>
    </div>
  </PageShell>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 6px;
  margin: 0 0 16px;
}

.tab {
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

.alert {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  padding: 10px 14px;
  border-radius: var(--r-sm);
  border: 1px solid rgba(248, 113, 113, 0.28);
  background: rgba(248, 113, 113, 0.1);
  font-size: 12px;
  color: var(--err);
}

.alert__action {
  margin-left: auto;
  padding: 3px 12px;
  border-radius: 999px;
  border: 1px solid rgba(248, 113, 113, 0.4);
  color: var(--err);
  font-size: 11px;
}

.list {
  padding: 4px 4px 8px;
}

/* ---------- 卡片网格 ---------- */

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

.card__cover--round {
  border-radius: 50%;
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
</style>
