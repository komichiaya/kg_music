<script setup lang="ts">
/**
 * 编辑歌单信息弹框（Element Plus Dialog）
 *
 * 只做 `/playlist/update` 真正支持的字段：名称、简介、自定义封面。
 * 私密开关不在这里 —— 上游这个接口的报文里没有 is_pri（只有 name/intro/sort/tags/pic），
 * 放一个改了不生效的开关比没有更糟。
 *
 * 简介必须一起提交：上游是「不传即写空」的语义，只改名会把简介清空。
 * 封面相反：`pic` 不传即保持原值，所以只在用户真的换了图时才带上。
 *
 * 封面是两步操作（见 api/playlist.ts）：选图后立即上传拿 FileName，
 * 保存时把 `custom/<FileName>` 交给 `/playlist/update`。
 * 之所以选完就传而不是保存时一起传：上传失败（格式/体积/网络）要能立刻反馈，
 * 让用户卡在「点了保存然后等很久才报错」的体验更差。
 *
 * 上传前一律过 `prepareCoverImage()`：图床要求宽高 ≥400 且 ≤3MB，
 * 用户随手选的图（手机截图、小头像、相机原图）经常不合规，本地先中心裁成
 * 512×512 JPEG，既满足校验也和界面上的 1:1 展示一致。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { ApiError } from '@/api/request'
import { uploadPlaylistCover } from '@/api/playlist'
import { prepareCoverImage } from '@/utils/image'
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
const fileRef = ref<HTMLInputElement | null>(null)

/** 已上传成功的封面（`custom/<FileName>`），为空表示不改封面 */
const uploadedPic = ref('')
/** 本地预览地址（objectURL），为空表示沿用歌单现有封面 */
const localPreview = ref('')
const uploading = ref(false)
const coverError = ref<string | null>(null)

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const canSubmit = computed(() => name.value.trim().length > 0 && !submitting.value && !uploading.value)

/** 预览优先级：本次选的图 > 已上传的图（理论上不会有）> 歌单现有封面 */
const coverPreview = computed(() => localPreview.value || props.playlist?.cover || '')

function releasePreview() {
  if (localPreview.value) {
    URL.revokeObjectURL(localPreview.value)
    localPreview.value = ''
  }
}

/** 每次打开都用当前歌单内容重置，避免上一次的输入残留 */
watch(
  visible,
  (open) => {
    if (!open) return
    name.value = props.playlist?.name ?? ''
    intro.value = props.playlist?.intro ?? ''
    error.value = null
    coverError.value = null
    submitting.value = false
    uploading.value = false
    uploadedPic.value = ''
    releasePreview()
    void nextTick(() => inputRef.value?.focus())
  },
  // immediate：组件若以「已打开」状态挂载（如复用场景），也要先填好内容
  { immediate: true }
)

function close() {
  if (submitting.value || uploading.value) return
  releasePreview()
  visible.value = false
}

function readable(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message
  if (cause instanceof Error && cause.message) return cause.message
  return '保存失败，请稍后重试'
}

function pickCover() {
  if (submitting.value || uploading.value) return
  fileRef.value?.click()
}

async function onCoverChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 允许重复选同一个文件（否则第二次选同一张不触发 change）
  input.value = ''
  if (!file) return

  coverError.value = null
  error.value = null

  // 先本地预览，再上传 —— 上传慢时用户也能立刻看到自己选的图
  releasePreview()
  localPreview.value = URL.createObjectURL(file)
  uploadedPic.value = ''

  uploading.value = true
  try {
    // 图床硬性要求宽高 ≥400、≤3MB，且界面展示永远是 1:1，
    // 所以先本地中心裁切 + 压缩，避免「原图直传被图床拒」和「显示被裁掉一半」
    const prepared = await prepareCoverImage(file)
    uploadedPic.value = await uploadPlaylistCover(prepared)
  } catch (cause) {
    // 上传失败就退回原封面，避免用户以为已经换好了
    releasePreview()
    coverError.value = readable(cause)
  } finally {
    uploading.value = false
  }
}

