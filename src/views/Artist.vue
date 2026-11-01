<script setup lang="ts">
/**
 * 歌手详情
 *
 * 路由参数即 author_id。详情 `/artist/detail`（**响应无 status 字段**，只能靠 data 判定），
 * 热门单曲 `/artist/audios`、专辑 `/artist/albums`。
 * 入口：TrackTable 的歌手名、专辑页的歌手链接。
 *
 * 关注态：上游没有「是否已关注」查询接口，只能靠 `/user/follow` 的整份列表比对，
 * 因此关注列表放在 follow store 里共享，本页只读它的 `isFollowing(id)`。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageShell from '@/components/common/PageShell.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import TrackTable from '@/components/common/TrackTable.vue'
import { fetchArtistAlbums, fetchArtistDetail, fetchArtistSongs } from '@/api/artist'
import { ApiError } from '@/api/request'
import { useAuthStore } from '@/stores/auth'
import { useFollowStore } from '@/stores/follow'
import { usePlayerStore } from '@/stores/player'
import type { AlbumSummary, ArtistDetail, Track } from '@/types/kugou'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const follow = useFollowStore()
const player = usePlayerStore()

const authorId = computed(() => String(route.params.id ?? ''))
const detail = ref<ArtistDetail | null>(null)
const tracks = ref<Track[]>([])
const albums = ref<AlbumSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const tab = ref<'songs' | 'albums'>('songs')
/** 关注按钮的即时反馈，避免请求往返期间按钮文案抖动 */
const followError = ref<string | null>(null)

let requestToken = 0

const following = computed(() => Boolean(authorId.value) && follow.isFollowing(authorId.value))
const followBusy = computed(() => follow.pending === authorId.value)
/** 未登录时按钮仍可点，但点了先去登录页，不静默失败 */
const followDisabled = computed(() => followBusy.value || !authorId.value)

function readable(err: unknown): string {
  return err instanceof ApiError ? err.message : '歌手信息加载失败，请稍后重试'
}

