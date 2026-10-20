/**
 * 每日签到链（文档 §4.3）
 *
 * 上游没有独立的「签到」端点，播放器把签到定义为登录/启动后的一条动作链：
 *   1. 会话校验   /login/token + /user/info（由 auth.hydrate 完成）
 *   2. 等级查询   /user/grade/info
 *   3. 领取一天 VIP /youth/day/vip（幂等，见 vip store）
 *   4. 首播上报   /user/listen/report（CSCC start → end + 等级同步）
 *
 * 幂等策略：
 * - 前 3 步由各自 store 保证幂等，本 store 只负责按顺序编排，任一步失败不阻塞其余步骤。
 * - 第 4 步按「账号 + 日期」只上报一次：当日已上报则后续播放不再触发 CSCC，
 *   避免重复累计听歌时长（上游明确要求勿重复上报）。
 *
 * 失败一律只提示，不抛给登录/播放流程（验收要求「失败不阻塞播放」）。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { reportPlayEnd, reportPlayStart } from '@/api/report'
import { todayString } from '@/api/youth'
import { useAuthStore } from '@/stores/auth'
import { useProfileMetaStore } from '@/stores/profile'
import { useVipStore } from '@/stores/vip'
import { ApiError } from '@/api/request'
import { formatTime } from '@/utils/format'
import type { Track } from '@/types/kugou'

const STORAGE_KEY = 'kugou.concept.checkin.v1'
/** 少于该时长的播放不产生 end 事件，也不计入签到（避免误点、试听前奏） */
const MIN_REPORT_SECONDS = 5

export type CheckinStepState = 'done' | 'running' | 'pending' | 'failed' | 'skipped'
type StepTone = 'ok' | 'warn' | 'err' | 'muted'

interface PlaybackRecord {
  date: string
  state: 'idle' | 'started' | 'done' | 'failed'
  seconds: number
  message: string | null
  mixsongid?: string
  updatedAt: number
}

type CheckinStorage = Record<string, PlaybackRecord>

export interface CheckinStep {
  id: 'session' | 'grade' | 'vip' | 'playback'
  title: string
  desc: string
  state: CheckinStepState
  tone: StepTone
  detail: string | null
}

function emptyRecord(): PlaybackRecord {
  return { date: '', state: 'idle', seconds: 0, message: null, updatedAt: 0 }
}

function readStorage(): CheckinStorage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as CheckinStorage
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStorage(storage: CheckinStorage) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storage))
  } catch {
    // 配额受限时静默失败，不影响本次会话
  }
}

function readable(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'AUTH_INVALID' || error.code === 20002 || error.code === 51002) {
      return '登录态已失效，请重新登录后再上报'
    }
    return error.message || '上报失败'
  }
  if (error instanceof Error && error.message) return error.message
  return '上报失败，稍后自动重试'
}

