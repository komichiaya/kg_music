<script setup lang="ts">
/**
 * 极光背景层
 *
 * P0 为静态品牌色漂移；P2 起接入「封面主色提取」，由 usePlayer 把主色写入
 * CSS 变量 --cover-1 / --cover-2，图层无需改动即可随曲目变色。
 */
</script>

<template>
  <div class="backdrop" aria-hidden="true">
    <div class="backdrop__base" />
    <div class="backdrop__blob backdrop__blob--a" />
    <div class="backdrop__blob backdrop__blob--b" />
    <div class="backdrop__blob backdrop__blob--c" />
    <div class="backdrop__grid" />
    <div class="backdrop__vignette" />
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background: var(--bg-0);
}

.backdrop__base {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1200px 700px at 12% -10%, rgba(45, 127, 249, 0.18), transparent 62%),
    radial-gradient(900px 620px at 88% 4%, rgba(44, 230, 230, 0.14), transparent 60%),
    linear-gradient(180deg, rgba(11, 14, 20, 0) 40%, rgba(11, 14, 20, 0.85) 100%);
}

:root[data-theme='light'] .backdrop__base {
  background:
    radial-gradient(1200px 700px at 12% -10%, rgba(45, 127, 249, 0.16), transparent 62%),
    radial-gradient(900px 620px at 88% 4%, rgba(15, 180, 196, 0.14), transparent 60%),
    linear-gradient(180deg, rgba(244, 246, 251, 0) 40%, rgba(244, 246, 251, 0.9) 100%);
}

.backdrop__blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.5;
  will-change: transform;
}

.backdrop__blob--a {
  width: 46vw;
  height: 46vw;
  top: -16vw;
  left: -8vw;
  background: radial-gradient(circle at 40% 40%, var(--cover-1, #2d7ff9), transparent 68%);
  animation: aurora-drift 32s var(--ease) infinite alternate;
}

.backdrop__blob--b {
  width: 40vw;
  height: 40vw;
  top: -10vw;
  right: -6vw;
  background: radial-gradient(circle at 55% 45%, var(--cover-2, #2ce6e6), transparent 66%);
  opacity: 0.42;
  animation: aurora-drift-reverse 38s var(--ease) infinite alternate;
}

.backdrop__blob--c {
  width: 52vw;
  height: 34vw;
  bottom: -22vw;
  left: 26vw;
  background: radial-gradient(circle at 50% 50%, var(--cover-3, #7c5cff), transparent 70%);
  opacity: 0.22;
  animation: aurora-drift 44s var(--ease) infinite alternate-reverse;
}

.backdrop__grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(color-mix(in srgb, var(--text-1) 3%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--text-1) 3%, transparent) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: radial-gradient(circle at 50% 0%, rgba(0, 0, 0, 0.55), transparent 72%);
  -webkit-mask-image: radial-gradient(circle at 50% 0%, rgba(0, 0, 0, 0.55), transparent 72%);
}

.backdrop__vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 90% at 50% 10%, transparent 40%, rgba(0, 0, 0, 0.42) 100%);
}

:root[data-theme='light'] .backdrop__vignette {
  background: radial-gradient(120% 90% at 50% 10%, transparent 40%, rgba(15, 23, 42, 0.06) 100%);
}

/* 极简风格：不画光晕 / 网格 / 暗角，只留 --bg-0 的纯色底 */
:root[data-style='minimal'] .backdrop__base,
:root[data-style='minimal'] .backdrop__blob,
:root[data-style='minimal'] .backdrop__grid,
:root[data-style='minimal'] .backdrop__vignette {
  display: none;
}
</style>
