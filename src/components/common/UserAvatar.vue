<script setup lang="ts">
/**
 * 用户头像
 *
 * 酷狗头像走外链 CDN，可能因防盗链或网络失败而空白，
 * 这里统一回退到昵称首字占位，避免出现破图。
 */
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    src?: string | null
    name?: string
    size?: number
  }>(),
  { src: null, name: '', size: 36 }
)

const failed = ref(false)

watch(
  () => props.src,
  () => {
    failed.value = false
  }
)

const showImage = computed(() => Boolean(props.src) && !failed.value)

const initial = computed(() => {
  const text = props.name.trim()
  if (!text) return 'K'
  return Array.from(text)[0].toUpperCase()
})
</script>

<template>
  <span
    class="avatar"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * 0.38)}px`,
    }"
  >
    <img
      v-if="showImage"
      :src="src ?? undefined"
      alt=""
      referrerpolicy="no-referrer"
      @error="failed = true"
    />
    <span v-else>{{ initial }}</span>
  </span>
</template>

<style scoped>
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  border-radius: 50%;
  overflow: hidden;
  background: var(--brand-grad);
  color: #06121a;
  font-weight: 700;
  letter-spacing: 0.02em;
  user-select: none;
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
