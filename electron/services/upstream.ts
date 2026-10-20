/**
 * KuGouMusicApi 上游守护服务（Main 进程）
 *
 * 设计目标（文档 §2.1 / §7.5 / §10）：
 * 1. **随主进程拉起**：app.whenReady 时以子进程启动上游，退出时一并回收。
 * 2. **代理剥离**：axios 会继承 HTTP_PROXY/HTTPS_PROXY，导致调酷狗服务 socket hang up，
 *    因此子进程环境必须剔除全部代理变量。
 * 3. **端口复用**：若 127.0.0.1:3000 已被外部实例占用（开发者常手动跑上游），
 *    直接复用，不再重复启动，避免 EADDRINUSE。
 * 4. **失败不阻塞**：上游起不来时应用照常进入界面，UI 通过状态胶囊明示，可手动重启。
 * 5. **有限自愈**：异常退出按指数退避自动重启，超过上限后停止并暴露 lastError。
 */
import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { UpstreamState, UpstreamStatus } from '../../src/types/kugou'

/** 必须从子进程环境中剔除的代理变量（大小写两种写法都要处理） */
const PROXY_KEYS = [
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'npm_config_proxy',
  'npm_config_https_proxy',
]

const DEFAULT_PORT = 3000
const HEALTH_TIMEOUT_MS = 45_000
const HEALTH_INTERVAL_MS = 400
const MAX_RESTARTS = 3
const LOG_TAIL_LIMIT = 40
const EXTERNAL_WATCH_MS = 5_000

/** 探测端口是否已被监听：只判断「有人在听」，不产生业务请求 */
function probePort(port: number, host = '127.0.0.1', timeout = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    const finish = (reachable: boolean) => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolve(reachable)
    }

    socket.setTimeout(timeout)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

function resolvePort(): number {
  const raw = Number(process.env.KUGOU_API_PORT ?? DEFAULT_PORT)
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : DEFAULT_PORT
}

/**
 * 定位上游工程目录。
 * 优先级：显式环境变量 > 打包资源目录 > 开发期同级目录 > 当前工作目录。
 */
function resolveApiDir(): string | null {
  const candidates: string[] = []

  if (process.env.KUGOU_API_DIR) candidates.push(process.env.KUGOU_API_DIR)

  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'KuGouMusicApi'))
    candidates.push(path.join(path.dirname(app.getPath('exe')), 'KuGouMusicApi'))
  }

  // 开发期：app.getAppPath() 指向 music-app 根目录，上游通常与其同级
  candidates.push(path.resolve(app.getAppPath(), '..', 'KuGouMusicApi'))
  candidates.push(path.resolve(process.cwd(), '..', 'KuGouMusicApi'))
  candidates.push(path.resolve(process.cwd(), 'KuGouMusicApi'))

  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'app.js'))) return dir
    } catch {
      // 目录不可读时继续尝试下一个候选
    }
  }
  return null
}

export class UpstreamService extends EventEmitter {
  private child: ChildProcess | null = null
  private stopping = false
  private restartTimer: NodeJS.Timeout | null = null
  private watchTimer: NodeJS.Timeout | null = null
  private readonly port = resolvePort()
  private apiDir: string | null = resolveApiDir()
  private status: UpstreamStatus = {
    state: 'idle',
    port: resolvePort(),
    baseUrl: `http://127.0.0.1:${resolvePort()}`,
    pid: null,
    attempts: 0,
    lastError: null,
    logTail: [],
    apiDir: null,
  }

  constructor() {
    super()
    this.status.apiDir = this.apiDir
    if (!this.apiDir) {
      console.warn('[upstream] 未找到 KuGouMusicApi 工程目录，将以「仅复用外部服务」模式运行')
    }
  }

  getStatus(): UpstreamStatus {
    return { ...this.status, logTail: [...this.status.logTail] }
  }

  /** 启动上游：优先复用已监听端口，其次拉起子进程 */
  async start(): Promise<UpstreamStatus> {
    if (this.stopping) return this.getStatus()
    if (this.child) return this.getStatus()

    this.patch({ state: 'starting', lastError: null })

    if (await probePort(this.port)) {
      console.info(`[upstream] 端口 ${this.port} 已有服务监听，复用外部实例`)
      this.patch({ state: 'external', pid: null })
      this.startExternalWatch()
      return this.getStatus()
    }

    const managedDisabled = process.env.KUGOU_API_MANAGED === 'false'
    if (managedDisabled) {
      this.patch({ state: 'failed', lastError: '已配置 KUGOU_API_MANAGED=false，且未发现外部上游服务' })
      return this.getStatus()
    }

    if (!this.apiDir) {
      this.patch({
        state: 'failed',
        lastError: '未找到 KuGouMusicApi 工程目录，可通过环境变量 KUGOU_API_DIR 指定',
      })
      return this.getStatus()
    }

    this.spawnChild()
    await this.waitHealthy()
    return this.getStatus()
  }

  /** 手动重启：先停止再启动，供设置页「重启服务」调用 */
  async restart(): Promise<UpstreamStatus> {
    await this.stop({ transient: true })
    this.stopping = false
    this.patch({ attempts: 0 })
    return this.start()
  }