/** 粉丝数 / 单曲数按中文习惯折算到万 */
function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)} 亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万`
  return String(value)
}

async function load() {
  const id = authorId.value
  if (!id) return

  const token = ++requestToken
  loading.value = true
  error.value = null
  followError.value = null
  detail.value = null
  tracks.value = []
  albums.value = []

  try {
    const [info, songs, albumList] = await Promise.all([
      fetchArtistDetail(id),
      fetchArtistSongs(id, { pageSize: 50 }),
      fetchArtistAlbums(id, { pageSize: 30 }),
    ])
    if (token !== requestToken) return
    detail.value = info
    tracks.value = songs.tracks
    albums.value = albumList
  } catch (err) {
    if (token !== requestToken) return
    error.value = readable(err)
  } finally {
    if (token === requestToken) loading.value = false
  }
}

/**
 * 关注 / 取消关注。
 *
 * 未登录时不弹错，直接带去登录页并回跳本页——「未登录不能关注」是路由级的常识，
 * 比在歌手页提示「请先登录」少一次操作。
 */
async function toggleFollow() {
  if (!authorId.value || followBusy.value) return

  if (!auth.isLoggedIn) {
    void router.push({ name: 'login', query: { redirect: route.fullPath } })
    return
  }

  followError.value = null
  try {
    await follow.toggle(authorId.value, {
      name: detail.value?.name ?? '未知歌手',
      avatar: detail.value?.avatar ?? null,
    })
  } catch (err) {
    followError.value = err instanceof Error ? err.message : '操作失败，请稍后重试'
  }
}

onMounted(() => {
  void load()
  // 关注态要等列表回来才知道，未登录时不拉（会 20010）
  if (auth.isLoggedIn && auth.userId) void follow.load(auth.userId)
})

watch(authorId, () => void load())

// 冷启动补水完成后才有 userId，补拉一次关注列表
watch(
  () => auth.sessionChecked,
  (checked) => {
    if (checked && auth.userId) void follow.load(auth.userId)
  }
)

function openAlbum(id: string) {
  void router.push({ name: 'album', params: { id } })
}

async function playAt(track: Track, queue: Track[]) {
  await player.play(track, queue)
}

async function playAll() {
  if (tracks.value.length === 0) return
  await player.play(tracks.value[0], tracks.value)
}
</script>

<template>
  <PageShell
    eyebrow="Artist"
    title="歌手"
    :subtitle="detail ? detail.intro :  '正在加载歌手信息…'"
  >
    <template #actions>
      <button v-if="tracks.length > 0" class="brand-button" type="button" @click="playAll">
        <AppIcon name="play" :size="14" />
        播放热门
      </button>
    </template>

    <section class="head panel">
      <div class="head__avatar">
        <img v-if="detail?.avatar" :src="detail.avatar" alt="" referrerpolicy="no-referrer" />
        <AppIcon v-else name="user" :size="40" />
      </div>
      <div class="head__meta">
        <p class="head__eyebrow">歌手</p>
        <h2 class="head__title">{{ detail?.name ?? (loading ? '加载中…' : '未找到歌手') }}</h2>
        <ul v-if="detail" class="stats">
          <li class="stat">
            <span class="stat__value tabular">{{ formatCount(detail.fans) }}</span>
            <span class="stat__label">粉丝</span>
          </li>
          <li class="stat">
            <span class="stat__value tabular">{{ formatCount(detail.songCount) }}</span>
            <span class="stat__label">单曲</span>
          </li>
          <li class="stat">
            <span class="stat__value tabular">{{ formatCount(detail.albumCount) }}</span>
            <span class="stat__label">专辑</span>
          </li>
          <li class="stat">
            <span class="stat__value tabular">{{ formatCount(detail.mvCount) }}</span>
            <span class="stat__label">MV</span>
          </li>
        </ul>
        <div v-if="detail" class="head__actions">
          <button
            type="button"
            class="follow-button"
            :class="{ 'follow-button--on': following }"
            :disabled="followDisabled"
            @click="toggleFollow"
          >
            <AppIcon :name="following ? 'check' : 'heart'" :size="14" />
            {{ followBusy ? '处理中…' : following ? '已关注' : '关注' }}
          </button>
          <p v-if="followError" class="head__follow-error">{{ followError }}</p>
        </div>
      </div>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="tabs">
      <button
        type="button"
        class="tab"
        :class="{ 'tab--active': tab === 'songs' }"
        @click="tab = 'songs'"
      >
        热门单曲
      </button>
      <button
        type="button"
        class="tab"
        :class="{ 'tab--active': tab === 'albums' }"
        @click="tab = 'albums'"
      >
        专辑 {{ albums.length ? `(${albums.length})` : '' }}
      </button>
    </div>

    <section v-show="tab === 'songs'" class="tracks panel">
      <TrackTable
        :tracks="tracks"
        :loading="loading"
        :skeleton-rows="8"
        :active-hash="player.current?.hash"
        :playing="player.playing"
        @play="playAt"
      />
      <EmptyState
        v-if="!loading && !error && tracks.length === 0"
        compact
        icon="music"
        title="暂无热门单曲"
        description="该歌手可能还没有开放正版音源。"
      />
    </section>

    <section v-show="tab === 'albums'" class="albums">
      <button
        v-for="album in albums"
        :key="album.id"
        type="button"
        class="card panel panel--interactive"
        @click="openAlbum(album.id)"
      >
        <span class="card__cover">
          <img v-if="album.cover" :src="album.cover" alt="" referrerpolicy="no-referrer" />
          <AppIcon v-else name="disc" :size="24" />
        </span>
        <span class="card__name">{{ album.name }}</span>
        <span class="card__date">{{ album.publishDate || '未知发行时间' }}</span>
      </button>

      <EmptyState
        v-if="!loading && !error && albums.length === 0"
        compact
        icon="disc"
        title="暂无专辑"
        description="换一位歌手看看，或稍后重试。"
      />
    </section>
  </PageShell>
</template>

<style scoped>
.head {
  display: grid;
  grid-template-columns: 176px minmax(0, 1fr);
  gap: 26px;
  padding: 26px;
}

.head__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  border-radius: 50%;
  border: 1px solid var(--stroke);
  background:
    radial-gradient(circle at 30% 20%, rgba(44, 230, 230, 0.24), transparent 60%),
    linear-gradient(140deg, rgba(45, 127, 249, 0.28), rgba(124, 92, 255, 0.18));
  color: var(--text-2);
  overflow: hidden;
}

.head__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.head__meta {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}

.head__eyebrow {
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--brand-1);
}

.head__title {
  margin-top: 8px;
  font-size: 26px;
  letter-spacing: -0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 22px;
  margin-top: 14px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat__value {
  font-size: 15px;
  font-weight: 600;
}

.stat__label {
  font-size: 10.5px;
  color: var(--text-3);
}

.head__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}

/* 关注按钮：未关注用品牌渐变主按钮，已关注降级为描边次级按钮，
   靠形态差异而不是颜色暗示「再点一次会取关」 */
.follow-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 32px;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--brand-grad);
  color: #06121a;
  font-size: 12.5px;
  font-weight: 600;
  transition:
    filter var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.follow-button:hover {
  filter: brightness(1.06);
}

.follow-button:active {
  transform: translateY(1px);
}

.follow-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  filter: none;
}

.follow-button--on {
  background: var(--fill-1);
  border: 1px solid var(--stroke-strong);
  color: var(--text-2);
  font-weight: 500;
}

.follow-button--on:hover {
  border-color: var(--err);
  color: var(--err);
  filter: none;
}

.head__follow-error {
  font-size: 11.5px;
  color: var(--err);
}

.tabs {
  display: flex;
  gap: 8px;
  margin: 20px 0 14px;
}

.tab {
  padding: 6px 16px;
  border-radius: 999px;
  border: 1px solid var(--stroke);
  font-size: 12px;
  color: var(--text-2);
  transition:
    color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.tab:hover {
  color: var(--text-1);
  border-color: var(--stroke-strong);
}

.tab--active {
  color: var(--brand-1);
  border-color: rgba(44, 230, 230, 0.35);
  background: var(--brand-soft);
}

.tracks {
  padding: 4px 4px 12px;
}

.albums {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  text-align: left;
}

.card__cover {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  width: 100%;
  border-radius: var(--r-md);
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-3);
  overflow: hidden;
}

.card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card__name {
  font-size: 12.5px;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.card__date {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-3);
}

.error {
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: var(--r-sm);
  border: 1px solid rgba(248, 113, 113, 0.28);
  background: rgba(248, 113, 113, 0.1);
  font-size: 12px;
  color: var(--err);
}

@media (max-width: 900px) {
  .head {
    grid-template-columns: 1fr;
  }

  .head__avatar {
    max-width: 176px;
  }
}
</style>
