<script setup lang="ts">
/**
 * 发现页（文档 §4.4.3）
 *
 * 四块内容：
 * - 私人 FM：/personal/fm 单批推荐，起播即按该批顺序播放，可「换一批」；
 *   「添加」把当前曲目加入用户自选的歌单（见 api/playlist.ts 的 addTrackToPlaylist）
 * - 每日推荐：登录后拉 /everyday/recommend，可整列起播
 * - 排行榜：/rank/list 前 4 个，点击进入榜单详情
 * - 热门搜索：/search/hot 真实热词
 *
 * 数据全部来自 stores/discover.ts：路由切走会卸载本组件，
 * 状态若留在组件里，每次回到发现页都会重新请求（私人 FM 因此会「换一批歌」）。
 */
import { computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import PageShell from '@/components/common/PageShell.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import TrackTable from '@/components/common/TrackTable.vue'
import { useAuthStore } from '@/stores/auth'
import { useDiscoverStore } from '@/stores/discover'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { usePlaylistPickerStore } from '@/stores/playlistPicker'
import { useUpstream } from '@/composables/useUpstream'
import { formatCount } from '@/utils/format'

const router = useRouter()
const auth = useAuthStore()
const discover = useDiscoverStore()
const library = useLibraryStore()
const picker = usePlaylistPickerStore()
const player = usePlayerStore()
const { label: upstreamLabel, tone: upstreamTone } = useUpstream()

const {
  fmTracks,
  fmReason,
  fmLoading,
  fmError,
  fmLead,
  everyday,
  everydayLoading,
  everydayError,
  ranks,
  hotKeywords,
} = storeToRefs(discover)

const fmSubtitle = computed(() => {
  const lead = fmLead.value
  if (!lead) return ''
  const album = lead.album && lead.album !== '未知专辑' ? lead.album : ''
  return album ? `${lead.singer} · ${album}` : lead.singer
})

/** 队列里紧随其后的几首，用于「接下来」预览 */
const fmNextLabel = computed(() =>
  fmTracks.value
    .slice(1, 4)
    .map((track) => track.name)
    .join(' · ')
)

async function playFm(index = 0) {
  const track = fmTracks.value[index]
  if (!track) return
  await player.play(track, fmTracks.value)
}

/** 换一批：显式刷新，这是唯一会让私人 FM 换歌的入口 */
function refreshFm() {
  void discover.loadFm(true)
}

function refreshEveryday() {
  void discover.loadEveryday(true)
}

/**
 * 唤起全局「添加到歌单」弹框
 *
 * 未登录直接引导登录：写歌单必须带账号凭证，没有匿名路径。
 * 弹框挂在 App.vue（全局单例），这里只负责把当前 FM 主打曲交给它。
 */
function openAddDialog() {
  const lead = fmLead.value
  if (!lead) return

  if (!auth.isLoggedIn || !auth.userId) {
    void router.push('/login')
    return
  }

  picker.open(lead)
}

onMounted(() => {
  // 四个 load 都命中缓存即直接返回，切回本页不会再打请求
  void discover.loadFm()
  void discover.loadRanks()
  void discover.loadHot()
  void discover.loadEveryday()
})

// 换账号后歌单列表属于上一个账号，必须重取（否则弹框里会列出别人的歌单）
watch(
  () => auth.userId,
  (userid) => {
    if (userid) void library.loadPlaylists(userid, true)
  }
)

watch(
  () => auth.isLoggedIn,
  (loggedIn) => {
    // 登录态变化会改变 FM 的推荐口径（匿名是随机推荐，登录后按口味），也会决定每日推荐是否可用
    void discover.loadFm(true)
    if (loggedIn) void discover.loadEveryday(true)
    else {
      discover.resetForLogout()
      picker.close()
    }
  }
)

function goSearch(keyword: string) {
  void router.push({ name: 'search', query: { q: keyword } })
}

function openRank(rankid: string) {
  void router.push({ name: 'rank', query: { rankid } })
}

async function playEveryday(index: number) {
  await player.play(everyday.value[index], everyday.value)
}
</script>

<template>
  <PageShell
    eyebrow="Discover"
    title="发现"
    subtitle="私人 FM、每日推荐、排行榜与热门搜索均已接入真实接口，点击即可起播。"
  >
    <template #actions>
      <span class="pill" :class="`pill--${upstreamTone}`">{{ upstreamLabel }}</span>
    </template>

    <section class="fm panel">
      <div class="fm__copy">
        <p class="fm__eyebrow">
          <AppIcon name="disc" :size="13" />
          私人 FM
        </p>

        <template v-if="fmLead">
          <h2 class="fm__title">{{ fmLead.name }}</h2>
          <p class="fm__sub">{{ fmSubtitle }}</p>
          <p class="fm__desc">{{ fmReason || '按你的听歌口味持续换歌。' }}</p>
          <div class="fm__actions">
            <button class="brand-button" type="button" @click="playFm(0)">
              <AppIcon name="play" :size="14" />
              开始收听
            </button>
            <button class="ghost-button" type="button" :disabled="fmLoading" @click="refreshFm">
              <AppIcon name="refresh" :size="14" />
              换一批
            </button>
            <button
              class="ghost-button fm__add"
              type="button"
              :disabled="fmLoading"
              :title="auth.isLoggedIn ? '添加到歌单' : '登录后可添加到歌单'"
              @click="openAddDialog"
            >
              <AppIcon name="plus" :size="15" />
              添加
            </button>
          </div>
          <p v-if="fmError" class="fm__notice">{{ fmError }}</p>
          <p v-if="fmNextLabel" class="fm__next">接下来：{{ fmNextLabel }}</p>
        </template>

        <template v-else-if="fmLoading">
          <h2 class="fm__title fm__title--ghost">正在挑选这一批</h2>
          <p class="fm__desc">私人 FM 每批约 5 首，起播后按顺序播放。</p>
          <div class="fm__actions">
            <span class="skeleton fm__skeleton" />
          </div>
        </template>

        <template v-else>
          <h2 class="fm__title fm__title--ghost">私人 FM 暂时没有取到歌</h2>
          <p class="fm__desc">{{ fmError || '请确认本地服务已启动后重试。' }}</p>
          <div class="fm__actions">
            <button class="ghost-button" type="button" @click="refreshFm">
              <AppIcon name="refresh" :size="14" />
              重新获取
            </button>
          </div>
        </template>
      </div>

      <div class="fm__art" aria-hidden="true">
        <span class="fm__glow" />
        <span class="fm__cover">
          <img v-if="fmLead?.cover" :src="fmLead.cover" alt="" referrerpolicy="no-referrer" />
          <AppIcon v-else name="disc" :size="44" />
        </span>
      </div>
    </section>

    <section class="section">
      <div class="section__head">
        <h3 class="section__title">每日推荐</h3>
        <span class="section__hint">Daily Mix</span>
      </div>

      <div v-if="!auth.isLoggedIn" class="panel">
        <EmptyState
          icon="sparkle"
          title="登录后生成每日推荐"
          description="基于你的听歌偏好每天更新 30 首，登录后自动拉取。"
        >
          <template #action>
            <button class="brand-button" type="button" @click="router.push('/login')">去登录</button>
          </template>
        </EmptyState>
      </div>

      <div v-else-if="everydayError" class="panel">
        <EmptyState icon="activity" title="每日推荐加载失败" :description="everydayError">
          <template #action>
            <button class="ghost-button" type="button" @click="refreshEveryday">重试</button>
          </template>
        </EmptyState>
      </div>

      <div v-else class="panel daily">
        <div v-if="everyday.length > 0" class="daily__head">
          <span class="daily__hint">共 {{ everyday.length }} 首 · 点击任意行起播</span>
          <button class="ghost-link" type="button" @click="playEveryday(0)">
            <AppIcon name="play" :size="13" />
            播放全部
          </button>
        </div>
        <TrackTable
          :tracks="everyday"
          :loading="everydayLoading"
          :skeleton-rows="6"
          :active-hash="player.current?.hash"
          :playing="player.playing"
          @play="playEveryday"
        />
      </div>
    </section>

    <section class="section">
      <div class="section__head">
        <h3 class="section__title">排行榜</h3>
        <button class="ghost-link" type="button" @click="router.push('/rank')">
          全部榜单
          <AppIcon name="chevron-right" :size="13" />
        </button>
      </div>
      <div class="rank-grid">
        <button
          v-for="(rank, index) in ranks"
          :key="rank.rankid"
          class="rank-card panel panel--interactive"
          type="button"
          @click="openRank(rank.rankid)"
        >
          <span class="rank-card__cover">
            <img v-if="rank.cover" :src="rank.cover" alt="" referrerpolicy="no-referrer" />
            <AppIcon v-else name="rank" :size="20" />
            <span class="rank-card__index tabular">0{{ index + 1 }}</span>
          </span>
          <span class="rank-card__meta">
            <span class="rank-card__name">{{ rank.name }}</span>
            <span class="rank-card__desc">
              {{ rank.updateFrequency || '定期更新' }}
              <template v-if="rank.playCount"> · {{ formatCount(rank.playCount) }} 次播放</template>
            </span>
          </span>
          <AppIcon class="rank-card__arrow" name="chevron-right" :size="15" />
        </button>
      </div>
    </section>

    <section class="section">
      <div class="section__head">
        <h3 class="section__title">热门搜索</h3>
        <span class="section__hint">Trending</span>
      </div>
      <div class="chips">
        <button
          v-for="keyword in hotKeywords"
          :key="keyword"
          class="chip"
          type="button"
          @click="goSearch(keyword)"
        >
          {{ keyword }}
        </button>
      </div>
    </section>
  </PageShell>
</template>

<style scoped>
/* ---------- 私人 FM ---------- */

.fm {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(184px, 0.85fr);
  align-items: center;
  gap: 24px;
  padding: 26px 30px;
}

.fm__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--brand-1);
  opacity: 0.9;
}

