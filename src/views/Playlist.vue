<script setup lang="ts">
/**
 * 歌单详情（文档 §3.4 / §7.6）
 *
 * 路由参数即 gid（global_collection_id）。上游 `/playlist/track/all` 传 specialid 会 20010，
 * 所以这里只接受 gid，缺失时直接提示而不是猜一个 id。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import PageShell from '@/components/common/PageShell.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import TrackTable from '@/components/common/TrackTable.vue'
import { fetchPlaylistDetail, fetchPlaylistTracks } from '@/api/playlist'
import { ApiError } from '@/api/request'
import { useAuthStore } from '@/stores/auth'
import { usePlayerStore } from '@/stores/player'
import type { PlaylistSummary, Track } from '@/types/kugou'

const route = useRoute()
const auth = useAuthStore()
const player = usePlayerStore()

const gid = computed(() => String(route.params.id ?? ''))
const detail = ref<PlaylistSummary | null>(null)
const tracks = ref<Track[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

let requestToken = 0

function readable(err: unknown): string {
  return err instanceof ApiError ? err.message : '歌单加载失败，请稍后重试'
}

async function load() {
  const id = gid.value
  if (!id) return

  const token = ++requestToken
  loading.value = true
  error.value = null
  detail.value = null
  tracks.value = []

  try {
    const [info, list] = await Promise.all([
      fetchPlaylistDetail(id, auth.userId),
      fetchPlaylistTracks(id, { pageSize: 200 }),
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
watch(gid, () => void load())

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
    eyebrow="Playlist"
    title="歌单"
    :subtitle="detail ? detail.intro || '曲目来自 /playlist/track/all，按 gid 拉取。' : '正在加载歌单信息…'"
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
        <p class="head__eyebrow">歌单</p>
        <h2 class="head__title">{{ detail?.name ?? (loading ? '加载中…' : '未找到歌单') }}</h2>
        <p class="head__desc">
          <template v-if="detail">
            {{ detail.creator }} · {{ detail.count }} 首
            <span v-if="detail.mine" class="head__badge">我的歌单</span>
          </template>
          <template v-else-if="!loading">该 gid 可能已失效，或歌单未公开。</template>
        </p>
        <p class="head__gid tabular">gid {{ gid }}</p>
      </div>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <section class="tracks panel">
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
        title="歌单里还没有歌曲"
        description="换一个歌单，或在酷狗客户端里添加歌曲后重试。"
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

.head__badge {
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid rgba(44, 230, 230, 0.3);
  font-size: 10px;
  color: var(--brand-1);
}

.head__gid {
  margin-top: 8px;
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
