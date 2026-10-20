<script setup lang="ts">
/**
 * 登录页（文档 §4.1）
 *
 * 三通道：
 * - 扫码：useQrLogin 负责 2s 轮询 + 180s TTL，成功后走 auth.loginByQr
 * - 手机：/login/cellphone，验证码由用户在酷狗官方端获取（上游不下发短信）
 * - 密码：/login，secu_params 由上游解密后回 token
 * 三通道最终都收敛到 auth.completeLogin()：落盘 → 续期 → 拉资料。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useQrLogin } from '@/composables/useQrLogin'
import { ApiError } from '@/api/request'
import AppIcon from '@/components/common/AppIcon.vue'
import type { KugouCredential } from '@/types/kugou'

type LoginTab = 'qr' | 'phone' | 'password'

const TABS: Array<{ key: LoginTab; label: string }> = [
  { key: 'qr', label: '扫码登录' },
  { key: 'phone', label: '手机号' },
  { key: 'password', label: '账号密码' },
]

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const activeTab = ref<LoginTab>('qr')
const phone = ref('')
const code = ref('')
const account = ref('')
const password = ref('')
const submitting = ref(false)
const formError = ref<string | null>(null)
/** welcome=刚进入登录页；expired=token 失效被登出 */
const notice = ref<string | null>(null)

const redirect = computed(() => {
  const value = route.query.redirect
  return typeof value === 'string' && value.startsWith('/') ? value : '/discover'
})

function readableError(error: unknown): string {
  if (error instanceof ApiError && error.message) return error.message
  if (error instanceof Error && error.message) return error.message
  return '操作失败，请稍后重试'
}

function finish() {
  void router.replace(redirect.value)
}

function enterAsGuest() {
  finish()
}

// 解构出顶层 ref，模板中可直接读取（嵌套在对象里的 ref 不会自动解包）
const {
  phase: qrPhase,
  image: qrImage,
  remaining: qrRemaining,
  error: qrError,
  start: startQr,
  stop: stopQr,
  refresh: refreshQr,
} = useQrLogin({ onSuccess: handleQrSuccess })

async function handleQrSuccess(credential: KugouCredential) {
  try {
    await auth.loginByQr(credential)
    finish()
  } catch (error) {
    formError.value = readableError(error)
    refreshQr()
  }
}

const qrCaption = computed(() => {
  switch (qrPhase.value) {
    case 'loading':
      return '正在生成二维码…'
    case 'waiting':
      return `二维码 ${qrRemaining.value}s 后失效`
    case 'scanned':
      return '已扫码，请在手机上确认'
    case 'confirmed':
      return '已确认，正在同步账号…'
    case 'expired':
      return '二维码已过期'
    case 'error':
      return qrError.value ?? '二维码获取失败'
    default:
      return '请使用酷狗 App 扫码登录'
  }
})

const qrBlocked = computed(() => qrPhase.value === 'expired' || qrPhase.value === 'error')

const qrScanning = computed(() => qrPhase.value === 'scanned')

onMounted(() => {
  if (auth.sessionExpired) {
    notice.value = '登录态已失效，请重新登录以继续使用'
    auth.sessionExpired = false
  }
  startQr()
})

onBeforeUnmount(() => {
  stopQr()
})

// 切 Tab 时立即停止轮询，回到扫码页重新取码（旧码可能已被扫或过期）
watch(activeTab, (tab) => {
  formError.value = null
  if (tab === 'qr') startQr()
  else stopQr()
})

async function submitPhone() {
  if (submitting.value) return
  formError.value = null

  const mobile = phone.value.replace(/\D/g, '')
  if (!/^1\d{10}$/.test(mobile)) {
    formError.value = '请输入正确的 11 位手机号'
    return
  }
  if (!code.value.trim()) {
    formError.value = '请输入在酷狗 App 中收到的验证码'
    return
  }

  submitting.value = true
  try {
    await auth.loginByPhone(mobile, code.value.trim())
    finish()
  } catch (error) {
    formError.value = readableError(error)
  } finally {
    submitting.value = false
  }
}