.fm__title {
  margin-top: 10px;
  font-size: 26px;
  line-height: 1.28;
  font-weight: 600;
  letter-spacing: -0.02em;
  /* 曲名可能很长（含版本号 / 多语言），最多两行后省略，避免把封面挤出可视区 */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.fm__title--ghost {
  font-size: 18px;
  font-weight: 500;
  color: var(--text-2);
  letter-spacing: -0.01em;
}

.fm__sub {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--text-2);
}

.fm__desc {
  margin-top: 10px;
  max-width: 460px;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--text-3);
}

.fm__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.fm__next {
  margin-top: 14px;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 添加按钮：只负责唤起全局弹框，样式与其它 ghost-button 一致，仅收紧图标间距 */
.fm__add {
  gap: 7px;
}

/* 换一批失败时仍保留旧批次，用一行提示说明没换成功，而不是静默 */
.fm__notice {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--err);
}

.fm__skeleton {
  display: block;
  width: 132px;
  height: 38px;
  border-radius: 999px;
}

.fm__art {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fm__glow {
  position: absolute;
  width: 208px;
  height: 208px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--brand-1) 26%, transparent),
    transparent 70%
  );
  filter: blur(22px);
}

.fm__cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 168px;
  height: 168px;
  border-radius: var(--r-lg);
  overflow: hidden;
  color: var(--text-2);
  background: linear-gradient(
    140deg,
    color-mix(in srgb, var(--brand-2) 34%, transparent),
    color-mix(in srgb, var(--brand-1) 16%, transparent)
  );
  box-shadow:
    inset 0 0 0 1px var(--stroke),
    var(--shadow-2);
}

