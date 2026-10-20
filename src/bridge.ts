import type { KugouBridge } from '@/types/kugou'

/** 取 preload 注入的桥；纯浏览器环境（无 Electron）返回 null，调用方需自行降级 */
export function getBridge(): KugouBridge | null {
  return window.kugou ?? null
}
