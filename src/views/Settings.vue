<script setup lang="ts">
/**
 * 设置页（P0 骨架）
 *
 * 已可用：音质 / 播放模式 / 主题 / 桌面歌词开关（本地持久化）、上游状态查看与重启。
 * 系统级项（开机自启、关闭到托盘、全局快捷键）需 Main 介入，P7 打通。
 */
import { onMounted, ref } from 'vue'
import PageShell from '@/components/common/PageShell.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { getBridge } from '@/bridge'
import { useUpstream } from '@/composables/useUpstream'
import { useSettingsStore } from '@/stores/settings'
import { QUALITY_LABEL, PLAY_MODE_LABEL } from '@/stores/player'
import type { AppInfo, PlayMode, SongQuality, ThemeMode, ThemeStyle } from '@/types/kugou'

const settings = useSettingsStore()
const {
  status: upstreamStatus,
  label: upstreamLabel,
  tone: upstreamTone,
  baseUrl,
  detail,
  restart,
  refresh,
  restarting,
} = useUpstream()

const info = ref<AppInfo | null>(null)
const showLog = ref(false)

async function toggleLog() {
  showLog.value = !showLog.value
  if (showLog.value) await refresh()
}

const qualityOptions = (Object.keys(QUALITY_LABEL) as SongQuality[]).map((value) => ({
  value,
  label: QUALITY_LABEL[value],
}))

const modeOptions = (Object.keys(PLAY_MODE_LABEL) as PlayMode[]).map((value) => ({
  value,
  label: PLAY_MODE_LABEL[value],
}))

const themeOptions: Array<{ value: ThemeMode; label: string }> = [
  { value: 'dark', label: '暗色' },
  { value: 'light', label: '亮色' },
  { value: 'system', label: '跟随系统' },
]

const styleOptions: Array<{ value: ThemeStyle; label: string }> = [
  { value: 'aurora', label: '极光渐变' },
  { value: 'minimal', label: '极简' },
]

onMounted(async () => {
  try {
    info.value = (await getBridge()?.app.info()) ?? null
  } catch (error) {
    console.warn('[settings] 获取应用信息失败', error)
  }
})
</script>

