/**
 * 本地持久化服务（Main 进程独占）
 *
 * 职责：
 * 1. 凭据安全存储 —— Renderer 永不直接触盘，凭据经 IPC 交由 Main 用 safeStorage 加密落盘（文档 §7.3）。
 * 2. 窗口状态记忆 —— 记住窗口尺寸/位置/最大化，重启还原。
 *
 * 落盘文件均位于 app.getPath('userData')：
 *   credential.bin     凭据（safeStorage 加密，不可用时降级为明文 base64，仅限开发环境）
 *   window-state.json  窗口尺寸与位置
 */
import { app, safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { KugouCredential } from '../../src/types/kugou'

const CREDENTIAL_FILE = 'credential.bin'
const WINDOW_STATE_FILE = 'window-state.json'

interface CredentialEnvelope {
  v: 1
  /** safe: safeStorage 加密；plain: 明文（safeStorage 不可用时的降级） */
  enc: 'safe' | 'plain'
  /** base64 编码后的密文或明文 */
  data: string
}

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

const userDataFile = (name: string) => path.join(app.getPath('userData'), name)

/** 原子写入：先写临时文件再 rename，避免进程中断留下半截文件 */
async function writeAtomic(filePath: string, content: string) {
  const tmpPath = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(tmpPath, content, 'utf8')
  await fs.rename(tmpPath, filePath)
}

/** 仅接受结构完整的凭证，防止损坏文件导致后续请求带上脏 Authorization */
function normalizeCredential(input: unknown): KugouCredential | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  if (typeof raw.token !== 'string' || raw.token.length === 0) return null
  if (raw.userid === undefined || raw.userid === null) return null

  return {
    token: raw.token,
    userid: String(raw.userid),
    vip_type: Number(raw.vip_type ?? 0) || 0,
    vip_token: typeof raw.vip_token === 'string' ? raw.vip_token : '',
    t1: typeof raw.t1 === 'string' ? raw.t1 : undefined,
    dfid: typeof raw.dfid === 'string' ? raw.dfid : undefined,
  }
}

/**
 * 读取凭据。
 *
 * 任何异常（文件缺失、密文损坏、系统密钥环变更）都收敛为 null，
 * 让上层进入游客态，而不是让启动流程中断。
 */
export async function readCredential(): Promise<KugouCredential | null> {
  try {
    const raw = await fs.readFile(userDataFile(CREDENTIAL_FILE), 'utf8')
    const envelope = JSON.parse(raw) as CredentialEnvelope
    if (!envelope || typeof envelope.data !== 'string') return null

    const buffer = Buffer.from(envelope.data, 'base64')
    let plain: string
    if (envelope.enc === 'safe') {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn('[store] 系统加密不可用，无法解密既有凭据，按未登录处理')
        return null
      }
      plain = safeStorage.decryptString(buffer)
    } else {
      plain = buffer.toString('utf8')
    }

    return normalizeCredential(JSON.parse(plain))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') {
      console.warn('[store] 读取凭据失败，按未登录处理：', error)
    }
    return null
  }
}

/** 写入凭据；返回是否使用了系统级加密 */
export async function writeCredential(credential: KugouCredential): Promise<boolean> {
  const normalized = normalizeCredential(credential)
  if (!normalized) throw new Error('凭据结构不合法：缺少 token 或 userid')

  const plain = JSON.stringify(normalized)
  const encrypted = safeStorage.isEncryptionAvailable()

  const envelope: CredentialEnvelope = {
    v: 1,
    enc: encrypted ? 'safe' : 'plain',
    data: encrypted
      ? safeStorage.encryptString(plain).toString('base64')
      : Buffer.from(plain, 'utf8').toString('base64'),
  }

  await fs.mkdir(path.dirname(userDataFile(CREDENTIAL_FILE)), { recursive: true })
  await writeAtomic(userDataFile(CREDENTIAL_FILE), JSON.stringify(envelope))

  if (!encrypted) {
    console.warn('[store] safeStorage 不可用，凭据以未加密形式落盘（仅建议在开发环境出现）')
  }
  return encrypted
}

/** 清除凭据；文件不存在视为成功 */
export async function clearCredential(): Promise<void> {
  try {
    await fs.unlink(userDataFile(CREDENTIAL_FILE))
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[store] 清除凭据失败：', error)
    }
  }
}

export async function readWindowState(): Promise<WindowState | null> {
  try {
    const raw = await fs.readFile(userDataFile(WINDOW_STATE_FILE), 'utf8')
    const parsed = JSON.parse(raw) as WindowState
    if (!parsed || !Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) return null
    return parsed
  } catch {
    return null
  }
}

export async function writeWindowState(state: WindowState): Promise<void> {
  try {
    await fs.mkdir(path.dirname(userDataFile(WINDOW_STATE_FILE)), { recursive: true })
    await writeAtomic(userDataFile(WINDOW_STATE_FILE), JSON.stringify(state))
  } catch (error) {
    console.warn('[store] 保存窗口状态失败：', error)
  }
}