  /** 停止上游；transient=true 表示这是重启流程的一部分，不改变最终状态语义 */
  async stop(options: { transient?: boolean } = {}): Promise<void> {
    this.clearRestartTimer()
    this.stopExternalWatch()
    if (!options.transient) this.stopping = true

    const child = this.child
    if (!child) {
      if (!options.transient) this.patch({ state: 'stopped', pid: null })
      return
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // 进程可能已退出，忽略
        }
        resolve()
      }, 3_000)

      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })

      try {
        child.kill()
      } catch {
        clearTimeout(timer)
        resolve()
      }
    })

    this.child = null
    if (!options.transient) this.patch({ state: 'stopped', pid: null })
  }

  private spawnChild() {
    if (!this.apiDir) return

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // 用 Electron 二进制以 Node 模式运行上游，打包后无需额外安装 Node
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(this.port),
      // 概念版：上游 platform=lite 对应酷狗概念版的接口行为
      platform: 'lite',
    }
    for (const key of PROXY_KEYS) delete env[key]

    const args = [path.join(this.apiDir, 'app.js'), `--port=${this.port}`, '--swagger=false', '--platform=lite']

    console.info(`[upstream] 启动子进程：${path.join(this.apiDir, 'app.js')} (port=${this.port})`)

    const child = spawn(process.execPath, args, {
      cwd: this.apiDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.child = child
    this.patch({ pid: child.pid ?? null })

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.appendLog(chunk))
    child.stderr?.on('data', (chunk: string) => this.appendLog(chunk))

    child.once('error', (error) => {
      console.error('[upstream] 子进程启动失败：', error)
      this.patch({ lastError: `子进程启动失败：${error.message}` })
    })

    child.once('exit', (code, signal) => {
      this.child = null
      const reason = `上游进程退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`
      console.warn(`[upstream] ${reason}`)

      if (this.stopping) {
        this.patch({ state: 'stopped', pid: null })
        return
      }
      this.handleUnexpectedExit(reason)
    })
  }

  /** 等待端口就绪；期间子进程退出则立即判定失败，不做满时长空等 */
  private async waitHealthy(): Promise<void> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS

    while (Date.now() < deadline) {
      if (await probePort(this.port)) {
        this.patch({ state: 'running', lastError: null })
        console.info(`[upstream] 服务就绪：${this.status.baseUrl}`)
        return
      }
      if (!this.child) return
      await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS))
    }

    this.patch({ state: 'failed', lastError: `上游在 ${HEALTH_TIMEOUT_MS / 1000}s 内未就绪` })
    // 超时后仍有进程存活时主动回收，避免僵尸进程占端口
    if (this.child) void this.stop()
  }

  private handleUnexpectedExit(reason: string) {
    void (async () => {
      // 子进程退出后端口可能被外部实例接管，先探测再决定语义
      if (await probePort(this.port)) {
        this.patch({ state: 'external', pid: null, lastError: null })
        this.startExternalWatch()
        return
      }

      if (this.status.attempts >= MAX_RESTARTS) {
        this.patch({ state: 'failed', pid: null, lastError: `${reason}；已自动重启 ${MAX_RESTARTS} 次仍失败` })
        return
      }

      const attempts = this.status.attempts + 1
      const delay = 1_000 * attempts
      this.patch({ state: 'starting', pid: null, attempts, lastError: reason })
      console.info(`[upstream] ${delay}ms 后第 ${attempts} 次自动重启`)

      this.clearRestartTimer()
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null
        if (this.stopping || this.child) return
        this.spawnChild()
        void this.waitHealthy()
      }, delay)
    })()
  }

  /** 外部实例无 exit 事件可监听，改为轮询端口，断开后状态及时回落 */
  private startExternalWatch() {
    this.stopExternalWatch()
    this.watchTimer = setInterval(() => {
      void (async () => {
        if (this.child) return
        const alive = await probePort(this.port)
        if (!alive && this.status.state === 'external') {
          this.patch({ state: 'failed', lastError: '外部上游服务已断开' })
          this.stopExternalWatch()
        }
      })()
    }, EXTERNAL_WATCH_MS)
  }

  private stopExternalWatch() {
    if (this.watchTimer) {
      clearInterval(this.watchTimer)
      this.watchTimer = null
    }
  }

  private clearRestartTimer() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
  }

  private appendLog(chunk: string) {
    const lines = chunk.split(/\r?\n/).filter((line) => line.trim().length > 0)
    if (lines.length === 0) return
    for (const line of lines) console.log(`[upstream] ${line}`)
    const next = [...this.status.logTail, ...lines].slice(-LOG_TAIL_LIMIT)
    this.patch({ logTail: next })
  }

  private patch(partial: Partial<UpstreamStatus>) {
    const stateChanged = partial.state !== undefined && partial.state !== this.status.state
    this.status = { ...this.status, ...partial }
    // logTail 变化不需要推送，避免刷爆 IPC；仅状态变化时广播
    if (partial.state !== undefined || stateChanged) {
      this.emit('status', this.getStatus())
    }
  }
}

export const upstream = new UpstreamService()
export type { UpstreamState }
