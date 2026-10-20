<script setup lang="ts">
/**
 * 搜索页（文档 §3.3）
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

const keyword = ref('')
const activeTab = ref<SearchType>('song')
const loading = ref(false)
const error = ref<string | null>(null)

const songResult = ref<SongSearchResult | null>(null)
const playlistResult = ref<SearchPage<PlaylistSearchItem> | null>(null)
const authorResult = ref<SearchPage<AuthorSearchItem> | null>(null)
const albumResult = ref<SearchPage<AlbumSearchItem> | null>(null)

const hotKeywords = ['夜曲', '周杰伦', '经典老歌', '纯音乐', '粤语金曲', '乐队现场', '睡眠白噪音', '国风']

let lastKey = ''
let lastQuery = ''
let requestToken = 0

const submitted = computed(() => keyword.value.trim())
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
  const query = raw.trim()
  if (!query) {
    clearResults()
    return
  }

  const key = `${activeTab.value}:${query}`
  if (!force && key === lastKey && (loading.value || hasResult.value)) return

  lastKey = key
  lastQuery = query
  const token = ++requestToken
  loading.value = true
  error.value = null
  clearResults()

  try {
    if (activeTab.value === 'song') {
      songResult.value = await searchSongs(query, { pageSize: 30 })
    } else if (activeTab.value === 'special') {
      playlistResult.value = await searchPlaylists(query, { pageSize: 18 })
    } else if (activeTab.value === 'author') {
      authorResult.value = await searchAuthors(query, { pageSize: 18 })
    } else {
      albumResult.value = await searchAlbums(query, { pageSize: 18 })
    }
  } catch (err) {
    if (token !== requestToken) return
    error.value = err instanceof ApiError ? err.message : '搜索失败，请检查本地服务后重试'
  } finally {
    if (token === requestToken) loading.value = false
  }
}

function submit(value?: string) {
  if (typeof value === 'string') keyword.value = value
  const query = keyword.value.trim()
  if (!query) return
  void performSearch(query, true)
  if (route.query.q !== query) {
    void router.replace({ name: 'search', query: { q: query } })
  }
}

watch(
  () => route.query.q,
  (value) => {
    const query = typeof value === 'string' ? value : ''
    keyword.value = query
    if (query) void performSearch(query)
  },
  { immediate: true }
)

watch(activeTab, () => {
  error.value = null
  if (lastQuery) void performSearch(lastQuery, true)
})

async function playTrack(index: number) {
  await player.play(songTracks.value[index], songTracks.value)
}

async function playAll() {
  if (songTracks.value.length === 0) return
  await player.play(songTracks.value[0], songTracks.value)
}

function openPlaylist(id: string) {
  void router.push({ name: 'playlist', params: { id } })
}

/** 歌手 / 专辑没有独立详情页，用名称反查单曲 */
function searchBy(name: string) {
  activeTab.value = 'song'
  submit(name)
}
</script>

<template>
  <PageShell eyebrow="Search" title="搜索" subtitle="单曲、歌单、歌手、专辑四类结果均已接入。">
    <template #actions>
      <span v-if="resultTotal > 0" class="pill pill--plain">共 {{ resultTotal }} 条</span>
      <button v-if="activeTab === 'song' && songTracks.length > 0" class="brand-button" type="button" @click="playAll">
        <AppIcon name="play" :size="14" />
        播放全部
      </button>
    </template>

    <div class="searchbar panel">
      <AppIcon name="search" :size="18" />
      <input
        v-model="keyword"
        type="text"
        placeholder="输入歌曲名、歌手或专辑，回车搜索"
        spellcheck="false"
        @keyup.enter="submit()"
      />
      <button class="brand-button searchbar__submit" type="button" :disabled="loading" @click="submit()">
        {{ loading ? '搜索中…' : '搜索' }}
      </button>
    </div>

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
      <button class="alert__action" type="button" @click="submit()">重试</button>
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
        v-if="!loading && submitted && !error && songTracks.length === 0"
        compact
        icon="search"
        :title="`没有找到「${submitted}」相关的歌曲`"
        description="换个关键词试试，或检查本地服务是否正常运行。"
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
      <div v-else-if="submitted && !error" class="panel">
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
      <div v-else-if="submitted && !error" class="panel">
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
      <div v-else-if="submitted && !error" class="panel">
        <EmptyState compact icon="disc" title="没有找到相关专辑" description="换个关键词再试试。" />
      </div>
    </div>

    <!-- 热词 -->
    <div v-if="!submitted" class="panel hot">
      <div class="hot__head">
        <h3 class="section__title">热门搜索</h3>
        <span class="section__hint">Trending</span>
      </div>
      <div class="chips">
        <button
          v-for="item in hotKeywords"
          :key="item"
          class="chip"
          type="button"
          @click="submit(item)"
        >
          {{ item }}
        </button>
      </div>
    </div>
  </PageShell>
</template>

<style scoped>
.searchbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 8px 8px 18px;
  border-radius: var(--r-lg);
  color: var(--text-3);
}

.searchbar input {
  flex: 1;
  min-width: 0;
  height: 40px;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: var(--text-1);
}

.searchbar input::placeholder {
  color: var(--text-3);
}

.searchbar__submit {
  height: 40px;
  flex: none;
}

.tabs {
  display: flex;
  gap: 6px;
  margin: 22px 0 16px;
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

/* ---------- 热词 ---------- */

.hot {
  margin-top: 18px;
  padding: 8px 8px 18px;
}

.hot__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 16px 14px 12px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 14px 8px;
}

.chip {
  height: 30px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.03);
  font-size: 12.5px;
  color: var(--text-2);
  transition:
    color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.chip:hover {
  color: var(--text-1);
  border-color: rgba(44, 230, 230, 0.4);
  background: var(--brand-soft);
}
</style>
