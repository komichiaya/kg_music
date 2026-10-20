<script setup lang="ts">
/**
 * 全局「添加到歌单」弹框（Element Plus Dialog）
 *
 * 为什么用全局弹框而不是按钮下的下拉菜单：
 * - 歌单数量不可控（几十个很常见），下拉在页面滚动容器里会被裁切、也不便于搜索；
 * - 选择器要被多处复用（发现页 / 每日推荐 / 播放栏…），做成挂在 App.vue 上的单例，
 *   调用方只需要 `picker.open(track)`。
 *
 * 数据约束（实测）：
 * - 只列**自己创建**的歌单：收藏来的歌单上游拒写（HTTP 502 + error_code 30205）；
 * - 歌单列表复用 library store 的缓存，避免每开一次弹框打一次 /user/playlist。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { addTrackToPlaylist } from '@/api/playlist'
import { ApiError } from '@/api/request'
import { useAuthStore } from '@/stores/auth'
import { useLibraryStore } from '@/stores/library'
import { usePlaylistPickerStore } from '@/stores/playlistPicker'
import type { PlaylistSummary } from '@/types/kugou'

const auth = useAuthStore()
const library = useLibraryStore()
const picker = usePlaylistPickerStore()

const keyword = ref('')
const addingToListid = ref<string | null>(null)
const status = ref<{ tone: 'ok' | 'err'; text: string } | null>(null)
let closeTimer: number | undefined

/** 可写歌单：自己创建且带 listid（写接口只认 listid） */
const writable = computed(() =>
  library.playlists.filter((item) => item.mine && Boolean(item.listid))
)

const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return writable.value
  return writable.value.filter((item) => item.name.toLowerCase().includes(query))
})

const readOnlyCount = computed(() => library.playlists.filter((item) => !item.mine).length)

const visible = computed({
  get: () => picker.visible,
  set: (value: boolean) => {
    if (!value) picker.close()
  },
})

function clearCloseTimer() {
  if (closeTimer !== undefined) {
    window.clearTimeout(closeTimer)
    closeTimer = undefined
  }
}

/** 每次打开都重置交互状态，并按需补拉歌单列表 */
watch(
  () => picker.visible,
  async (open) => {
    if (!open) {
      clearCloseTimer()
      return
    }

    keyword.value = ''
    status.value = null
    addingToListid.value = null

    if (auth.userId && library.playlists.length === 0) {
      await library.loadPlaylists(auth.userId)
    }
  }
)

onBeforeUnmount(clearCloseTimer)

function readable(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return error instanceof Error && error.message ? error.message : '添加失败，请稍后重试'
}

async function addTo(item: PlaylistSummary) {
  const track = picker.track
  if (!track || !item.listid || addingToListid.value) return

  addingToListid.value = item.listid
  status.value = null
  try {
    await addTrackToPlaylist(item.listid, track)
    library.noteTrackAdded(item.id)
    status.value = { tone: 'ok', text: `已添加到「${item.name}」` }
    // 成功后短暂回显再关闭，避免用户点完看不到结果
    clearCloseTimer()
    closeTimer = window.setTimeout(() => picker.close(), 800)
  } catch (error) {
    status.value = { tone: 'err', text: readable(error) }
  } finally {
    addingToListid.value = null
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="picker-dialog"
    title="添加到歌单"
    width="420px"
    append-to-body
  >
    <p v-if="picker.track" class="picker-track">
      <span class="picker-track__name">{{ picker.track.name }}</span>
      <span class="picker-track__singer">{{ picker.track.singer }}</span>
    </p>

    <el-input
      v-model="keyword"
      placeholder="搜索我的歌单"
      clearable
      :disabled="addingToListid !== null"
    />

    <p v-if="library.loadingPlaylists" class="picker-state">正在加载歌单…</p>
    <p v-else-if="library.playlistError" class="picker-state">{{ library.playlistError }}</p>
    <p v-else-if="writable.length === 0" class="picker-state">还没有可添加的歌单</p>
    <p v-else-if="filtered.length === 0" class="picker-state">没有匹配「{{ keyword }}」的歌单</p>

    <ul v-else class="picker-list">
      <li v-for="item in filtered" :key="item.id">
        <button
          class="picker-item"
          type="button"
          :disabled="addingToListid !== null"
          @click="addTo(item)"
        >
          <span class="picker-item__name">{{ item.name }}</span>
          <span class="picker-item__count tabular">{{ item.count }} 首</span>
          <span v-if="addingToListid === item.listid" class="picker-item__busy">添加中…</span>
        </button>
      </li>
    </ul>

    <p v-if="status" class="picker-status" :class="`picker-status--${status.tone}`">
      {{ status.text }}
    </p>
    <p v-if="readOnlyCount > 0" class="picker-hint">
      另有 {{ readOnlyCount }} 个收藏来的歌单不可添加
    </p>
  </el-dialog>
</template>

<style scoped>
.picker-track {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 12px;
  min-width: 0;
}

.picker-track__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-track__singer {
  flex: none;
  font-size: 11.5px;
  color: var(--text-3);
}

.picker-state {
  padding: 18px 4px 6px;
  font-size: 12.5px;
  color: var(--text-3);
}

.picker-list {
  margin-top: 10px;
  max-height: 288px;
  overflow-y: auto;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border-radius: var(--r-sm);
  font-size: 13px;
  color: var(--text-1);
  text-align: left;
  transition: background-color var(--dur-fast) var(--ease);
}

.picker-item:hover:not(:disabled) {
  background: var(--brand-soft);
}

.picker-item:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.picker-item__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-item__count {
  flex: none;
  font-size: 11px;
  color: var(--text-3);
}

.picker-item__busy {
  flex: none;
  font-size: 10.5px;
  color: var(--brand-1);
}

.picker-status {
  margin-top: 10px;
  font-size: 12px;
}

.picker-status--ok {
  color: var(--brand-1);
}

.picker-status--err {
  color: var(--err);
}

.picker-hint {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--stroke);
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--text-3);
}
</style>

<style>
/*
 * Element Plus 的 Dialog 会 teleport 到 body，且外壳节点不带本组件的 scoped 标记，
 * 所以外壳样式只能写在全局块里，用 .picker-dialog 限定作用域，避免污染其它弹框。
 */
.picker-dialog.el-dialog {
  border: 1px solid var(--stroke-strong);
  border-radius: var(--r-lg);
  background: var(--glass-strong);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  box-shadow: var(--shadow-2);
}

.picker-dialog .el-dialog__header {
  padding: 18px 20px 10px;
}

.picker-dialog .el-dialog__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}

.picker-dialog .el-dialog__headerbtn {
  top: 14px;
  right: 12px;
}

.picker-dialog .el-dialog__body {
  padding: 4px 20px 18px;
}
</style>