async function submitPassword() {
  if (submitting.value) return
  formError.value = null

  const username = account.value.trim()
  if (!username) {
    formError.value = '请输入酷狗账号或绑定邮箱'
    return
  }
  if (!password.value) {
    formError.value = '请输入登录密码'
    return
  }

  submitting.value = true
  try {
    await auth.loginByPwd(username, password.value)
    finish()
  } catch (error) {
    formError.value = readableError(error)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login">
    <div class="login__grid">
      <section class="intro">
        <div class="intro__brand">
          <span class="brand-mark">
            <span class="brand-mark__bar" />
            <span class="brand-mark__bar brand-mark__bar--tall" />
            <span class="brand-mark__bar" />
          </span>
          <span class="intro__brand-text">KUGO CONCEPT</span>
        </div>

        <h1 class="intro__title">把歌单、歌词<br />与每日签到<br /><span>收进一个窗口</span></h1>
        <p class="intro__desc">
          酷狗音乐概念版桌面播放器。重新设计的暗色界面、逐行与逐字歌词、
          启动即完成的签到链路，都为你安静地运行。
        </p>

        <ul class="intro__features">
          <li><AppIcon name="login" :size="15" /> 扫码 / 手机 / 账号密码三通道</li>
          <li><AppIcon name="check" :size="15" /> 打开应用自动签到并领取一天 VIP</li>
          <li><AppIcon name="lyric" :size="15" /> 侧栏、桌面、全屏三种歌词形态</li>
        </ul>

        <p class="intro__foot">第三方客户端 · 音乐内容与版权归属酷狗音乐</p>
      </section>

      <section class="login__card panel">
        <header class="login__head">
          <h2 class="login__title">登录</h2>
          <p class="login__sub">登录后同步歌单、听歌等级与签到状态</p>
        </header>

        <div class="tabs">
          <button
            v-for="tab in TABS"
            :key="tab.key"
            class="tab"
            :class="{ 'tab--active': activeTab === tab.key }"
            type="button"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>

        <p v-if="notice" class="alert alert--warn">{{ notice }}</p>
        <p v-if="formError" class="alert">{{ formError }}</p>

        <div class="pane">
          <!-- 扫码 -->
          <template v-if="activeTab === 'qr'">
            <div class="qr-wrap">
              <div class="qr" :class="{ 'qr--dim': qrBlocked || qrScanning }">
                <img v-if="qrImage" class="qr__img" :src="qrImage" alt="扫码登录二维码" />
                <AppIcon v-else name="music" :size="34" />

                <div v-if="qrPhase === 'loading'" class="qr__mask">
                  <span class="qr__spinner" />
                </div>

                <div v-else-if="qrBlocked" class="qr__mask qr__mask--solid">
                  <button class="qr__action" type="button" @click="refreshQr()">
                    <AppIcon name="refresh" :size="14" />
                    刷新二维码
                  </button>
                </div>

                <div v-else-if="qrScanning" class="qr__mask">
                  <AppIcon name="check" :size="22" />
                  <span class="qr__mask-text">已扫码</span>
                </div>
              </div>

              <span class="qr__corner qr__corner--tl" />
              <span class="qr__corner qr__corner--tr" />
              <span class="qr__corner qr__corner--bl" />
              <span class="qr__corner qr__corner--br" />
            </div>

            <p class="pane__status" :class="{ 'pane__status--err': qrBlocked }">{{ qrCaption }}</p>
            <p class="pane__hint">打开酷狗 App → 右上角扫一扫，扫码后需在手机端确认。</p>
          </template>

          <!-- 手机号 -->
          <template v-else-if="activeTab === 'phone'">
            <label class="field">
              <span class="field__label">手机号</span>
              <input
                v-model="phone"
                type="tel"
                inputmode="numeric"
                autocomplete="tel"
                placeholder="酷狗账号绑定的手机号"
                spellcheck="false"
                maxlength="11"
              />
            </label>
            <label class="field">
              <span class="field__label">验证码</span>
              <input
                v-model="code"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                placeholder="在酷狗 App 中获取的验证码"
                maxlength="8"
              />
            </label>
            <p class="pane__hint pane__hint--left">
              为避免触发风控，播放器不代发短信：请先在酷狗官方端登录并获取验证码后填入。
            </p>
          </template>

          <!-- 账号密码 -->
          <template v-else>
            <label class="field">
              <span class="field__label">账号 / 邮箱</span>
              <input
                v-model="account"
                type="text"
                autocomplete="username"
                placeholder="酷狗账号或绑定邮箱"
                spellcheck="false"
              />
            </label>
            <label class="field">
              <span class="field__label">密码</span>
              <input
                v-model="password"
                type="password"
                autocomplete="current-password"
                placeholder="登录密码"
                @keyup.enter="submitPassword"
              />
            </label>
            <p class="pane__hint pane__hint--left">
              密码仅用于向本地服务换取 token，不会以明文形式落盘。
            </p>
          </template>
        </div>

        <button
          v-if="activeTab === 'phone'"
          class="brand-button login__submit"
          type="button"
          :disabled="submitting"
          @click="submitPhone"
        >
          {{ submitting ? '登录中…' : '登录' }}
        </button>
        <button
          v-else-if="activeTab === 'password'"
          class="brand-button login__submit"
          type="button"
          :disabled="submitting"
          @click="submitPassword"
        >
          {{ submitting ? '登录中…' : '登录' }}
        </button>
        <p v-else class="pane__tip">扫码成功后自动进入，无需手动确认。</p>

        <div class="login__divider"><span>或</span></div>

        <button class="ghost-button login__guest" type="button" @click="enterAsGuest">
          以游客身份继续
          <AppIcon name="chevron-right" :size="14" />
        </button>

        <p class="login__note">
          凭证使用系统级加密保存在本机，重启免登录；换设备需重新扫码。
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.login {
  position: relative;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 48px;
  overflow-y: auto;
}

.login__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px;
  align-items: center;
  gap: 64px;
  width: min(1180px, 100%);
}

/* ---------- 左侧品牌区 ---------- */

.intro__brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-mark {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2.5px;
  width: 28px;
  height: 28px;
  padding-bottom: 7px;
  border-radius: 9px;
  background: var(--brand-grad);
  box-shadow: 0 8px 22px rgba(45, 127, 249, 0.35);
}

.brand-mark__bar {
  width: 2.5px;
  height: 7px;
  border-radius: 2px;
  background: rgba(6, 18, 26, 0.72);
}

.brand-mark__bar--tall {
  height: 12px;
}

.intro__brand-text {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.26em;
  color: var(--text-2);
}

.intro__title {
  margin-top: 30px;
  font-size: 46px;
  line-height: 1.22;
  font-weight: 600;
  letter-spacing: -0.035em;
  color: var(--text-1);
}

.intro__title span {
  background: linear-gradient(120deg, var(--brand-1), var(--brand-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.intro__desc {
  margin-top: 20px;
  max-width: 440px;
  font-size: 13.5px;
  line-height: 1.9;
  color: var(--text-2);
}

.intro__features {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 28px;
  font-size: 12.5px;
  color: var(--text-2);
}

.intro__features li {
  display: flex;
  align-items: center;
  gap: 10px;
}

.intro__features :deep(.app-icon) {
  color: var(--brand-1);
}

.intro__foot {
  margin-top: 44px;
  font-size: 11px;
  color: var(--text-3);
}

/* ---------- 右侧卡片 ---------- */

.login__card {
  padding: 32px 32px 26px;
  border-radius: var(--r-xl);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0) 40%),
    var(--glass-strong);
  box-shadow: var(--shadow-2);
}

.login__title {
  font-size: 22px;
  letter-spacing: -0.02em;
}

.login__sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-3);
}

