import { defineConfig } from "vite";
import path from "node:path";
import electron from "vite-plugin-electron/simple";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import { fileURLToPath, URL } from "node:url";

/**
 * 清理 ELECTRON_RUN_AS_NODE。
 *
 * 若开发终端本身由 Electron 宿主派生（例如 IDE 内置终端），该变量会被继承，
 * 导致 vite-plugin-electron 把主进程当普通 Node 脚本执行，
 * 报错 "The requested module 'electron' does not provide an export named 'app'"。
 * 这里在启动子进程前剔除，保证开发模式始终拉起真正的 Electron 运行时。
 */
delete process.env.ELECTRON_RUN_AS_NODE;

// https://vitejs.dev/config/
export default defineConfig({
  // 打包后通过 file:// 加载 index.html，必须是相对路径，否则 /assets/* 会解析到磁盘根目录
  base: "./",
  plugins: [
    vue(),

    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: "electron/main.ts",
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, "electron/preload.ts"),
        vite: {
          build: {
            rollupOptions: {
              // 必须产出 CJS + .cjs 后缀：package.json 声明了 type=module，
              // 若沿用默认的 .mjs，Electron 会按 ESM 解析含 require 的产物并直接报错。
              output: {
                format: "cjs",
                entryFileNames: "preload.cjs",
              },
            },
          },
        },
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer:
        process.env.NODE_ENV === "test"
          ? // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
            undefined
          : {},
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
