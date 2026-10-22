<script setup lang="ts">
/**
 * 统一图标组件
 *
 * 采用 24×24、1.6 描边的线性图标集，颜色继承 currentColor。
 * 不引入第三方图标库，避免为几十个图标增加打包体积与风格不一致。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    size?: number | string
    strokeWidth?: number
  }>(),
  { size: 18, strokeWidth: 1.6 }
)

const ICONS: Record<string, string> = {
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.4 8.6-2.1 4.7-4.7 2.1 2.1-4.7z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  rank: '<path d="M5 20v-7M12 20V4M19 20v-5"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.4"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  sliders:
    '<path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9"/><circle cx="15" cy="7.5" r="2"/><circle cx="9" cy="16.5" r="2"/>',
  latin: '<path d="M6.5 18.5 12 5.5l5.5 13"/><path d="M9 13.5h6"/>',
  translate:
    '<path d="M3.5 6.2h8M7.5 3.8v2.4M10.2 6.2c0 4.1-2.9 7.4-6.7 8.8"/><path d="M5.4 9.9c1 2.1 2.9 3.8 5 4.8"/><path d="m12.6 20.4 3.5-8.9 3.5 8.9"/><path d="M13.8 17.4h4.6"/>',
  'chevron-left': '<path d="m14.5 6-5.5 6 5.5 6"/>',
  'chevron-right': '<path d="m9.5 6 5.5 6-5.5 6"/>',
  play: '<path d="M8.5 5.6a1 1 0 0 1 1.5-.87l8 6.4a1 1 0 0 1 0 1.74l-8 6.4a1 1 0 0 1-1.5-.87z" fill="currentColor" stroke="none"/>',
  pause:
    '<rect x="7.5" y="5.5" width="3.4" height="13" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.1" y="5.5" width="3.4" height="13" rx="1.2" fill="currentColor" stroke="none"/>',
  prev: '<path d="M18.5 6.4v11.2a.9.9 0 0 1-1.4.75l-8-5.6a.9.9 0 0 1 0-1.5l8-5.6a.9.9 0 0 1 1.4.75z" fill="currentColor" stroke="none"/><path d="M6 5.5v13"/>',
  next: '<path d="M5.5 6.4v11.2a.9.9 0 0 0 1.4.75l8-5.6a.9.9 0 0 0 0-1.5l-8-5.6a.9.9 0 0 0-1.4.75z" fill="currentColor" stroke="none"/><path d="M18 5.5v13"/>',
  volume:
    '<path d="M4 9.5h3L11.5 6v12L7 14.5H4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6"/><path d="M18 6.5a8 8 0 0 1 0 11"/>',
  'volume-mute':
    '<path d="M4 9.5h3L11.5 6v12L7 14.5H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  repeat:
    '<path d="M4 11V9a3 3 0 0 1 3-3h11"/><path d="m15.5 3.5 2.5 2.5-2.5 2.5"/><path d="M20 13v2a3 3 0 0 1-3 3H6"/><path d="m8.5 20.5-2.5-2.5 2.5-2.5"/>',
  'repeat-one':
    '<path d="M4 11V9a3 3 0 0 1 3-3h11"/><path d="m15.5 3.5 2.5 2.5-2.5 2.5"/><path d="M20 13v2a3 3 0 0 1-3 3H6"/><path d="m8.5 20.5-2.5-2.5 2.5-2.5"/><path d="M12 10.4v3.6"/><path d="M10.9 11.3 12 10.4"/>',
  shuffle:
    '<path d="M4 6.5h4l8 11h4"/><path d="M4 17.5h4l2-2.8"/><path d="M13.8 9.3 17 6.5h3"/><path d="m17 3.5 3 3-3 3"/><path d="m17 14.5 3 3-3 3"/>',
  list: '<path d="M4 7h10M4 12h10M4 17h10"/><circle cx="18.5" cy="7" r="1.2" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="18.5" cy="17" r="1.2" fill="currentColor" stroke="none"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>',
  restore:
    '<rect x="4.5" y="8" width="11" height="11" rx="1.8"/><path d="M8.5 8V6A1.5 1.5 0 0 1 10 4.5h8A1.5 1.5 0 0 1 19.5 6v8a1.5 1.5 0 0 1-1.5 1.5h-1.5"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  'panel-left': '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  refresh: '<path d="M20 11.5A8 8 0 1 0 17.2 17"/><path d="M20 5.5v6h-6"/>',
  music: '<circle cx="7.5" cy="17.5" r="2.8"/><circle cx="18" cy="15.5" r="2.8"/><path d="M10.3 17.5V6.2l10.5-2v11.3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  sparkle: '<path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z"/>',
  login:
    '<path d="M14 4.5h4A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5h-4"/><path d="m10 8 4 4-4 4"/><path d="M14 12H3.5"/>',
  logout:
    '<path d="M10 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h4"/><path d="m16 8 4 4-4 4"/><path d="M20 12H9.5"/>',
  lyric: '<path d="M4.5 7.5h9M4.5 12h15M4.5 16.5h7"/><path d="M19 5.5v4"/>',
  vip: '<path d="m4 8.5 4 2.8 4-5.6 4 5.6 4-2.8-1.6 9.6H5.6z"/>',
  activity: '<path d="M3.5 12.5h4l2.5-6 4 11 2.5-5h4"/>',
  heart:
    '<path d="M12 20s-7.3-4.5-7.3-9.4A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.3 3c0 4.9-7.3 9.4-7.3 9.4z"/>',
  'heart-fill':
    '<path d="M12 20s-7.3-4.5-7.3-9.4A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.3 3c0 4.9-7.3 9.4-7.3 9.4z" fill="currentColor" stroke="none"/>',
  more: '<circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  mini: '<rect x="3.5" y="8.5" width="17" height="7.5" rx="2"/><path d="M7 12h6"/>',
  expand: '<path d="M9 4.5H4.5V9"/><path d="M15 4.5h4.5V9"/><path d="M9 19.5H4.5V15"/><path d="M15 19.5h4.5V15"/>',
}

const markup = computed(() => ICONS[props.name] ?? '')
const pixelSize = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size))
</script>

<template>
  <svg
    class="app-icon"
    viewBox="0 0 24 24"
    :style="{ width: pixelSize, height: pixelSize }"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="markup"
  />
</template>

<style scoped>
.app-icon {
  display: block;
  flex: none;
}
</style>