<template>
  <PageShell eyebrow="Settings" title="设置" subtitle="偏好即时生效，重启后保留。">
    <div class="stack">
      <!-- 播放 -->
      <section class="card panel">
        <header class="card__head">
          <h3 class="card__title">播放</h3>
          <span class="card__hint">Playback</span>
        </header>

        <div class="row">
          <div class="row__copy">
            <p class="row__label">默认音质</p>
            <p class="row__desc">切换后立即生效，当前曲目会按新音质重新加载。</p>
          </div>
          <el-select v-model="settings.quality" class="control control--select" size="small">
            <el-option v-for="item in qualityOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </div>

        <div class="row">
          <div class="row__copy">
            <p class="row__label">默认播放模式</p>
            <p class="row__desc">顺序 / 单曲循环 / 随机，播放栏可随时切换。</p>
          </div>
          <el-select v-model="settings.playbackMode" class="control control--select" size="small">
            <el-option v-for="item in modeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </div>

        <div class="row">
          <div class="row__copy">
            <p class="row__label">桌面歌词</p>
            <p class="row__desc">置顶透明小窗，逐字跟随播放进度，可自由拖动。</p>
          </div>
          <el-switch v-model="settings.lyricDesktop" />
        </div>
      </section>

      <!-- 外观 -->
      <section class="card panel">
        <header class="card__head">
          <h3 class="card__title">外观</h3>
          <span class="card__hint">Appearance</span>
        </header>

        <div class="row">
          <div class="row__copy">
            <p class="row__label">主题</p>
            <p class="row__desc">暗色为默认基调，亮色为可选跟随。</p>
          </div>
          <div class="segmented">
            <button
              v-for="item in themeOptions"
              :key="item.value"
              class="segmented__item"
              :class="{ 'segmented__item--active': settings.theme === item.value }"
              type="button"
              @click="settings.theme = item.value"
            >
              {{ item.label }}
            </button>
          </div>
        </div>

        <div class="row">
          <div class="row__copy">
            <p class="row__label">主题风格</p>
            <p class="row__desc">极光渐变带动态光晕；极简为纯白 / 纯黑底色。</p>
          </div>
          <div class="segmented">
            <button
              v-for="item in styleOptions"
              :key="item.value"
              class="segmented__item"
              :class="{ 'segmented__item--active': settings.themeStyle === item.value }"
              type="button"
              @click="settings.themeStyle = item.value"
            >
              {{ item.label }}
            </button>
          </div>
        </div>
      </section>

      <!-- 窗口 -->
      <section class="card panel">
        <header class="card__head">
          <h3 class="card__title">窗口与系统</h3>
          <span class="card__hint">Desktop</span>
        </header>

        <div class="row">
          <div class="row__copy">
            <p class="row__label">关闭时最小化到托盘</p>
            <p class="row__desc">关闭窗口时保留播放，避免误关退出。</p>
          </div>
          <el-switch v-model="settings.closeToTray" />
        </div>

        <div class="row">
          <div class="row__copy">
            <p class="row__label">侧栏折叠</p>
            <p class="row__desc">仅保留图标，为大屏留出更多内容空间。</p>
          </div>
          <el-switch v-model="settings.sidebarCollapsed" />
        </div>

        <div class="row">
          <div class="row__copy">
            <p class="row__label">迷你播放器</p>
            <p class="row__desc">380×120 悬浮小窗，只保留封面、进度与三键；双击封面或按 Esc 返回。</p>
          </div>
          <button class="ghost-button" type="button" @click="settings.setMini(true)">
            <AppIcon name="mini" :size="14" />
            进入迷你模式
          </button>
        </div>
      </section>

      <!-- 快捷键 -->
      <section class="card panel">
        <header class="card__head">
          <h3 class="card__title">快捷键</h3>
          <span class="card__hint">Shortcuts</span>
        </header>

        <dl class="about">
          <div class="about__item">
            <dt>播放 / 暂停</dt>
            <dd><kbd>Space</kbd></dd>
          </div>
          <div class="about__item">
            <dt>快退 / 快进 5 秒</dt>
            <dd><kbd>←</kbd> <kbd>→</kbd></dd>
          </div>
          <div class="about__item">
            <dt>上一首 / 下一首</dt>
            <dd><kbd>Ctrl</kbd> + <kbd>←</kbd> <kbd>→</kbd></dd>
          </div>
          <div class="about__item">
            <dt>音量 ±5%</dt>
            <dd><kbd>↑</kbd> <kbd>↓</kbd></dd>
          </div>
          <div class="about__item">
            <dt>静音切换</dt>
            <dd><kbd>M</kbd></dd>
          </div>
          <div class="about__item">
            <dt>退出迷你模式</dt>
            <dd><kbd>Esc</kbd></dd>
          </div>
        </dl>

        <p class="about__note">
          媒体键在窗口未聚焦时也能用；在输入框里打字不会触发上述快捷键。
        </p>
      </section>

      <!-- 本地服务 -->
      <section class="card panel">
        <header class="card__head">
          <h3 class="card__title">本地服务</h3>
          <span class="pill" :class="`pill--${upstreamTone}`">{{ upstreamLabel }}</span>
        </header>

        <div class="row">
          <div class="row__copy">
            <p class="row__label">服务地址</p>
            <p class="row__desc row__desc--mono">{{ baseUrl }}</p>
            <p v-if="detail" class="row__error">{{ detail }}</p>
          </div>
          <button class="ghost-button" type="button" :disabled="restarting" @click="restart()">
            <AppIcon name="refresh" :size="14" />
            {{ restarting ? '重启中…' : '重启服务' }}
          </button>
        </div>

        <div class="row row--log">
          <button class="ghost-link" type="button" @click="toggleLog">
            <AppIcon :name="showLog ? 'chevron-left' : 'chevron-right'" :size="13" />
            {{ showLog ? '收起日志' : '查看运行日志' }}
          </button>
          <pre v-if="showLog" class="log">{{ (upstreamStatus?.logTail ?? []).join('\n') || '暂无日志' }}</pre>
        </div>
      </section>

      <!-- 关于 -->
      <section class="card panel">
        <header class="card__head">
          <h3 class="card__title">关于</h3>
          <span class="card__hint">About</span>
        </header>

        <dl class="about">
          <div class="about__item">
            <dt>应用版本</dt>
            <dd class="tabular">{{ info?.version ?? '—' }}</dd>
          </div>
          <div class="about__item">
            <dt>Electron</dt>
            <dd class="tabular">{{ info?.electron ?? '—' }}</dd>
          </div>
          <div class="about__item">
            <dt>Chromium</dt>
            <dd class="tabular">{{ info?.chrome ?? '—' }}</dd>
          </div>
          <div class="about__item">
            <dt>Node</dt>
            <dd class="tabular">{{ info?.node ?? '—' }}</dd>
          </div>
        </dl>

        <p class="about__note">
          本项目为第三方客户端，音乐内容与版权归酷狗音乐所有。账号凭据仅保存在本机。
        </p>
      </section>
    </div>
  </PageShell>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 860px;
}

.card {
  padding: 6px 22px 8px;
}

.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 0 14px;
}

.card__title {
  font-size: 14px;
  font-weight: 600;
}

.card__hint {
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-3);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 14px 0;
  border-top: 1px solid var(--stroke);
}

.row--log {
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.row__copy {
  min-width: 0;
}

.row__label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
}

.row__desc {
  margin-top: 3px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-3);
}

.row__desc--mono {
  font-family: var(--font-mono);
}

.row__error {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--err);
}

.control--select {
  width: 148px;
  flex: none;
}

.segmented {
  display: inline-flex;
  flex: none;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.03);
}

.segmented__item {
  height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 11.5px;
  color: var(--text-2);
  transition:
    color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.segmented__item--active {
  color: #06121a;
  background: var(--brand-grad);
  font-weight: 600;
}

.log {
  width: 100%;
  max-height: 220px;
  margin: 0;
  padding: 12px 14px;
  overflow: auto;
  border-radius: var(--r-sm);
  border: 1px solid var(--stroke);
  background: rgba(0, 0, 0, 0.28);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-all;
}

.about {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin: 0;
  padding: 14px 0;
  border-top: 1px solid var(--stroke);
}

.about__item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.about__item dt {
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--text-3);
}

.about__item dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12.5px;
}

.about__item kbd {
  display: inline-block;
  padding: 1px 7px;
  border-radius: var(--r-xs);
  border: 1px solid var(--stroke);
  border-bottom-width: 2px;
  background: var(--fill-1);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 17px;
  color: var(--text-2);
}

.about__note {
  padding: 12px 0 16px;
  border-top: 1px solid var(--stroke);
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--text-3);
}
</style>