/** 放弃本次选的封面，恢复歌单现有封面 */
function resetCover() {
  if (uploading.value || submitting.value) return
  releasePreview()
  uploadedPic.value = ''
  coverError.value = null
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
      // 只在真的上传过新图时才带 pic；否则不传，上游保持原封面
      pic: uploadedPic.value || undefined,
    })
    releasePreview()
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
    width="440px"
    append-to-body
    :close-on-click-modal="!submitting && !uploading"
    :close-on-press-escape="!submitting && !uploading"
    :show-close="!submitting && !uploading"
  >
    <template #header>
      <div class="edit-head">
        <span class="edit-head__title">编辑歌单</span>
        <span class="edit-head__hint">Edit playlist</span>
      </div>
    </template>

    <div class="edit-cover">
      <button
        class="edit-cover__frame"
        type="button"
        :disabled="submitting || uploading"
        :title="coverPreview ? '更换封面' : '上传封面'"
        @click="pickCover"
      >
        <img v-if="coverPreview" :src="coverPreview" alt="" referrerpolicy="no-referrer" />
        <AppIcon v-else name="disc" :size="34" />
        <span class="edit-cover__mask">
          <AppIcon name="plus" :size="16" />
          <span>{{ uploading ? '上传中…' : '更换封面' }}</span>
        </span>
      </button>

      <div class="edit-cover__side">
        <p class="edit-cover__title">歌单封面</p>
        <p class="edit-cover__hint">
          JPG / PNG / WebP，选好后自动裁成正方形并压缩。
        </p>
        <div class="edit-cover__actions">
          <button class="ghost-button ghost-button--sm" type="button" :disabled="submitting || uploading" @click="pickCover">
            {{ coverPreview ? '重新选择' : '选择图片' }}
          </button>
          <button
            v-if="uploadedPic"
            class="ghost-button ghost-button--sm"
            type="button"
            :disabled="submitting || uploading"
            @click="resetCover"
          >
            撤销
          </button>
        </div>
        <p v-if="coverError" class="edit-cover__error">{{ coverError }}</p>
      </div>

      <input
        ref="fileRef"
        class="edit-cover__input"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        @change="onCoverChange"
      />
    </div>

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

/* 封面区：左边方图 + 右边说明与操作 */
.edit-cover {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--stroke);
}

.edit-cover__frame {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 92px;
  height: 92px;
  padding: 0;
  border: 1px solid var(--stroke);
  border-radius: var(--r-md);
  background:
    radial-gradient(circle at 30% 20%, rgba(44, 230, 230, 0.24), transparent 60%),
    linear-gradient(140deg, rgba(45, 127, 249, 0.28), rgba(124, 92, 255, 0.18));
  color: var(--text-2);
  overflow: hidden;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease);
}

.edit-cover__frame:hover:not(:disabled) {
  border-color: var(--stroke-strong);
}

.edit-cover__frame:disabled {
  cursor: not-allowed;
}

.edit-cover__frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 悬停遮罩：用 opacity 而不是 display，避免按钮尺寸抖动 */
.edit-cover__mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: rgba(6, 10, 18, 0.66);
  font-size: 10.5px;
  color: #fff;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);
}

.edit-cover__frame:hover .edit-cover__mask,
.edit-cover__frame:focus-visible .edit-cover__mask {
  opacity: 1;
}

/* 上传中常驻显示，否则用户看不到进度 */
.edit-cover__frame:disabled .edit-cover__mask {
  opacity: 1;
}

.edit-cover__side {
  min-width: 0;
}

.edit-cover__title {
  font-size: 12px;
  color: var(--text-2);
}

.edit-cover__hint {
  margin-top: 5px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-3);
}

.edit-cover__actions {
  display: flex;
  gap: 8px;
  margin-top: 9px;
}

/* 封面区空间有限，用小一号的按钮；全局 .ghost-button 是 38px 高 */
.ghost-button--sm {
  height: 30px;
  padding: 0 14px;
  font-size: 12px;
}

.edit-cover__error {
  margin-top: 7px;
  font-size: 11px;
  color: var(--err);
}

/* 真正的文件选择器：隐藏但保留在布局外，不能 display:none（部分环境不弹窗） */
.edit-cover__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
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
