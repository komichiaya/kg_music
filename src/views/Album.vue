<script setup lang="ts">
/**
 * 专辑详情
 *
 * 路由参数即 album_id。详情取 `/album/detail`，曲目取 `/album/songs`（响应在 data.songs[]）。
 * 入口：TrackTable 的专辑列、歌手页的专辑卡片。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageShell from '@/components/common/PageShell.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import TrackTable from '@/components/common/TrackTable.vue'
import { fetchAlbumDetail, fetchAlbumSongs } from '@/api/album'
import { ApiError } from '@/api/request'
import { usePlayerStore } from '@/stores/player'
import type { AlbumDetail, Track } from '@/types/kugou'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()

const albumId = computed(() => String(route.params.id ?? ''))
const detail = ref<AlbumDetail | null>(null)
const tracks = ref<Track[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

let requestToken = 0

function readable(err: unknown): string {
  return err instanceof ApiError ? err.message : '专辑加载失败，请稍后重试'
}

async function load() {
  const id = albumId.value
  if (!id) return

  const token = ++requestToken
  loading.value = true
  error.value = null
  detail.value = null
  tracks.value = []

  try {
    const [info, list] = await Promise.all([
      fetchAlbumDetail(id),
      fetchAlbumSongs(id, { pageSize: 100 }),
    ])
    if (token !== requestToken) return
    detail.value = info
    tracks.value = list.tracks
  } catch (err) {
    if (token !== requestToken) return
    error.value = readable(err)
  } finally {
    if (token === requestToken) loading.value = false
  }
}

onMounted(load)
watch(albumId, () => void load())

function goArtist() {
  const id = detail.value?.authorId
  if (id) void router.push({ name: 'artist', params: { id } })
}

async function playAt(index: number) {
  await player.play(tracks.value[index], tracks.value)
}

async function playAll() {
  if (tracks.value.length === 0) return
  await player.play(tracks.value[0], tracks.value)
}
</script>

<template>
  <PageShell
    eyebrow="Album"
    title="专辑"
    :subtitle="detail ? detail.intro :  '正在加载专辑信息…'"
  >
    <template #actions>
      <button v-if="tracks.length > 0" class="brand-button" type="button" @click="playAll">
        <AppIcon name="play" :size="14" />
        播放全部
      </button>
    </template>

    <section class="head panel">
      <div class="head__cover">
        <img v-if="detail?.cover" :src="detail.cover" alt="" referrerpolicy="no-referrer" />
        <AppIcon v-else name="disc" :size="40" />
      </div>
      <div class="head__meta">
        <p class="head__eyebrow">专辑</p>
        <h2 class="head__title">{{ detail?.name ?? (loading ? '加载中…' : '未找到专辑') }}</h2>
        <p class="head__desc">
          <template v-if="detail">
            <button
              v-if="detail.authorId"
              type="button"
              class="head__author link"
              @click="goArtist"
            >
              {{ detail.author }}
            </button>
            <span v-else>{{ detail.author }}</span>
            <span v-if="detail.publishDate"> · {{ detail.publishDate }}</span>
            <span v-if="tracks.length"> · {{ tracks.length }} 首</span>
            <span v-if="detail.type" class="head__badge">{{ detail.type }}</span>
          </template>
          <template v-else-if="!loading">该 album_id 可能已失效。</template>
        </p>
        <p v-if="detail?.language" class="head__lang">{{ detail.language }}</p>
        <p class="head__gid tabular">album_id {{ albumId }}</p>
      </div>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <section class="tracks panel">
      <!-- 已经在专辑页，不再重复展示专辑列 -->
      <TrackTable
        :tracks="tracks"
        :loading="loading"
        :skeleton-rows="8"
        :show-album="false"
        :active-hash="player.current?.hash"
        :playing="player.playing"
        @play="playAt"
      />
      <EmptyState
        v-if="!loading && !error && tracks.length === 0"
        compact
        icon="music"
        title="这张专辑还没有可播放的曲目"
        description="部分数字专辑需要先在酷狗客户端购买。"
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

.head__cover {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  border-radius: var(--r-lg);
  border: 1px solid var(--stroke);
  background:
    radial-gradient(circle at 30% 20%, rgba(44, 230, 230, 0.24), transparent 60%),
    linear-gradient(140deg, rgba(45, 127, 249, 0.28), rgba(124, 92, 255, 0.18));
  color: var(--text-2);
  overflow: hidden;
}

.head__cover img {
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

.head__desc {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--text-2);
}

.head__author {
  display: inline;
  font-size: 12.5px;
  color: var(--text-1);
}

.head__badge {
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid rgba(44, 230, 230, 0.3);
  font-size: 10px;
  color: var(--brand-1);
}

.head__lang {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--text-3);
}

.head__gid {
  margin-top: 8px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-3);
}

.link {
  transition: color var(--dur-fast) var(--ease);
}

.link:hover {
  color: var(--brand-1);
  text-decoration: underline;
  text-underline-offset: 3px;
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

.tracks {
  margin-top: 20px;
  padding: 4px 4px 12px;
}

@media (max-width: 900px) {
  .head {
    grid-template-columns: 1fr;
  }

  .head__cover {
    max-width: 176px;
  }
}
</style>
