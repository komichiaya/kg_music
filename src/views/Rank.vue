<script setup lang="ts">
/**
 * 排行榜（文档 §3.4）
 *
 * 左侧 /rank/list，右侧 /rank/audio（rankid 分页）。
 * 支持通过 ?rankid= 直达某个榜单（发现页的榜单卡片就带这个参数）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageShell from '@/components/common/PageShell.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import TrackTable from '@/components/common/TrackTable.vue'
import { fetchRankList, fetchRankSongs } from '@/api/content'
import { ApiError } from '@/api/request'
import { usePlayerStore } from '@/stores/player'
import { formatCount } from '@/utils/format'
import type { RankSummary, Track } from '@/types/kugou'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()

const ranks = ref<RankSummary[]>([])
const selectedId = ref('')
const tracks = ref<Track[]>([])
const loadingRanks = ref(false)
const loadingTracks = ref(false)
const error = ref<string | null>(null)

let trackToken = 0

const selected = computed(
  () => ranks.value.find((rank) => rank.rankid === selectedId.value) ?? ranks.value[0] ?? null
)

function readable(err: unknown): string {
  return err instanceof ApiError ? err.message : '加载失败，请稍后重试'
}

async function loadTracks(rankid: string) {
  if (!rankid) return
  const token = ++trackToken
  loadingTracks.value = true
  error.value = null
  try {
    const result = await fetchRankSongs(rankid, { pageSize: 50 })
    if (token !== trackToken) return
    tracks.value = result.tracks
  } catch (err) {
    if (token !== trackToken) return
    tracks.value = []
    error.value = readable(err)
  } finally {
    if (token === trackToken) loadingTracks.value = false
  }
}

async function loadRanks() {
  loadingRanks.value = true
  try {
    ranks.value = await fetchRankList()
    const fromQuery = typeof route.query.rankid === 'string' ? route.query.rankid : ''
    const initial =
      ranks.value.find((rank) => rank.rankid === fromQuery)?.rankid ?? ranks.value[0]?.rankid ?? ''
    selectedId.value = initial
    if (initial) await loadTracks(initial)
  } catch (err) {
    error.value = readable(err)
  } finally {
    loadingRanks.value = false
  }
}

onMounted(loadRanks)

watch(
  () => route.query.rankid,
  (value) => {
    const rankid = typeof value === 'string' ? value : ''
    if (!rankid || rankid === selectedId.value) return
    if (!ranks.value.some((rank) => rank.rankid === rankid)) return
    selectedId.value = rankid
    void loadTracks(rankid)
  }
)

function select(rank: RankSummary) {
  if (rank.rankid === selectedId.value) return
  selectedId.value = rank.rankid
  void router.replace({ name: 'rank', query: { rankid: rank.rankid } })
  void loadTracks(rank.rankid)
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
  <PageShell eyebrow="Charts" title="排行榜" >
    <template #actions>
      <button v-if="tracks.length > 0" class="brand-button" type="button" @click="playAll">
        <AppIcon name="play" :size="14" />
        播放全部
      </button>
    </template>

    <div class="layout">
      <div class="list">
        <template v-if="loadingRanks">
          <div v-for="index in 5" :key="index" class="rank panel rank--skeleton">
            <span class="skeleton rank__cover" />
            <span class="skeleton rank__line" />
          </div>
        </template>

        <button
          v-for="(rank, index) in ranks"
          :key="rank.rankid"
          class="rank panel"
          :class="{ 'rank--active': rank.rankid === selectedId }"
          type="button"
          @click="select(rank)"
        >
          <span class="rank__cover">
            <img v-if="rank.cover" :src="rank.cover" alt="" referrerpolicy="no-referrer" />
            <AppIcon v-else name="rank" :size="18" />
          </span>
          <span class="rank__meta">
            <span class="rank__name">{{ rank.name }}</span>
            <span class="rank__desc">{{ rank.updateFrequency || '定期更新' }}</span>
          </span>
          <span class="rank__no tabular">{{ String(index + 1).padStart(2, '0') }}</span>
        </button>
      </div>

      <div class="detail panel">
        <header class="detail__head">
          <div class="detail__meta">
            <p class="detail__eyebrow">当前榜单</p>
            <h2 class="detail__title">{{ selected?.name ?? '—' }}</h2>
            <p v-if="selected?.playCount" class="detail__sub tabular">
              {{ formatCount(selected.playCount) }} 次播放
            </p>
          </div>
          <span v-if="selected?.updateFrequency" class="pill pill--plain">
            {{ selected.updateFrequency }}更新
          </span>
        </header>

        <p v-if="error" class="detail__error">{{ error }}</p>

        <TrackTable
          :tracks="tracks"
          :loading="loadingTracks"
          :skeleton-rows="8"
          :active-hash="player.current?.hash"
          :playing="player.playing"
          @play="playAt"
        />

        <EmptyState
          v-if="!loadingTracks && tracks.length === 0 && !error"
          compact
          icon="activity"
          title="该榜单暂无曲目"
          description="换一个榜单试试。"
        />
      </div>
    </div>
  </PageShell>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.list {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  max-height: calc(100vh - var(--playerbar-h) - var(--titlebar-h) - 140px);
  overflow-y: auto;
  padding-right: 2px;
}

/* 关键修复：纵向 flex + max-height 时子项默认 flex-shrink:1，
   而卡片自身 overflow:hidden（.panel）又让最小高度保护失效，
   榜单一多（50+ 张卡）所有卡片会被均分压成一条 22px 的窄带。
   必须禁止子项收缩，把溢出交给 overflow-y: auto 滚动。 */
.list > * {
  flex: none;
}

.rank {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  text-align: left;
  transition:
    border-color var(--dur) var(--ease),
    background-color var(--dur) var(--ease);
}

.rank:hover {
  border-color: var(--stroke-strong);
}

.rank--active {
  border-color: rgba(44, 230, 230, 0.36);
  background: linear-gradient(90deg, rgba(44, 230, 230, 0.12), rgba(45, 127, 249, 0.06));
}

.rank--skeleton {
  gap: 12px;
}

.rank__cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(6, 18, 26, 0.78);
}

.rank__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rank__meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.rank__name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rank__desc {
  font-size: 10.5px;
  color: var(--text-3);
}

.rank__no {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-3);
  opacity: 0.6;
}

.rank__line {
  height: 10px;
  flex: 1;
  border-radius: 999px;
}

.detail {
  min-height: 420px;
  padding-bottom: 8px;
}

.detail__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--stroke);
}

.detail__eyebrow {
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-3);
}

.detail__title {
  margin-top: 6px;
  font-size: 19px;
  letter-spacing: -0.01em;
}

.detail__sub {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-3);
}

.detail__error {
  margin: 14px 20px;
  padding: 10px 14px;
  border-radius: var(--r-sm);
  border: 1px solid rgba(248, 113, 113, 0.28);
  background: rgba(248, 113, 113, 0.1);
  font-size: 12px;
  color: var(--err);
}

@media (max-width: 1180px) {
  .layout {
    grid-template-columns: 220px minmax(0, 1fr);
  }
}

@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .list {
    max-height: 260px;
  }
}
</style>
