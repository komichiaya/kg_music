/**
 * 设备标识（文档 §4.3.1 首播上报）
 *
 * CSCC 上报要求 `uuid`（32 位字母数字）+ `mid`（纯数字）稳定一致：
 * 上游会以二者建立会话缓存，并把它们写进事件报文作为设备指纹。
 * 本应用没有原生客户端，这里生成一份并持久化，避免每次启动都变成「新设备」。
 */
export interface DeviceIdentity {
  uuid: string
  mid: string
  deviceModel: string
  systemVersion: string
  screenWidth: number
  screenHeight: number
  localIp: string
}

const STORAGE_KEY = 'kugou.concept.device.v1'

/** 32 位十六进制即满足上游 `[a-zA-Z0-9]{32}` 校验 */
function randomUuid(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 纯数字 MID，与上游 calculateMid 的十进制形态一致（不要求与 uuid 有派生关系） */
function randomMid(): string {
  const value = Math.floor(1_000_000_000 + Math.random() * 8_999_999_999)
  return String(value)
}

function readStored(): Partial<DeviceIdentity> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DeviceIdentity>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function persist(identity: DeviceIdentity) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
  } catch {
    // 隐私模式下写不进去，本次会话仍可用
  }
}

function valid(identity: Partial<DeviceIdentity> | null): identity is DeviceIdentity {
  return Boolean(
    identity &&
      typeof identity.uuid === 'string' &&
      /^[a-zA-Z0-9]{32}$/.test(identity.uuid) &&
      typeof identity.mid === 'string' &&
      /^(0|[1-9]\d*)$/.test(identity.mid)
  )
}

let cached: DeviceIdentity | null = null

export function getDeviceIdentity(): DeviceIdentity {
  if (cached) return cached

  const stored = readStored()
  if (valid(stored)) {
    cached = {
      ...stored,
      deviceModel: stored.deviceModel || 'Windows PC',
      systemVersion: stored.systemVersion || '10',
      screenWidth: stored.screenWidth || window.screen?.width || 1920,
      screenHeight: stored.screenHeight || window.screen?.height || 1080,
      localIp: stored.localIp || '0.0.0.0',
    }
    return cached
  }

  cached = {
    uuid: randomUuid(),
    mid: randomMid(),
    deviceModel: 'Windows PC',
    systemVersion: '10',
    screenWidth: Math.max(1, Math.min(65535, Math.round(window.screen?.width || 1920))),
    screenHeight: Math.max(1, Math.min(65535, Math.round(window.screen?.height || 1080))),
    localIp: '0.0.0.0',
  }
  persist(cached)
  return cached
}
