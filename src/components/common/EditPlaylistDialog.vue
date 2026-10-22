<script setup lang="ts">
/**
 * 编辑歌单信息弹框（Element Plus Dialog）
 *
 * 只做 `/playlist/update` 真正支持的字段：名称与简介。
 * 私密开关不在这里 —— 上游这个接口的报文里没有 is_pri（只有 name/intro/sort/tags/pic），
 * 放一个改了不生效的开关比没有更糟。
 *
 * 简介必须一起提交：上游是「不传即写空」的语义，只改名会把简介清空。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { ApiError } from '@/api/request'
import { useAuthStore } from '@/stores/auth'
import { useLibraryStore } from '@/stores/library'
import AppIcon from '@/components/common/AppIcon.vue'
import type { PlaylistSummary } from '@/types/kugou'

const props = defineProps<{
  modelValue: boolean
  /** 待编辑的歌单；关闭后保留引用，避免关闭动画期间内容突然空掉 */
  playlist: PlaylistSummary | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [playlist: PlaylistSummary]
}>()

const auth = useAuthStore()
const library = useLibraryStore()

const name = ref('')
const intro = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)
const inputRef = ref<{ focus: () => void } | null>(null)

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const canSubmit = computed(() => name.value.trim().length > 0 && !submitting.value)

/** 每次打开都用当前歌单内容重置，避免上一次的输入残留 */
watch(
  visible,
  (open) => {
    if (!open) return
    name.value = props.playlist?.name ?? ''
    intro.value = props.playlist?.intro ?? ''
    error.value = null
    submitting.value = false
    void nextTick(() => inputRef.value?.focus())
  },
  // immediate：组件若以「已打开」状态挂载（如复用场景），也要先填好内容
  { immediate: true }
)

function close() {
  if (submitting.value) return
  visible.value = false
}

function readable(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message
  if (cause instanceof Error && cause.message) return cause.message
  return '保存失败，请稍后重试'
}

async function submit() {
  const target = props.playlist
  if (!canSubmit.value || !target) return

  const userid = auth.userId
  if (!userid) {
    error.value = '请先登录后再编辑歌单'
    return
  }

  submitting.value = true
  error.value = null
  try {
    await library.updatePlaylistInfo(userid, target, {
      name: name.value.trim(),
      intro: intro.value.trim(),
    })
    emit('saved', target)
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
    class="edit-playlist-dialog"
    width="400px"
    append-to-body
    :close-on-click-modal="!submitting"
    :close-on-press-escape="!submitting"
    :show-close="!submitting"
  >
    <template #header>
      <div class="edit-head">
        <span class="edit-head__title">编辑歌单</span>
        <span class="edit-head__hint">Edit playlist</span>
      </div>
    </template>

    <label class="edit-field">
      <span class="edit-field__label">歌单名称</span>
      <el-input
        ref="inputRef"
        v-model="name"
        maxlength="40"
        show-word-limit
        placeholder="给歌单起个名字"
        :disabled="submitting"
        @keyup.enter="submit"
      />
    </label>

    <label class="edit-field edit-field--stack">
      <span class="edit-field__label">简介</span>
      <el-input
        v-model="intro"
        type="textarea"
        :rows="3"
        maxlength="100"
        show-word-limit
        resize="none"
        placeholder="一句话描述这个歌单（可留空）"
        :disabled="submitting"
      />
    </label>

    <p v-if="error" class="edit-error">{{ error }}</p>

    <template #footer>
      <div class="edit-actions">
        <button class="ghost-button" type="button" :disabled="submitting" @click="close">取消</button>
        <button class="brand-button" type="button" :disabled="!canSubmit" @click="submit">
          <AppIcon name="check" :size="14" />
          {{ submitting ? '保存中…' : '保存' }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.edit-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.edit-head__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}

.edit-head__hint {
  font-size: 9.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-3);
}

.edit-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.edit-field--stack {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--stroke);
}

.edit-field__label {
  font-size: 12px;
  color: var(--text-2);
}

.edit-error {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  border: 1px solid color-mix(in srgb, var(--err) 30%, transparent);
  background: color-mix(in srgb, var(--err) 10%, transparent);
  font-size: 11.5px;
  color: var(--err);
}

.edit-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
</style>

<style>
/* Dialog 外壳 teleport 到 body，scoped 命中不到，用类名限定作用域 */
.edit-playlist-dialog.el-dialog {
  border: 1px solid var(--stroke-strong);
  border-radius: var(--r-lg);
  background: var(--glass-strong);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  box-shadow: var(--shadow-2);
}

.edit-playlist-dialog .el-dialog__header {
  padding: 18px 20px 8px;
}

.edit-playlist-dialog .el-dialog__headerbtn {
  top: 14px;
  right: 12px;
}

.edit-playlist-dialog .el-dialog__body {
  padding: 6px 20px 16px;
}

.edit-playlist-dialog .el-dialog__footer {
  padding: 0 20px 18px;
}
</style>
