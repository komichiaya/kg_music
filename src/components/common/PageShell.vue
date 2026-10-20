<script setup lang="ts">
/**
 * 页面骨架：统一标题区、留白节奏与滚动容器
 *
 * 所有业务页都套这一层，保证页面切换时视觉基线一致。
 */
withDefaults(
  defineProps<{
    title: string
    eyebrow?: string
    subtitle?: string
  }>(),
  { eyebrow: '', subtitle: '' }
)
</script>

<template>
  <section class="page">
    <header class="page__head">
      <div class="page__heading">
        <p v-if="eyebrow" class="page__eyebrow">{{ eyebrow }}</p>
        <h1 class="page__title">{{ title }}</h1>
        <p v-if="subtitle" class="page__subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="page__actions">
        <slot name="actions" />
      </div>
    </header>

    <div class="page__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 30px var(--stage-pad) 24px;
}

.page__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 26px;
}

.page__eyebrow {
  margin-bottom: 8px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--brand-1);
  opacity: 0.85;
}

.page__title {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.page__subtitle {
  margin-top: 8px;
  max-width: 560px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-2);
}

.page__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.page__body {
  flex: 1;
  min-height: 0;
}
</style>
