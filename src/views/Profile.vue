<script setup lang="ts">
/**
 * 个人中心
 *
 * P1：资料卡接真实 /user/info（昵称 / 头像 / 等级 / 绑定手机）。
 * P5：完整签到链——会话校验 → 等级查询 → 一天 VIP → 首播上报，
 *     每一步的真实状态与失败原因都在链路卡片中展示，可手动重试。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PageShell from '@/components/common/PageShell.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import { useAuthStore } from '@/stores/auth'
import { useVipStore } from '@/stores/vip'
import { useProfileMetaStore } from '@/stores/profile'
import { useCheckinStore, type CheckinStep } from '@/stores/checkin'

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

const vipExpire = computed(() => meta.vip?.expireAt ?? vip.expireAt ?? null)

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

const STATE_LABEL: Record<CheckinStep['state'], string> = {
  done: '已完成',
  running: '进行中',
  pending: '待执行',
  failed: '失败',
  skipped: '未登录',
}

const STATE_TONE: Record<CheckinStep['state'], string> = {
  done: 'ok',
  running: 'muted',
  pending: 'muted',
  failed: 'err',
  skipped: 'muted',
}

const signinSteps = computed(() =>
  checkin.steps.map((step) => ({
    ...step,
    stateLabel: STATE_LABEL[step.state],
    pillTone: STATE_TONE[step.state],
  }))
)

const claimDisabled = computed(() => vip.claiming || (vip.claimedToday && !vip.failed))

async function claimVip() {
  if (!auth.userId) return
  await vip.claimToday(auth.userId, { remoteCheck: true })
}

async function retryChain() {
  if (refreshing.value || checkin.running) return
  refreshing.value = true
  refreshError.value = null
  try {
    await checkin.retry()
  } catch (error) {
    refreshError.value = error instanceof Error ? error.message : '签到链重试失败'
  } finally {
    refreshing.value = false
  }
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
    subtitle="打开即签到：会话校验 → 等级查询 → 一天 VIP；第一次真实播放会自动上报听歌时长。"
  >
    <template #actions>
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
        <p class="identity__id tabular">userid {{ auth.userId }}</p>
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

    <section class="section">
      <div class="section__head">
        <h3 class="section__title">每日签到链路</h3>
        <span class="section__hint">Auto Sign-in</span>
      </div>
      <div class="chain panel">
        <ol class="chain__list">
          <li v-for="(step, index) in signinSteps" :key="step.id" class="chain__item">
            <span class="chain__index tabular">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="chain__body">
              <span class="chain__title">{{ step.title }}</span>
              <span class="chain__desc">{{ step.desc }}</span>
              <span v-if="step.detail" class="chain__detail" :class="`chain__detail--${step.pillTone}`">
                {{ step.detail }}
              </span>
            </span>
            <span class="pill chain__state" :class="`pill--${step.pillTone}`">{{ step.stateLabel }}</span>
          </li>
        </ol>
        <div class="chain__foot">
          <p class="chain__note" :class="{ 'chain__note--err': checkin.steps.some((s) => s.state === 'failed') }">
            {{ checkin.message }}
          </p>
          <div class="chain__actions">
            <button class="ghost-button" type="button" :disabled="refreshing || checkin.running" @click="retryChain">
              <AppIcon name="refresh" :size="14" />
              {{ checkin.running ? '执行中…' : '重新校验' }}
            </button>
            <button
              class="brand-button"
              type="button"
              :disabled="claimDisabled"
              @click="claimVip"
            >
              <AppIcon name="vip" :size="14" />
              {{ vip.claiming ? '领取中…' : vip.claimedToday ? '今日已领取' : '立即领取一天 VIP' }}
            </button>
          </div>
        </div>
      </div>
    </section>
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

.identity__id {
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-3);
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

.chain {
  padding: 8px 6px 6px;
}

.chain__list {
  display: flex;
  flex-direction: column;
}

.chain__item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--stroke);
}

.chain__item:last-child {
  border-bottom: none;
}

.chain__index {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--brand-1);
  opacity: 0.8;
}

.chain__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.chain__title {
  font-size: 13px;
  font-weight: 600;
}

.chain__desc {
  font-size: 11.5px;
  color: var(--text-3);
}

.chain__detail {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-2);
}

.chain__detail--ok {
  color: var(--ok);
}

.chain__detail--err {
  color: var(--err);
}

.chain__state {
  margin-left: auto;
  flex: none;
}

.chain__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 16px;
  padding: 14px 18px;
  border-top: 1px solid var(--stroke);
}

.chain__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.chain__note {
  font-size: 11.5px;
  color: var(--text-3);
}

.chain__note--err {
  color: var(--err);
}

.chain__foot .brand-button {
  flex: none;
}
</style>