.tabs {
  display: flex;
  gap: 4px;
  margin: 22px 0 18px;
  padding: 4px;
  border-radius: 999px;
  border: 1px solid var(--stroke);
  background: rgba(0, 0, 0, 0.18);
}

.tab {
  flex: 1;
  height: 30px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--text-2);
  transition:
    color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.tab--active {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.08);
}

.alert {
  margin-bottom: 12px;
  padding: 9px 12px;
  border-radius: var(--r-sm);
  border: 1px solid rgba(248, 113, 113, 0.28);
  background: rgba(248, 113, 113, 0.1);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--err);
}

.alert--warn {
  border-color: rgba(251, 191, 36, 0.28);
  background: rgba(251, 191, 36, 0.1);
  color: var(--warn);
}

.pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 214px;
}

/* ---------- 二维码 ---------- */

.qr-wrap {
  position: relative;
  align-self: center;
  margin-top: 4px;
}

.qr {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 168px;
  height: 168px;
  border-radius: var(--r-md);
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-3);
  overflow: hidden;
}

.qr__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 6px;
  background: #fff;
  transition: filter var(--dur) var(--ease);
}

.qr--dim .qr__img {
  filter: blur(4px) brightness(0.55);
}

.qr__mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(11, 14, 20, 0.55);
  backdrop-filter: blur(2px);
}

