<script setup lang="ts">
/**
 * 通用曲目列表
 *
 * 搜索 / 每日推荐 / 榜单 / 歌单 / 历史共用，保证行高、封面尺寸、当前曲高亮一致。
 * 点击行即整列起播（由父组件决定队列范围）。
 */
import { useRouter } from 'vue-router'
import AppIcon from '@/components/common/AppIcon.vue'
import { formatTime } from '@/utils/format'
import type { Track } from '@/types/kugou'

const router = useRouter()

withDefaults(
  defineProps<{
    tracks: Track[]
    activeHash?: string | null
    playing?: boolean
    loading?: boolean
    skeletonRows?: number
    /** 是否显示专辑列 */
    showAlbum?: boolean
  }>(),
  { activeHash: null, playing: false, loading: false, skeletonRows: 6, showAlbum: true }
)

const emit = defineEmits<{ play: [index: number] }>()

/** 部分来源会把 id 填成 0 / 空串，这类值不能当跳转参数用 */
function linkId(value: string | number | undefined): string | null {
  if (value === undefined || value === null) return null
  const id = String(value).trim()
  return id && id !== '0' ? id : null
}

function goAlbum(track: Track) {
  const id = linkId(track.albumId)
  if (id) void router.push({ name: 'album', params: { id } })
}

function goArtist(track: Track) {
  const id = linkId(track.artistId)
  if (id) void router.push({ name: 'artist', params: { id } })
}
</script>

<template>
  <div class="track-table">
    <div class="head" :class="{ 'head--no-album': !showAlbum }">
      <span class="col-index">#</span>
      <span class="col-song">歌曲</span>
      <span v-if="showAlbum" class="col-album">专辑</span>
      <span class="col-time">时长</span>
    </div>

    <template v-if="loading">
      <div v-for="index in skeletonRows" :key="index" class="skeleton-row">
        <span class="skeleton skeleton-row__cover" />
        <span class="skeleton skeleton-row__line" />
        <span class="skeleton skeleton-row__line skeleton-row__line--short" />
      </div>
    </template>

    <template v-else>
      <!-- 行整体是「起播」按钮，内部还要放专辑 / 歌手跳转，
           所以外层用 div[role=button] 而不是 <button>，避免嵌套交互元素 -->
      <div
        v-for="(track, index) in tracks"
        :key="`${track.hash}-${index}`"
        class="row"
        :class="{ 'row--active': activeHash === track.hash, 'row--no-album': !showAlbum }"
        role="button"
        tabindex="0"
        @click="emit('play', index)"
        @keydown.enter.prevent="emit('play', index)"
        @keydown.space.prevent="emit('play', index)"
      >
        <span class="col-index tabular">
          <span v-if="activeHash === track.hash && playing" class="row__playing">
            <span class="bar" />
            <span class="bar bar--2" />
            <span class="bar bar--3" />
          </span>
          <template v-else>{{ String(index + 1).padStart(2, '0') }}</template>
        </span>

        <span class="song">
          <span class="song__cover">
            <img v-if="track.cover" :src="track.cover" alt="" referrerpolicy="no-referrer" />
            <AppIcon v-else name="music" :size="15" />
            <span class="song__play"><AppIcon name="play" :size="12" /></span>
          </span>
          <span class="song__meta">
            <span class="song__name">{{ track.name }}</span>
            <button
              v-if="linkId(track.artistId)"
              type="button"
              class="song__singer link"
              @click.stop="goArtist(track)"
              @keydown.stop
            >
              {{ track.singer }}
            </button>
            <span v-else class="song__singer">{{ track.singer }}</span>
          </span>
        </span>

        <button
          v-if="showAlbum && linkId(track.albumId)"
          type="button"
          class="col-album album link"
          @click.stop="goAlbum(track)"
          @keydown.stop
        >
          {{ track.album }}
        </button>
        <span v-else-if="showAlbum" class="col-album album">{{ track.album }}</span>
        <span class="col-time tabular">{{ formatTime(track.duration) }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.track-table {
  /* 容器查询：详情区变窄时自动隐藏专辑列，而不是把歌名挤成省略号 */
  container-type: inline-size;
}

.head,
.row {
  display: grid;
  grid-template-columns: 48px minmax(0, 2.4fr) minmax(0, 1.4fr) 72px;
  align-items: center;
  gap: 12px;
}

/* 不展示专辑列时栅格必须同步减一列，否则时长会被顶到专辑列的位置 */
.head--no-album,
.row--no-album {
  grid-template-columns: 48px minmax(0, 1fr) 72px;
}

@container (max-width: 520px) {
  .head,
  .row,
  .head--no-album,
  .row--no-album {
    grid-template-columns: 36px minmax(0, 1fr) 64px;
    gap: 10px;
  }

  .col-album {
    display: none;
  }
}

.head {
  padding: 14px 16px;
  border-bottom: 1px solid var(--stroke);
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--text-3);
}

.row {
  width: 100%;
  padding: 8px 16px;
  text-align: left;
  cursor: pointer;
  border-radius: var(--r-sm);
  transition: background-color var(--dur-fast) var(--ease);
}

.row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.row--active {
  background: linear-gradient(90deg, rgba(44, 230, 230, 0.12), rgba(45, 127, 249, 0.04));
}

.col-index {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-3);
  text-align: center;
}

.row--active .col-index {
  color: var(--brand-1);
}

.row__playing {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 12px;
}

.bar {
  width: 2px;
  height: 5px;
  border-radius: 1px;
  background: var(--brand-1);
  animation: eq 0.9s ease-in-out infinite alternate;
}

.bar--2 {
  height: 9px;
  animation-delay: 0.15s;
}

.bar--3 {
  height: 6px;
  animation-delay: 0.3s;
}

@keyframes eq {
  from {
    transform: scaleY(0.5);
  }
  to {
    transform: scaleY(1.1);
  }
}

.song {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.song__cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 10px;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-3);
  overflow: hidden;
}

.song__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.song__play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(11, 14, 20, 0.55);
  color: #fff;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);
}

.row:hover .song__play {
  opacity: 1;
}

.song__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.song__name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row--active .song__name {
  color: var(--brand-1);
}

.song__singer {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 可跳转的歌手名 / 专辑名：按钮默认居中且不带省略号，这里补齐 */
.link {
  display: block;
  width: 100%;
  max-width: 100%;
  text-align: left;
  transition: color var(--dur-fast) var(--ease);
}

.link:hover {
  color: var(--brand-1);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.album {
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-time {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-3);
  text-align: right;
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
}

.skeleton-row__cover {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  flex: none;
}

.skeleton-row__line {
  height: 10px;
  flex: 1;
  border-radius: 999px;
}

.skeleton-row__line--short {
  max-width: 160px;
}
</style>
