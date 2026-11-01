<script setup lang="ts">
/**
 * 歌单详情（文档 §3.4 / §7.6）
 *
 * 路由参数即 gid（global_collection_id）。上游 `/playlist/track/all` 传 specialid 会 20010，
 * 所以这里只接受 gid，缺失时直接提示而不是猜一个 id。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import PageShell from '@/components/common/PageShell.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import TrackTable from '@/components/common/TrackTable.vue'
import { fetchPlaylistDetail, fetchPlaylistTracks, removeTrackFromPlaylist } from '@/api/playlist'
import { ApiError } from '@/api/request'
import { useAuthStore } from '@/stores/auth'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import type { PlaylistSummary, Track } from '@/types/kugou'

const route = useRoute()
const auth = useAuthStore()
const library = useLibraryStore()
const player = usePlayerStore()

const gid = computed(() => String(route.params.id ?? ''))
const detail = ref<PlaylistSummary | null>(null)
const tracks = ref<Track[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
/** 移除操作的即时反馈：成功/失败都用它，3.5s 后自动消失 */
const notice = ref<{ tone: 'ok' | 'err'; text: string } | null>(null)
const removing = ref(false)

let requestToken = 0
let noticeTimer: number | undefined

/** 只有自己创建的歌单能改（上游对收藏来的歌单拒写），也才给右键「移出」 */
const canRemove = computed(() => Boolean(detail.value?.mine && detail.value?.listid))

function flash(tone: 'ok' | 'err', text: string) {
  notice.value = { tone, text }
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = null), 3500)
}

onBeforeUnmount(() => window.clearTimeout(noticeTimer))

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

/**
 * 只重拉歌单信息（名称/简介/封面），不动曲目列表。
 *
 * 在别处（右键「编辑歌单信息」）改完封面或改名后，本页的 `detail` 还是旧的，
 * 封面会一直显示改之前那张。走整页 `load()` 会把曲目清空再重排，
 * 视觉上像刷新了一次页面，所以这里只补详情那一半。
 */
async function refreshDetail() {
  const id = gid.value
  if (!id || !detail.value) return
  const token = requestToken
  try {
    const info = await fetchPlaylistDetail(id, auth.userId)
    if (token !== requestToken || !info) return
    detail.value = info
  } catch {
    // 静默失败：页面已有可用数据，不该因为一次后台刷新弹错误
  }
}

watch(
  () => library.revision,
  () => void refreshDetail()
)

async function playAt(track: Track, queue: Track[]) {
  await player.play(track, queue)
}

async function playAll() {
  if (tracks.value.length === 0) return
  await player.play(tracks.value[0], tracks.value)
}

/**
 * 从本歌单移除一首歌。
 *
 * 删除接口只认 fileid，而重复添加同一首会改写 fileid（见 api/playlist.ts 的说明），
 * 所以不能直接用列表里那份数据，必须先重新拉一次曲目、按 hash 找回最新的 fileid。
 * 找不到说明这首歌已经不在歌单里（别处删过），按成功处理更符合预期。
 */
async function removeAt(target: Track) {
  // 列表可能已按表头排序，不能假设屏幕顺序 == 原数组顺序，按 hash 找回下标
  const index = tracks.value.findIndex((item) => item.hash === target.hash)
  const track = index >= 0 ? tracks.value[index] : target
  const info = detail.value
  if (!track || !info?.listid || removing.value) return

  removing.value = true
  notice.value = null
  try {
    const fresh = await fetchPlaylistTracks(gid.value, { pageSize: 200 })
    const target = fresh.tracks.find((item) => item.hash === track.hash && item.fileid)

    if (target?.fileid) {
      await removeTrackFromPlaylist(info.listid, target.fileid)
    }

    tracks.value = tracks.value.filter((_, i) => i !== index)
    detail.value = { ...info, count: Math.max(0, info.count - 1) }
    library.noteTrackRemoved(info.id)
    flash('ok', `已从歌单移除「${track.name}」`)
  } catch (err) {
    flash('err', err instanceof ApiError ? err.message : '移除失败，请稍后重试')
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <PageShell
    eyebrow="Playlist"
    title="歌单"
    :subtitle="detail?.intro ?? ''"
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
          <template v-else-if="!loading">该歌单可能已失效，或未公开。</template>
        </p>
      </div>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <p v-if="notice" class="notice" :class="`notice--${notice.tone}`">{{ notice.text }}</p>

    <section class="tracks panel">
      <TrackTable
        :tracks="tracks"
        :loading="loading"
        :skeleton-rows="8"
        :active-hash="player.current?.hash"
        :playing="player.playing"
        :removable="canRemove"
        @play="playAt"
        @remove="removeAt"
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

.error {
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: var(--r-sm);
  border: 1px solid rgba(248, 113, 113, 0.28);
  background: rgba(248, 113, 113, 0.1);
  font-size: 12px;
  color: var(--err);
}

/* 右键移除的即时反馈：不打断操作，所以用行内提示而不是弹框 */
.notice {
  margin-top: 14px;
  padding: 9px 14px;
  border-radius: var(--r-sm);
  border: 1px solid var(--stroke);
  font-size: 12px;
  color: var(--text-2);
}

.notice--ok {
  border-color: rgba(44, 230, 230, 0.32);
  background: var(--brand-soft);
  color: var(--brand-1);
}

.notice--err {
  border-color: rgba(248, 113, 113, 0.28);
  background: rgba(248, 113, 113, 0.1);
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
