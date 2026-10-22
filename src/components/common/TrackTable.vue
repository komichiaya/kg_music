<script setup lang="ts">
/**
 * 通用曲目列表
 *
 * 搜索 / 每日推荐 / 榜单 / 歌单 / 历史共用，保证行高、封面尺寸、当前曲高亮一致。
 * 表头：歌手 / 歌曲 / 专辑 / 时长，点击可切换排序（再点一次反向）。
 *
 * 关于 emit 的签名：排序会改变显示顺序，所以**不能**再传下标 ——
 * 父组件手里的原数组顺序和屏幕上的顺序可能不一致，按下标起播会点 A 播 B。
 * 这里直接抛「被点的曲目 + 当前显示顺序（队列）」，父组件原样交给 player.play。
 */
import { computed, ref } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { useContextMenuStore, type ContextMenuItem } from '@/stores/contextMenu'
import { usePlaylistPickerStore } from '@/stores/playlistPicker'
import { formatTime } from '@/utils/format'
import { linkId, useTrackActions } from '@/composables/useTrackActions'
import type { Track } from '@/types/kugou'

type SortKey = 'artist' | 'name' | 'album' | 'duration'
type SortDirection = 'asc' | 'desc'

const menu = useContextMenuStore()
const picker = usePlaylistPickerStore()
const { navItems, goArtist, goAlbum } = useTrackActions()

const props = withDefaults(
  defineProps<{
    tracks: Track[]
    activeHash?: string | null
    playing?: boolean
    loading?: boolean
    skeletonRows?: number
    /** 是否显示专辑列 */
    showAlbum?: boolean
    /** 是否提供「从本歌单移除」（仅歌单详情页、且歌单属于自己时传 true） */
    removable?: boolean
  }>(),
  { activeHash: null, playing: false, loading: false, skeletonRows: 6, showAlbum: true, removable: false }
)

const emit = defineEmits<{
  play: [track: Track, queue: Track[]]
  remove: [track: Track]
}>()

const sortKey = ref<SortKey | null>(null)
const sortDirection = ref<SortDirection>('desc')

/** 中文按拼音、数字按数值比较；同名列用 localeCompare 的稳定性保证不抖动 */
const collator = new Intl.Collator('zh-Hans-CN', { sensitivity: 'base', numeric: true })

/**
 * 三态循环：第一次「高 → 低」，第二次「低 → 高」，第三次恢复原顺序。
 * 恢复原顺序靠 sortKey = null，此时 view 直接返回父组件给的数组。
 */
function toggleSort(key: SortKey) {
  if (sortKey.value !== key) {
    sortKey.value = key
    sortDirection.value = 'desc'
    return
  }
  if (sortDirection.value === 'desc') {
    sortDirection.value = 'asc'
    return
  }
  sortKey.value = null
  sortDirection.value = 'desc'
}

const sortable = (track: Track, key: SortKey): string | number => {
  if (key === 'duration') return track.duration || 0
  if (key === 'artist') return track.singer || ''
  if (key === 'name') return track.name || ''
  return track.album || ''
}

/** 显示顺序 = 排序后的副本；未排序时直接用原数组，避免无谓拷贝 */
const view = computed<Track[]>(() => {
  const key = sortKey.value
  if (!key) return props.tracks
  const factor = sortDirection.value === 'asc' ? 1 : -1
  return [...props.tracks].sort((left, right) => {
    const a = sortable(left, key)
    const b = sortable(right, key)
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * factor
    return collator.compare(String(a), String(b)) * factor
  })
})

function openMenu(event: MouseEvent, track: Track) {
  const items: ContextMenuItem[] = [
    { key: 'add', label: '添加到歌单', icon: 'plus', action: () => picker.open(track) },
  ]

  items.push(...navItems(track))

  if (props.removable) {
    items.push({
      key: 'remove',
      label: '从本歌单移除',
      icon: 'minimize',
      danger: true,
      action: () => emit('remove', track),
    })
  }
  menu.open(event, items)
}

/** 排序箭头：只反映方向，跟具体列无关 */
const sortArrow = computed(() => (sortDirection.value === 'asc' ? '↑' : '↓'))
</script>

