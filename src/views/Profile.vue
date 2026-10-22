<script setup lang="ts">
/**
 * 个人中心
 *
 * 资料卡接真实 /user/info（昵称 / 头像 / 等级 / 绑定手机），
 * 统计区展示今日签到、会员状态、听歌等级与累计时长。
 *
 * 签到链本身在 App.vue 里按「会话校验 → 等级查询 → 一天 VIP → 首播上报」自动跑，
 * 本页只展示状态，不再铺一张逐步执行明细的卡片。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PageShell from '@/components/common/PageShell.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import { useAuthStore } from '@/stores/auth'
import { useVipStore } from '@/stores/vip'
import { useProfileMetaStore } from '@/stores/profile'
import { useCheckinStore } from '@/stores/checkin'
import { formatDateTime } from '@/utils/format'

const router = useRouter()
const auth = useAuthStore()
const vip = useVipStore()
const meta = useProfileMetaStore()
const checkin = useCheckinStore()

const refreshing = ref(false)
const refreshError = ref<string | null>(null)

const levelLabel = computed(() => {
  const level = meta.level ?? auth.profile?.level
  return level ? `Lv.${level}` : 'Lv. —'
})

const vipLabel = computed(() => {
  if (meta.vip?.isVip) return 'VIP 生效中'
  return auth.vipActive ? 'VIP 生效中' : 'VIP —'
})

/** 上游给的是时间戳或 ISO 串，统一转成 2026-10-22 这样的展示格式；无效值返回 null，整行不渲染 */
const vipExpire = computed(() => formatDateTime(meta.vip?.expireAt ?? vip.expireAt))

const mobileLabel = computed(() => auth.profile?.mobile ?? null)

const signinLabel = computed(() => {
  if (checkin.signedIn) return '今日已签到'
  if (checkin.running || auth.hydrating) return '签到中…'
  return '待签到'
})

const stats = computed(() => [
  {
    key: 'signin',
    label: '今日签到',
    value: signinLabel.value,
    icon: 'check',
    tone: checkin.signedIn ? 'ok' : checkin.running ? 'muted' : 'warn',
  },
  { key: 'vip', label: '一天 VIP', value: vip.statusLabel, icon: 'vip', tone: vip.tone },
  { key: 'level', label: '听歌等级', value: levelLabel.value, icon: 'activity', tone: 'muted' },
  {
    key: 'minutes',
    label: '累计听歌',
    value: meta.totalMinutes !== null ? `${meta.totalMinutes} 分钟` : '— 分钟',
    icon: 'music',
    tone: 'muted',
  },
])

const claimDisabled = computed(() => vip.claiming || (vip.claimedToday && !vip.failed))

async function claimVip() {
  if (!auth.userId) return
  await vip.claimToday(auth.userId, { remoteCheck: true })
}

async function refreshProfile() {
  if (refreshing.value) return
  refreshing.value = true
  refreshError.value = null
  try {
    await auth.refreshProfile()
    await checkin.run({ force: true })
  } catch (error) {
    refreshError.value = error instanceof Error ? error.message : '资料刷新失败'
  } finally {
    refreshing.value = false
  }
}

async function logout() {
  await auth.logout()
  void router.push('/discover')
}

onMounted(() => {
  if (auth.isLoggedIn) void meta.load()
})

// 会话校验通过（冷启动补水完成）后再拉等级与会员信息
watch(
  () => auth.sessionChecked,
  (checked) => {
    if (checked) void meta.load()
  }
)
</script>

<template>
  <PageShell
    eyebrow="Profile"
    title="个人中心"
    subtitle="每天首次打开自动签到，可领取一天 VIP。"
  >
    <template #actions>
      <button
        v-if="!vip.claimedToday"
        class="ghost-button"
        type="button"
        :disabled="claimDisabled"
        @click="claimVip"
      >
        <AppIcon name="vip" :size="14" />
        {{ vip.claiming ? '领取中…' : '领取一天 VIP' }}
      </button>
      <button class="ghost-button" type="button" :disabled="refreshing" @click="refreshProfile">
        <AppIcon name="refresh" :size="14" />
        {{ refreshing ? '同步中…' : '刷新资料' }}
      </button>
      <button class="ghost-button" type="button" @click="logout">
        <AppIcon name="logout" :size="14" />
        退出登录
      </button>
    </template>

    <p v-if="refreshError" class="identity-error">{{ refreshError }}</p>

    <section class="identity panel">
      <UserAvatar :src="auth.profile?.avatar" :name="auth.displayName" :size="72" />
      <div class="identity__meta">
        <h2 class="identity__name">{{ auth.displayName }}</h2>
        <div class="identity__badges">
          <span class="pill" :class="(meta.vip?.isVip || auth.vipActive) ? 'pill--warn' : 'pill--muted'">{{ vipLabel }}</span>
          <span class="pill" :class="`pill--${vip.tone}`">{{ vip.statusLabel }}</span>
          <span class="pill pill--plain">{{ levelLabel }}</span>
          <span v-if="mobileLabel" class="pill pill--muted tabular">{{ mobileLabel }}</span>
        </div>
        <p v-if="vipExpire" class="identity__expire tabular">VIP 到期：{{ vipExpire }}</p>
      </div>
      <div class="identity__status">
        <span class="identity__status-label">今日状态</span>
        <span class="identity__status-value" :class="{ 'identity__status-value--ok': checkin.signedIn }">
          {{ signinLabel }}
        </span>
      </div>
    </section>

    <div class="stats">
      <article v-for="stat in stats" :key="stat.key" class="stat panel">
        <span class="stat__icon" :class="`stat__icon--${stat.tone}`">
          <AppIcon :name="stat.icon" :size="16" />
        </span>
        <span class="stat__label">{{ stat.label }}</span>
        <span class="stat__value">{{ stat.value }}</span>
      </article>
    </div>
  </PageShell>
</template>

<style scoped>
.identity {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 24px 26px;
}

.identity-error {
  margin-bottom: 12px;
  padding: 9px 14px;
  border-radius: var(--r-sm);
  border: 1px solid rgba(248, 113, 113, 0.28);
  background: rgba(248, 113, 113, 0.1);
  font-size: 11.5px;
  color: var(--err);
}

.identity__meta {
  min-width: 0;
}

.identity__name {
  font-size: 20px;
  letter-spacing: -0.01em;
}

.identity__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.identity__status {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  margin-left: auto;
}

.identity__status-label {
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-3);
}

.identity__status-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--warn);
}

.identity__status-value--ok {
  color: var(--ok);
}

.identity__expire {
  margin-top: 8px;
  font-size: 10.5px;
  color: var(--text-3);
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 18px;
  border-radius: var(--r-md);
}

.stat__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-2);
}

.stat__icon--warn {
  color: var(--warn);
  background: rgba(251, 191, 36, 0.1);
}

.stat__icon--ok {
  color: var(--ok);
  background: rgba(52, 211, 153, 0.12);
}

.stat__icon--err {
  color: var(--err);
  background: rgba(248, 113, 113, 0.12);
}

.stat__icon--muted {
  color: var(--text-3);
}

.stat__label {
  font-size: 11.5px;
  color: var(--text-3);
}

.stat__value {
  font-size: 15px;
  font-weight: 600;
}

</style>
