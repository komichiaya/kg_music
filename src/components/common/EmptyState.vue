<script setup lang="ts">
/**
 * 空状态占位
 *
 * P0 各页面尚无内容接口，统一用这个组件表达「结构已就绪、数据待接入」，
 * 避免每个页面各写一套占位样式。
 */
import AppIcon from '@/components/common/AppIcon.vue'

withDefaults(
  defineProps<{
    icon?: string
    title: string
    description?: string
    compact?: boolean
  }>(),
  { icon: 'music', description: '', compact: false }
)
</script>

<template>
  <div class="empty" :class="{ 'empty--compact': compact }">
    <span class="empty__icon">
      <AppIcon :name="icon" :size="compact ? 20 : 26" />
    </span>
    <p class="empty__title">{{ title }}</p>
    <p v-if="description" class="empty__desc">{{ description }}</p>
    <div v-if="$slots.action" class="empty__action">
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 56px 24px;
  text-align: center;
}

.empty--compact {
  padding: 32px 20px;
}

.empty__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-3);
}

.empty--compact .empty__icon {
  width: 42px;
  height: 42px;
}

.empty__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
}

.empty__desc {
  max-width: 380px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-3);
}

.empty__action {
  margin-top: 6px;
}
</style>
