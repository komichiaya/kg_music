/// <reference types="vite-plugin-electron/electron-env" />

import type { KugouBridge } from '../src/types/kugou'

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /**
       * The built directory structure
       *
       * ```tree
       * ├─┬─┬ dist
       * │ │ └── index.html
       * │ │
       * ├─┬ dist-electron
       * │ │ ├── main.js
       * │ │ └── preload.cjs
       * ```
       */
      APP_ROOT: string
      /** /dist/ or /public/ */
      VITE_PUBLIC: string
      /** 上游 KuGouMusicApi 端口，缺省 3000 */
      KUGOU_API_PORT?: string
      /** 显式指定上游工程目录 */
      KUGOU_API_DIR?: string
      /** 置为 false 时不再拉起上游子进程，仅复用外部实例 */
      KUGOU_API_MANAGED?: string
    }
  }

  interface Window {
    /** 由 electron/preload.ts 通过 contextBridge 注入；纯浏览器调试时为 undefined */
    kugou?: KugouBridge
  }
}

export {}
