<script setup lang="ts">
/**
 * 新建歌单弹框（Element Plus Dialog）
 *
 * 只收集创建所需的最小信息：名称 + 是否私密。
 * 上游 `/playlist/add` 在 type=0 时才接受 is_pri，简介/封面需要创建后再调
 * `/playlist/update`，这里不做，避免多一步失败点。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { ApiError } from '@/api/request'
import { useAuthStore } from '@/stores/auth'
import { useLibraryStore } from '@/stores/library'
import AppIcon from '@/components/common/AppIcon.vue'
import type { PlaylistSummary } from '@/types/kugou'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  created: [playlist: PlaylistSummary | null]
}>()

const auth = useAuthStore()
const library = useLibraryStore()

const name = ref('')
const isPrivate = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)
const inputRef = ref<{ focus: () => void } | null>(null)

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const canSubmit = computed(() => name.value.trim().length > 0 && !submitting.value)

watch(visible, (open) => {
  if (!open) return
  name.value = ''
  isPrivate.value = false
  error.value = null
  submitting.value = false
  void nextTick(() => inputRef.value?.focus())
})

function close() {
  if (submitting.value) return
  visible.value = false
}

function readable(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message
  if (cause instanceof Error && cause.message) return cause.message
  return '创建失败，请稍后重试'
}

async function submit() {
  if (!canSubmit.value) return
  const userid = auth.userId
  if (!userid) {
    error.value = '请先登录后再创建歌单'
    return
  }

  submitting.value = true
  error.value = null
  try {
    const created = await library.createPlaylist(userid, name.value.trim(), {
      private: isPrivate.value,
    })
    emit('created', created)
    visible.value = false
  } catch (cause) {
    error.value = readable(cause)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="create-playlist-dialog"
    width="380px"
    append-to-body
    :close-on-click-modal="!submitting"
    :close-on-press-escape="!submitting"
    :show-close="!submitting"
  >
    <template #header>
      <div class="create-head">
        <span class="create-head__title">新建歌单</span>
        <span class="create-head__hint">New playlist</span>
      </div>
    </template>

    <label class="create-field">
      <span class="create-field__label">歌单名称</span>
      <el-input
        ref="inputRef"
        v-model="name"
        maxlength="40"
        show-word-limit
        placeholder="例如：深夜循环"
        :disabled="submitting"
        @keyup.enter="submit"
      />
    </label>

    <div class="create-row">
      <div class="create-row__copy">
        <p class="create-row__label">私密歌单</p>
        <p class="create-row__desc">仅自己可见，不出现在个人主页。</p>
      </div>
      <el-switch v-model="isPrivate" :disabled="submitting" />
    </div>

    <p v-if="error" class="create-error">{{ error }}</p>

    <template #footer>
      <div class="create-actions">
        <button class="ghost-button" type="button" :disabled="submitting" @click="close">取消</button>
        <button class="brand-button" type="button" :disabled="!canSubmit" @click="submit">
          <AppIcon name="plus" :size="14" />
          {{ submitting ? '创建中…' : '创建歌单' }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.create-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.create-head__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}

.create-head__hint {
  font-size: 9.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-3);
}

.create-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.create-field__label {
  font-size: 12px;
  color: var(--text-2);
}

.create-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--stroke);
}

.create-row__label {
  font-size: 12.5px;
  font-weight: 500;
}

.create-row__desc {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-3);
}

.create-error {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  border: 1px solid color-mix(in srgb, var(--err) 30%, transparent);
  background: color-mix(in srgb, var(--err) 10%, transparent);
  font-size: 11.5px;
  color: var(--err);
}

.create-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
</style>

<style>
/* Dialog 外壳 teleport 到 body，scoped 命中不到，用类名限定作用域 */
.create-playlist-dialog.el-dialog {
  border: 1px solid var(--stroke-strong);
  border-radius: var(--r-lg);
  background: var(--glass-strong);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  box-shadow: var(--shadow-2);
}

.create-playlist-dialog .el-dialog__header {
  padding: 18px 20px 8px;
}

.create-playlist-dialog .el-dialog__headerbtn {
  top: 14px;
  right: 12px;
}

.create-playlist-dialog .el-dialog__body {
  padding: 6px 20px 16px;
}

.create-playlist-dialog .el-dialog__footer {
  padding: 0 20px 18px;
}
</style>
