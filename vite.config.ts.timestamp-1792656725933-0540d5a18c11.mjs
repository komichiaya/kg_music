// vite.config.ts
import { defineConfig } from "file:///D:/project/kugo/music-app/node_modules/.pnpm/vite@5.4.21_@types+node@26.6.5/node_modules/vite/dist/node/index.js";
import path from "node:path";
import electron from "file:///D:/project/kugo/music-app/node_modules/.pnpm/vite-plugin-electron@0.28.8_4f71060a0595e75db0694e3f5d80bdba/node_modules/vite-plugin-electron/dist/simple.mjs";
import vue from "file:///D:/project/kugo/music-app/node_modules/.pnpm/@vitejs+plugin-vue@5.2.4_vi_474001fa49987373469e7aa7d9d697f1/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import AutoImport from "file:///D:/project/kugo/music-app/node_modules/.pnpm/unplugin-auto-import@21.1.0_8615af94d4e7b914b2c150f7fa7a5a4b/node_modules/unplugin-auto-import/dist/vite.mjs";
import Components from "file:///D:/project/kugo/music-app/node_modules/.pnpm/unplugin-vue-components@32._42d3cf03e7228e97386d19514c6e99a4/node_modules/unplugin-vue-components/dist/vite.mjs";
import { ElementPlusResolver } from "file:///D:/project/kugo/music-app/node_modules/.pnpm/unplugin-vue-components@32._42d3cf03e7228e97386d19514c6e99a4/node_modules/unplugin-vue-components/dist/resolvers.mjs";
import { fileURLToPath, URL } from "node:url";
var __vite_injected_original_dirname = "D:\\project\\kugo\\music-app";
var __vite_injected_original_import_meta_url = "file:///D:/project/kugo/music-app/vite.config.ts";
delete process.env.ELECTRON_RUN_AS_NODE;
var vite_config_default = defineConfig({
  // 打包后通过 file:// 加载 index.html，必须是相对路径，否则 /assets/* 会解析到磁盘根目录
  base: "./",
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()]
    }),
    Components({
      resolvers: [ElementPlusResolver()]
    }),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: "electron/main.ts"
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__vite_injected_original_dirname, "electron/preload.ts"),
        vite: {
          build: {
            rollupOptions: {
              // 必须产出 CJS + .cjs 后缀：package.json 声明了 type=module，
              // 若沿用默认的 .mjs，Electron 会按 ESM 解析含 require 的产物并直接报错。
              output: {
                format: "cjs",
                entryFileNames: "preload.cjs"
              }
            }
          }
        }
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === "test" ? (
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        void 0
      ) : {}
    })
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", __vite_injected_original_import_meta_url))
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxwcm9qZWN0XFxcXGt1Z29cXFxcbXVzaWMtYXBwXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJEOlxcXFxwcm9qZWN0XFxcXGt1Z29cXFxcbXVzaWMtYXBwXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9EOi9wcm9qZWN0L2t1Z28vbXVzaWMtYXBwL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIjtcbmltcG9ydCBlbGVjdHJvbiBmcm9tIFwidml0ZS1wbHVnaW4tZWxlY3Ryb24vc2ltcGxlXCI7XG5pbXBvcnQgdnVlIGZyb20gXCJAdml0ZWpzL3BsdWdpbi12dWVcIjtcbmltcG9ydCBBdXRvSW1wb3J0IGZyb20gXCJ1bnBsdWdpbi1hdXRvLWltcG9ydC92aXRlXCI7XG5pbXBvcnQgQ29tcG9uZW50cyBmcm9tIFwidW5wbHVnaW4tdnVlLWNvbXBvbmVudHMvdml0ZVwiO1xuaW1wb3J0IHsgRWxlbWVudFBsdXNSZXNvbHZlciB9IGZyb20gXCJ1bnBsdWdpbi12dWUtY29tcG9uZW50cy9yZXNvbHZlcnNcIjtcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGgsIFVSTCB9IGZyb20gXCJub2RlOnVybFwiO1xuXG4vKipcbiAqIFx1NkUwNVx1NzQwNiBFTEVDVFJPTl9SVU5fQVNfTk9ERVx1MzAwMlxuICpcbiAqIFx1ODJFNVx1NUYwMFx1NTNEMVx1N0VDOFx1N0FFRlx1NjcyQ1x1OEVBQlx1NzUzMSBFbGVjdHJvbiBcdTVCQkZcdTRFM0JcdTZEM0VcdTc1MUZcdUZGMDhcdTRGOEJcdTU5ODIgSURFIFx1NTE4NVx1N0Y2RVx1N0VDOFx1N0FFRlx1RkYwOVx1RkYwQ1x1OEJFNVx1NTNEOFx1OTFDRlx1NEYxQVx1ODhBQlx1N0VFN1x1NjI3Rlx1RkYwQ1xuICogXHU1QkZDXHU4MUY0IHZpdGUtcGx1Z2luLWVsZWN0cm9uIFx1NjI4QVx1NEUzQlx1OEZEQlx1N0EwQlx1NUY1M1x1NjY2RVx1OTAxQSBOb2RlIFx1ODExQVx1NjcyQ1x1NjI2N1x1ODg0Q1x1RkYwQ1xuICogXHU2MkE1XHU5NTE5IFwiVGhlIHJlcXVlc3RlZCBtb2R1bGUgJ2VsZWN0cm9uJyBkb2VzIG5vdCBwcm92aWRlIGFuIGV4cG9ydCBuYW1lZCAnYXBwJ1wiXHUzMDAyXG4gKiBcdThGRDlcdTkxQ0NcdTU3MjhcdTU0MkZcdTUyQThcdTVCNTBcdThGREJcdTdBMEJcdTUyNERcdTUyNTRcdTk2NjRcdUZGMENcdTRGRERcdThCQzFcdTVGMDBcdTUzRDFcdTZBMjFcdTVGMEZcdTU5Q0JcdTdFQzhcdTYyQzlcdThENzdcdTc3MUZcdTZCNjNcdTc2ODQgRWxlY3Ryb24gXHU4RkQwXHU4ODRDXHU2NUY2XHUzMDAyXG4gKi9cbmRlbGV0ZSBwcm9jZXNzLmVudi5FTEVDVFJPTl9SVU5fQVNfTk9ERTtcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIC8vIFx1NjI1M1x1NTMwNVx1NTQwRVx1OTAxQVx1OEZDNyBmaWxlOi8vIFx1NTJBMFx1OEY3RCBpbmRleC5odG1sXHVGRjBDXHU1RkM1XHU5ODdCXHU2NjJGXHU3NkY4XHU1QkY5XHU4REVGXHU1Rjg0XHVGRjBDXHU1NDI2XHU1MjE5IC9hc3NldHMvKiBcdTRGMUFcdTg5RTNcdTY3OTBcdTUyMzBcdTc4QzFcdTc2RDhcdTY4MzlcdTc2RUVcdTVGNTVcbiAgYmFzZTogXCIuL1wiLFxuICBwbHVnaW5zOiBbXG4gICAgdnVlKCksXG5cbiAgICBBdXRvSW1wb3J0KHtcbiAgICAgIHJlc29sdmVyczogW0VsZW1lbnRQbHVzUmVzb2x2ZXIoKV0sXG4gICAgfSksXG4gICAgQ29tcG9uZW50cyh7XG4gICAgICByZXNvbHZlcnM6IFtFbGVtZW50UGx1c1Jlc29sdmVyKCldLFxuICAgIH0pLFxuICAgIGVsZWN0cm9uKHtcbiAgICAgIG1haW46IHtcbiAgICAgICAgLy8gU2hvcnRjdXQgb2YgYGJ1aWxkLmxpYi5lbnRyeWAuXG4gICAgICAgIGVudHJ5OiBcImVsZWN0cm9uL21haW4udHNcIixcbiAgICAgIH0sXG4gICAgICBwcmVsb2FkOiB7XG4gICAgICAgIC8vIFNob3J0Y3V0IG9mIGBidWlsZC5yb2xsdXBPcHRpb25zLmlucHV0YC5cbiAgICAgICAgLy8gUHJlbG9hZCBzY3JpcHRzIG1heSBjb250YWluIFdlYiBhc3NldHMsIHNvIHVzZSB0aGUgYGJ1aWxkLnJvbGx1cE9wdGlvbnMuaW5wdXRgIGluc3RlYWQgYGJ1aWxkLmxpYi5lbnRyeWAuXG4gICAgICAgIGlucHV0OiBwYXRoLmpvaW4oX19kaXJuYW1lLCBcImVsZWN0cm9uL3ByZWxvYWQudHNcIiksXG4gICAgICAgIHZpdGU6IHtcbiAgICAgICAgICBidWlsZDoge1xuICAgICAgICAgICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgICAgICAgICAvLyBcdTVGQzVcdTk4N0JcdTRFQTdcdTUxRkEgQ0pTICsgLmNqcyBcdTU0MEVcdTdGMDBcdUZGMUFwYWNrYWdlLmpzb24gXHU1OEYwXHU2NjBFXHU0RTg2IHR5cGU9bW9kdWxlXHVGRjBDXG4gICAgICAgICAgICAgIC8vIFx1ODJFNVx1NkNCRlx1NzUyOFx1OUVEOFx1OEJBNFx1NzY4NCAubWpzXHVGRjBDRWxlY3Ryb24gXHU0RjFBXHU2MzA5IEVTTSBcdTg5RTNcdTY3OTBcdTU0MkIgcmVxdWlyZSBcdTc2ODRcdTRFQTdcdTcyNjlcdTVFNzZcdTc2RjRcdTYzQTVcdTYyQTVcdTk1MTlcdTMwMDJcbiAgICAgICAgICAgICAgb3V0cHV0OiB7XG4gICAgICAgICAgICAgICAgZm9ybWF0OiBcImNqc1wiLFxuICAgICAgICAgICAgICAgIGVudHJ5RmlsZU5hbWVzOiBcInByZWxvYWQuY2pzXCIsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgLy8gUGxveWZpbGwgdGhlIEVsZWN0cm9uIGFuZCBOb2RlLmpzIEFQSSBmb3IgUmVuZGVyZXIgcHJvY2Vzcy5cbiAgICAgIC8vIElmIHlvdSB3YW50IHVzZSBOb2RlLmpzIGluIFJlbmRlcmVyIHByb2Nlc3MsIHRoZSBgbm9kZUludGVncmF0aW9uYCBuZWVkcyB0byBiZSBlbmFibGVkIGluIHRoZSBNYWluIHByb2Nlc3MuXG4gICAgICAvLyBTZWUgXHVEODNEXHVEQzQ5IGh0dHBzOi8vZ2l0aHViLmNvbS9lbGVjdHJvbi12aXRlL3ZpdGUtcGx1Z2luLWVsZWN0cm9uLXJlbmRlcmVyXG4gICAgICByZW5kZXJlcjpcbiAgICAgICAgcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09IFwidGVzdFwiXG4gICAgICAgICAgPyAvLyBodHRwczovL2dpdGh1Yi5jb20vZWxlY3Ryb24tdml0ZS92aXRlLXBsdWdpbi1lbGVjdHJvbi1yZW5kZXJlci9pc3N1ZXMvNzgjaXNzdWVjb21tZW50LTIwNTM2MDA4MDhcbiAgICAgICAgICAgIHVuZGVmaW5lZFxuICAgICAgICAgIDoge30sXG4gICAgfSksXG4gIF0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgXCJAXCI6IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi4vc3JjXCIsIGltcG9ydC5tZXRhLnVybCkpLFxuICAgIH0sXG4gIH0sXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBcVEsU0FBUyxvQkFBb0I7QUFDbFMsT0FBTyxVQUFVO0FBQ2pCLE9BQU8sY0FBYztBQUNyQixPQUFPLFNBQVM7QUFDaEIsT0FBTyxnQkFBZ0I7QUFDdkIsT0FBTyxnQkFBZ0I7QUFDdkIsU0FBUywyQkFBMkI7QUFDcEMsU0FBUyxlQUFlLFdBQVc7QUFQbkMsSUFBTSxtQ0FBbUM7QUFBd0gsSUFBTSwyQ0FBMkM7QUFpQmxOLE9BQU8sUUFBUSxJQUFJO0FBR25CLElBQU8sc0JBQVEsYUFBYTtBQUFBO0FBQUEsRUFFMUIsTUFBTTtBQUFBLEVBQ04sU0FBUztBQUFBLElBQ1AsSUFBSTtBQUFBLElBRUosV0FBVztBQUFBLE1BQ1QsV0FBVyxDQUFDLG9CQUFvQixDQUFDO0FBQUEsSUFDbkMsQ0FBQztBQUFBLElBQ0QsV0FBVztBQUFBLE1BQ1QsV0FBVyxDQUFDLG9CQUFvQixDQUFDO0FBQUEsSUFDbkMsQ0FBQztBQUFBLElBQ0QsU0FBUztBQUFBLE1BQ1AsTUFBTTtBQUFBO0FBQUEsUUFFSixPQUFPO0FBQUEsTUFDVDtBQUFBLE1BQ0EsU0FBUztBQUFBO0FBQUE7QUFBQSxRQUdQLE9BQU8sS0FBSyxLQUFLLGtDQUFXLHFCQUFxQjtBQUFBLFFBQ2pELE1BQU07QUFBQSxVQUNKLE9BQU87QUFBQSxZQUNMLGVBQWU7QUFBQTtBQUFBO0FBQUEsY0FHYixRQUFRO0FBQUEsZ0JBQ04sUUFBUTtBQUFBLGdCQUNSLGdCQUFnQjtBQUFBLGNBQ2xCO0FBQUEsWUFDRjtBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BSUEsVUFDRSxRQUFRLElBQUksYUFBYTtBQUFBO0FBQUEsUUFFckI7QUFBQSxVQUNBLENBQUM7QUFBQSxJQUNULENBQUM7QUFBQSxFQUNIO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLGNBQWMsSUFBSSxJQUFJLFNBQVMsd0NBQWUsQ0FBQztBQUFBLElBQ3REO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