.fm__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (max-width: 1080px) {
  .fm {
    grid-template-columns: 1fr;
    padding: 24px;
  }

  .fm__art {
    display: none;
  }
}

/* ---------- 每日推荐 ---------- */

.daily {
  padding: 4px 4px 8px;
}

.daily__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px 4px;
}

.daily__hint {
  font-size: 11px;
  color: var(--text-3);
}

/* ---------- 排行榜 ---------- */

.rank-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.rank-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: var(--r-md);
  text-align: left;
}

.rank-card__cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  flex: none;
  border-radius: 12px;
  overflow: hidden;
  background: linear-gradient(140deg, rgba(45, 127, 249, 0.5), rgba(124, 92, 255, 0.4));
  color: rgba(6, 18, 26, 0.8);
}

.rank-card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rank-card__index {
  position: absolute;
  left: 4px;
  bottom: 2px;
  font-family: var(--font-mono);
  font-size: 9px;
  color: #fff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7);
}

.rank-card__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.rank-card__name {
  font-size: 13.5px;
  font-weight: 600;
}

.rank-card__desc {
  font-size: 11px;
  color: var(--text-3);
}

.rank-card__arrow {
  margin-left: auto;
  color: var(--text-3);
}

/* ---------- 热门搜索 ---------- */

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