<template>
  <div class="track-table">
    <div class="head" :class="{ 'head--no-album': !showAlbum }">
      <button
        class="col-sort"
        :class="{ 'col-sort--active': sortKey === 'name' }"
        type="button"
        @click="toggleSort('name')"
      >
        歌曲<span v-if="sortKey === 'name'" class="col-sort__arrow">{{ sortArrow }}</span>
      </button>
      <button
        class="col-sort"
        :class="{ 'col-sort--active': sortKey === 'artist' }"
        type="button"
        @click="toggleSort('artist')"
      >
        歌手<span v-if="sortKey === 'artist'" class="col-sort__arrow">{{ sortArrow }}</span>
      </button>
      <button
        v-if="showAlbum"
        class="col-sort"
        :class="{ 'col-sort--active': sortKey === 'album' }"
        type="button"
        @click="toggleSort('album')"
      >
        专辑<span v-if="sortKey === 'album'" class="col-sort__arrow">{{ sortArrow }}</span>
      </button>
      <button
        class="col-sort col-sort--end"
        :class="{ 'col-sort--active': sortKey === 'duration' }"
        type="button"
        @click="toggleSort('duration')"
      >
        时长<span v-if="sortKey === 'duration'" class="col-sort__arrow">{{ sortArrow }}</span>
      </button>
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
        v-for="(track, index) in view"
        :key="`${track.hash}-${index}`"
        class="row"
        :class="{ 'row--active': activeHash === track.hash, 'row--no-album': !showAlbum }"
        role="button"
        tabindex="0"
        @click="emit('play', track, view)"
        @keydown.enter.prevent="emit('play', track, view)"
        @keydown.space.prevent="emit('play', track, view)"
        @contextmenu.prevent="openMenu($event, track)"
      >
        <span class="song">
          <span class="song__cover">
            <img v-if="track.cover" :src="track.cover" alt="" referrerpolicy="no-referrer" />
            <AppIcon v-else name="music" :size="15" />
            <span class="song__play"><AppIcon name="play" :size="12" /></span>
            <span v-if="activeHash === track.hash && playing" class="song__eq">
              <span class="bar" />
              <span class="bar bar--2" />
              <span class="bar bar--3" />
            </span>
          </span>
          <span class="song__name">{{ track.name }}</span>
        </span>

        <span class="artist">
          <!-- 多歌手：每个名字单独成链接；缺 id 的歌手只展示 -->
          <template v-if="track.artists && track.artists.length > 0">
            <template v-for="(artist, artistIndex) in track.artists" :key="`${artist.name}-${artistIndex}`">
              <span v-if="artistIndex > 0" class="artist__sep"> / </span>
              <button
                v-if="linkId(artist.id)"
                type="button"
                class="artist__link"
                @click.stop="goArtist(artist.id)"
                @keydown.stop
              >
                {{ artist.name }}
              </button>
              <span v-else>{{ artist.name }}</span>
            </template>
          </template>
          <template v-else-if="linkId(track.artistId)">
            <button
              type="button"
              class="artist__link"
              @click.stop="goArtist(track.artistId)"
              @keydown.stop
            >
              {{ track.singer }}
            </button>
          </template>
          <template v-else>{{ track.singer }}</template>
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
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1.2fr) 64px;
  align-items: center;
  gap: 14px;
}

/* 不展示专辑列时栅格必须同步减一列，否则时长会被顶到专辑列的位置 */
.head--no-album,
.row--no-album {
  grid-template-columns: minmax(0, 2.4fr) minmax(0, 1fr) 64px;
}

@container (max-width: 560px) {
  .head,
  .row,
  .head--no-album,
  .row--no-album {
    grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr) 64px;
    gap: 10px;
  }

  .col-album {
    display: none;
  }
}

.head {
  padding: 14px 16px;
  border-bottom: 1px solid var(--stroke);
}

.col-sort {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 11.5px;
  letter-spacing: 0.06em;
  color: var(--text-3);
  text-align: left;
  transition: color var(--dur-fast) var(--ease);
}

.col-sort:hover {
  color: var(--text-1);
}

.col-sort--active {
  color: var(--brand-1);
}

.col-sort--end {
  justify-content: flex-end;
}

.col-sort__arrow {
  font-size: 10px;
  line-height: 1;
}

.row {
  width: 100%;
  padding: 10px 16px;
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

.artist {
  min-width: 0;
  font-size: 12.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row--active .artist {
  color: var(--text-2);
}

.artist__link {
  transition: color var(--dur-fast) var(--ease);
}

.artist__link:hover {
  color: var(--brand-1);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.artist__sep {
  opacity: 0.65;
}

.song {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.song__cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex: none;
  border-radius: 12px;
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

/* 正在播放：封面盖一层均衡器动画，替代原来的序号列 */
.song__eq {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: rgba(11, 14, 20, 0.6);
}

.row:hover .song__eq {
  opacity: 0;
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

.song__name {
  min-width: 0;
  font-size: 14.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row--active .song__name {
  color: var(--brand-1);
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
  font-size: 12.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-time {
  font-family: var(--font-mono);
  font-size: 11.5px;
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
  width: 48px;
  height: 48px;
  border-radius: 12px;
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