export const useCheckinStore = defineStore('checkin', () => {
  const running = ref(false)
  const playback = ref<PlaybackRecord>(emptyRecord())
  const lastError = ref<string | null>(null)
  let activeUserId: string | null = null
  /** 当前这次播放的上报会话（内存态，不持久化） */
  let session: { mixsongid: string; seconds: number } | null = null

  const auth = () => useAuthStore()
  const meta = () => useProfileMetaStore()
  const vip = () => useVipStore()

  const today = computed(() => todayString())

  const playbackTone = computed<StepTone>(() => {
    switch (playback.value.state) {
      case 'done':
        return 'ok'
      case 'failed':
        return 'err'
      case 'started':
        return 'muted'
      default:
        return 'muted'
    }
  })

  /** 签到完成 = 会话校验 + 等级查询 + 一天 VIP 三步落地（首播上报是额外动作） */
  const signedIn = computed(
    () => auth().sessionChecked && Boolean(meta().grade) && vip().claimedToday
  )

  const steps = computed<CheckinStep[]>(() => {
    const a = auth()
    const m = meta()
    const v = vip()
    const record = playback.value

    const sessionState: CheckinStepState = a.sessionChecked
      ? 'done'
      : a.hydrating || running.value
        ? 'running'
        : a.isLoggedIn
          ? 'pending'
          : 'skipped'
    const gradeState: CheckinStepState = m.grade
      ? 'done'
      : m.loading
        ? 'running'
        : m.error
          ? 'failed'
          : 'pending'
    const vipState: CheckinStepState = v.claiming
      ? 'running'
      : v.claimedToday
        ? 'done'
        : v.failed
          ? 'failed'
          : 'pending'
    const playbackState: CheckinStepState =
      record.state === 'done'
        ? 'done'
        : record.state === 'started'
          ? 'running'
          : record.state === 'failed'
            ? 'failed'
            : 'pending'

    const level = m.level ?? a.profile?.level ?? null
    const minutes = m.totalMinutes

    return [
      {
        id: 'session',
        title: '会话校验',
        desc: '/login/token 续期 + /user/info 拉取资料',
        state: sessionState,
        tone: sessionState === 'done' ? 'ok' : 'muted',
        detail:
          sessionState === 'done'
            ? `${a.displayName} · 资料已同步`
            : sessionState === 'skipped'
              ? '未登录，签到链未启动'
              : null,
      },
      {
        id: 'grade',
        title: '等级查询',
        desc: '/user/grade/info 查询模式（无 d_sec）',
        state: gradeState,
        tone: gradeState === 'done' ? 'ok' : gradeState === 'failed' ? 'err' : 'muted',
        detail:
          gradeState === 'done' && level !== null
            ? `Lv.${level}${minutes !== null ? ` · 累计 ${minutes} 分钟` : ''}`
            : gradeState === 'failed'
              ? m.error
              : null,
      },
      {
        id: 'vip',
        title: '领取一天 VIP',
        desc: `/youth/day/vip?receive_day=${today.value}，按日期幂等`,
        state: vipState,
        tone: vipState === 'done' ? 'ok' : vipState === 'failed' ? 'err' : 'muted',
        detail: vipState === 'done' ? v.message : vipState === 'failed' ? v.message : null,
      },
      {
        id: 'playback',
        title: '首播上报',
        desc: '/user/listen/report 触发 CSCC，结束事件同步等级',
        state: playbackState,
        tone: playbackTone.value,
        detail:
          playbackState === 'done'
            ? (record.message ?? `已上报 ${formatTime(record.seconds)}，听歌时长已同步`)
            : playbackState === 'running'
              ? '播放中，结束后自动上报并同步等级'
              : playbackState === 'failed'
                ? record.message
                : '播放任意歌曲即自动上报（每日一次）',
      },
    ]
  })

  const message = computed(() => {
    if (lastError.value) return lastError.value
    const failed = steps.value.find((step) => step.state === 'failed')
    if (failed) return `${failed.title}失败：${failed.detail ?? '请稍后重试'}`
    if (signedIn.value) {
      return playback.value.state === 'done'
        ? '今日签到与首播上报均已完成，听歌时长已同步。'
        : '今日签到已完成；首播上报会在第一次真实播放后自动完成。'
    }
    return '签到任一步失败仅提示，不阻塞登录与播放。'
  })

  function syncUser(userid: string) {
    if (activeUserId === userid) return
    activeUserId = userid
    session = null
    const record = readStorage()[userid]
    if (!record || record.date !== todayString()) {
      playback.value = emptyRecord()
      return
    }
    // 上次进程在播放中途退出：start 已发出但没有 end，允许今天重新走一次
    playback.value =
      record.state === 'started'
        ? { ...record, state: 'idle', message: null }
        : { ...record }
  }

  function persistRecord(next: PlaybackRecord) {
    playback.value = next
    const userid = activeUserId
    if (!userid) return
    const storage = readStorage()
    storage[userid] = next
    writeStorage(storage)
  }

  function setError(text: string | null) {
    lastError.value = text
  }

  /**
   * 执行签到链。可重复调用，内部按各步幂等收敛。
   * @param force 忽略「今日已完成」短路（手动重试 / 刷新资料时使用）
   */
  async function run(options: { force?: boolean } = {}) {
    const a = auth()
    const userid = a.userId
    if (!a.isLoggedIn || !userid) return
    if (running.value) return
    if (!options.force && signedIn.value) {
      syncUser(userid)
      return
    }

    syncUser(userid)
    running.value = true
    setError(null)

    try {
      if (!a.sessionChecked) await a.hydrate()
      if (!a.sessionChecked) {
        setError('会话校验未通过，签到链暂停（上游未就绪或网络异常）')
        return
      }

      await meta().load(true)
      if (!meta().grade) {
        setError(meta().error ?? '等级查询失败，可稍后重试')
      }

      // VIP 失败只记录在 vip store，不阻断链路
      await vip().claimToday(userid, { remoteCheck: true })
    } catch (error) {
      setError(readable(error))
      console.warn('[checkin] 签到链执行失败（不阻塞主流程）', error)
    } finally {
      running.value = false
    }
  }

  /** 手动重试：清掉上次失败标记后重跑前三步 */
  async function retry() {
    setError(null)
    await run({ force: true })
  }

  // ---------------- 首播上报 ----------------

  function canReport(track: Track | null): track is Track {
    if (!track?.albumAudioId) return false
    const a = auth()
    if (!a.isLoggedIn || !a.userId) return false
    const record = playback.value
    if (record.date === todayString() && (record.state === 'done' || record.state === 'started')) {
      return false
    }
    return true
  }

  /** 播放真正开始（audio 的 play 事件）时调用；同一次播放只发一次 start */
  async function beginPlay(track: Track | null) {
    if (session) return
    const loggedInUser = auth().userId
    if (loggedInUser) syncUser(loggedInUser)
    if (!canReport(track)) return

    const mixsongid = String(track.albumAudioId)
    session = { mixsongid, seconds: 0 }

    try {
      await reportPlayStart(mixsongid)
      if (!session || session.mixsongid !== mixsongid) return
      persistRecord({
        date: todayString(),
        state: 'started',
        seconds: 0,
        message: null,
        mixsongid,
        updatedAt: Date.now(),
      })
    } catch (error) {
      session = null
      const text = readable(error)
      persistRecord({
        date: todayString(),
        state: 'failed',
        seconds: 0,
        message: text,
        mixsongid,
        updatedAt: Date.now(),
      })
      console.warn('[checkin] 播放开始上报失败（下次播放会重试）', error)
    }
  }

  /** 播放中累计真实收听秒数（暂停、拖动产生的跳跃不计入） */
  function addListenTime(seconds: number) {
    if (!session) return
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 5) return
    session.seconds += seconds
  }

  /** 结束一次播放：发送 end 事件并在拿到等级时同步本地快照 */
  async function endPlay(state = '完整播放') {
    const current = session
    if (!current) return
    session = null

    const seconds = Math.floor(current.seconds)
    if (seconds < MIN_REPORT_SECONDS) {
      // 太短：不发 end，回退到 idle 让下一次真实播放能重新触发
      persistRecord({
        date: todayString(),
        state: 'idle',
        seconds: 0,
        message: null,
        mixsongid: current.mixsongid,
        updatedAt: Date.now(),
      })
      return
    }

    const baseline = meta().grade?.totalSeconds ?? 0
    try {
      const result = await reportPlayEnd({
        mixsongid: current.mixsongid,
        durationMs: seconds * 1000,
        state,
        ...(baseline > 0 ? { dSec: baseline, diffSec: seconds } : {}),
      })

      if (result.grade) meta().applyGrade(result.grade)

      persistRecord({
        date: todayString(),
        state: 'done',
        seconds,
        message: result.gradeSynced ? null : '播放已上报，等级同步未成功（可稍后刷新资料）',
        mixsongid: current.mixsongid,
        updatedAt: Date.now(),
      })
    } catch (error) {
      const text = readable(error)
      persistRecord({
        date: todayString(),
        state: 'failed',
        seconds,
        message: text,
        mixsongid: current.mixsongid,
        updatedAt: Date.now(),
      })
      console.warn('[checkin] 播放结束上报失败（不重试，避免重复计时）', error)
    }
  }

  /** 登出：只清内存态，保留按账号存的当日记录 */
  function reset() {
    running.value = false
    playback.value = emptyRecord()
    lastError.value = null
    session = null
    activeUserId = null
  }

  return {
    running,
    playback,
    lastError,
    today,
    steps,
    message,
    signedIn,
    run,
    retry,
    syncUser,
    beginPlay,
    addListenTime,
    endPlay,
    reset,
  }
})
