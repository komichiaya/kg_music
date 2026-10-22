<script setup lang="ts">
/**
 * 全局「选择歌手」弹框
 *
 * 一首歌有多位歌手时，右键「跳转到歌手」无法猜用户想去哪一位，
 * 这里列出所有带 id 的歌手让用户点。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/common/AppIcon.vue'
import { useArtistPickerStore } from '@/stores/artistPicker'
import type { TrackArtist } from '@/types/kugou'

const router = useRouter()
const picker = useArtistPickerStore()

const visible = computed({
  get: () => picker.visible,
  set: (value: boolean) => {
    if (!value) picker.close()
  },
})

function choose(artist: TrackArtist) {
  if (!artist.id) return
  picker.close()
  void router.push({ name: 'artist', params: { id: artist.id } })
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="artist-picker-dialog"
    title="选择歌手"
    width="360px"
    append-to-body
  >
    <p v-if="picker.songName" class="picker-song">{{ picker.songName }}</p>

    <ul class="picker-list">
      <li v-for="(artist, index) in picker.artists" :key="`${artist.id}-${index}`">
        <button class="picker-item" type="button" @click="choose(artist)">
          <span class="picker-item__name">{{ artist.name }}</span>
          <AppIcon name="chevron-right" :size="14" />
        </button>
      </li>
    </ul>
  </el-dialog>
</template>

<style scoped>
.picker-song {
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-list {
  max-height: 288px;
  overflow-y: auto;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border-radius: var(--r-sm);
  font-size: 13.5px;
  color: var(--text-1);
  text-align: left;
  transition: background-color var(--dur-fast) var(--ease);
}

.picker-item:hover {
  background: var(--brand-soft);
}

.picker-item__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-item :deep(svg) {
  color: var(--text-3);
}
</style>

<style>
/* el-dialog 会 teleport 到 body，外壳样式只能写在全局块里，用类名限定作用域 */
.artist-picker-dialog.el-dialog {
  border: 1px solid var(--stroke-strong);
  border-radius: var(--r-lg);
  background: var(--glass-strong);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  box-shadow: var(--shadow-2);
}

.artist-picker-dialog .el-dialog__header {
  padding: 18px 20px 10px;
}

.artist-picker-dialog .el-dialog__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}

.artist-picker-dialog .el-dialog__headerbtn {
  top: 14px;
  right: 12px;
}

.artist-picker-dialog .el-dialog__body {
  padding: 4px 20px 18px;
}
</style>