.qr__mask--solid {
  background: rgba(11, 14, 20, 0.82);
}

.qr__mask-text {
  font-size: 11.5px;
  color: var(--text-1);
}

.qr__action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(44, 230, 230, 0.4);
  background: var(--brand-soft);
  font-size: 12px;
  color: var(--brand-1);
  transition: background-color var(--dur-fast) var(--ease);
}

.qr__action:hover {
  background: rgba(44, 230, 230, 0.2);
}

.qr__spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.16);
  border-top-color: var(--brand-1);
  animation: qr-spin 0.9s linear infinite;
}

@keyframes qr-spin {
  to {
    transform: rotate(360deg);
  }
}

.qr__corner {
  position: absolute;
  width: 18px;
  height: 18px;
  border: 2px solid rgba(44, 230, 230, 0.5);
  pointer-events: none;
}

.qr__corner--tl {
  top: -5px;
  left: -5px;
  border-right: none;
  border-bottom: none;
  border-top-left-radius: var(--r-md);
}

.qr__corner--tr {
  top: -5px;
  right: -5px;
  border-left: none;
  border-bottom: none;
  border-top-right-radius: var(--r-md);
}

.qr__corner--bl {
  bottom: -5px;
  left: -5px;
  border-right: none;
  border-top: none;
  border-bottom-left-radius: var(--r-md);
}

.qr__corner--br {
  bottom: -5px;
  right: -5px;
  border-left: none;
  border-top: none;
  border-bottom-right-radius: var(--r-md);
}

.pane__status {
  margin-top: 10px;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-2);
}

.pane__status--err {
  color: var(--err);
}

.pane__hint {
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-3);
  text-align: center;
}

.pane__hint--left {
  text-align: left;
}

.pane__tip {
  margin-top: 14px;
  text-align: center;
  font-size: 11px;
  color: var(--text-3);
}

/* ---------- 表单 ---------- */

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field__label {
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--text-3);
}

.field input {
  height: 40px;
  padding: 0 14px;
  border-radius: var(--r-sm);
  border: 1px solid var(--stroke);
  background: rgba(0, 0, 0, 0.2);
  font-size: 13px;
  color: var(--text-1);
  outline: none;
  transition:
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.field input:focus {
  border-color: rgba(44, 230, 230, 0.42);
  background: rgba(0, 0, 0, 0.28);
}

.field input::placeholder {
  color: var(--text-3);
}

.login__submit {
  width: 100%;
  margin-top: 18px;
}

.login__divider {
  position: relative;
  margin: 18px 0;
  text-align: center;
  font-size: 10.5px;
  color: var(--text-3);
}

.login__divider::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--stroke);
}

.login__divider span {
  position: relative;
  padding: 0 10px;
  background: transparent;
}

.login__guest {
  width: 100%;
}

.login__note {
  margin-top: 16px;
  font-size: 10.5px;
  line-height: 1.7;
  color: var(--text-3);
  text-align: center;
}

@media (max-width: 1024px) {
  .login__grid {
    grid-template-columns: 1fr;
    gap: 36px;
    max-width: 460px;
  }

  .intro__title {
    font-size: 34px;
  }

  .intro__features,
  .intro__foot {
    display: none;
  }
}
</style>
