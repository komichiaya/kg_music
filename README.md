# 酷狗音乐概念版 · 桌面播放器（music-app）

基于 [KuGouMusicApi](../KuGouMusicApi) 的第三方酷狗音乐桌面客户端。
技术栈：Electron + Vue 3 + TypeScript + Vite + Element Plus + Pinia + Vue Router。

> 当前进度：**P0 骨架 + P1 登录 + P2 播放核心 + P3 歌词 + P4 内容 + P5 签到链 + P6 视觉与交互打磨（迷你模式 / 封面取色 / 快捷键 / 令牌收口）**。
> 详细设计见 [`docs/开发文档.md`](docs/开发文档.md)。

---

## 快速开始

```bash
pnpm install
pnpm dev
```

- 开发模式由 `vite-plugin-electron` 自动拉起渲染进程与 Electron 主进程。
- 主进程会在 `app.whenReady` 时**自动拉起上游 KuGouMusicApi**（默认端口 3000）；
  若端口已被外部实例占用，则直接复用，不会重复启动。
- 上游工程默认按同级目录 `<repo>/KuGouMusicApi` 查找。

## 登录（P1）

三个通道最终收敛为同一份 `KugouCredential`，并通过 `auth.completeLogin()` 完成
「落盘 → `/login/token` 续期 → `/user/info` 拉资料」。

| 通道 | 接口 | 说明 |
| --- | --- | --- |
| 扫码 | `/login/qr/key` → `/login/qr/create` → 轮询 `/login/qr/check` | 2s 轮询，180s TTL，status 0/1/2/4 映射为过期/等待/待确认/成功 |
| 手机 | `/login/cellphone` | 验证码由用户在酷狗官方端获取，播放器不代发短信（避免风控） |
| 密码 | `/login` | 上游解密 `secu_params` 后回 token |

实现要点：

- `src/composables/useQrLogin.ts` 负责轮询状态机：并发保护、连续失败容忍、切 Tab / 卸载立即停止。
- 启动路径分两段：`boot()` 只读本地凭证（快，守卫可 await），`hydrate()` 在后台校验会话并拉资料；
  上游尚未就绪时不会拖慢首屏，服务就绪后由 `App.vue` 再补触发。
- 凭证经 IPC 交给 Main，用 `safeStorage` 加密落盘，重启免登录。
- 失效判定：HTTP 401/403，或响应体 `error_code = 20017`（酷狗 token 失效，常见于 502 响应）；
  网络错误与上游未启动**不会**清除凭证。
- 上游对 GET 响应有 2 分钟缓存，扫码轮询与续期请求都带 `timestamp` 绕过。

## 内容（P4）

| 页面 | 数据来源 | 能力 |
| --- | --- | --- |
| 发现 | `/everyday/recommend`、`/rank/list`、`/search/hot` | 每日推荐 30 首（整列可播）、榜单入口、真实热词 |
| 搜索 | `/search`（song / special / author / album） | 四类结果；歌单跳详情，歌手/专辑反查歌曲 |
| 歌单 | `/playlist/detail`、`/playlist/track/all` | 封面/创建者/曲数，按 gid 分页取曲目 |
| 排行 | `/rank/list`、`/rank/audio` | 榜单列表 + 榜内 50 首，支持 `?rankid=` 直达 |
| 侧栏「我的」 | `/user/playlist`、`/playlist/add` | 歌单直接列在侧栏；「我的」右侧 `+` 新建空白歌单（名称 / 私密）；折叠态只显示封面 |
| 个人中心 | `/user/grade/info`、`/user/vip/detail` | 由**标题栏头像**进入；听歌等级、累计时长、VIP 到期时间 |

字段归一化集中在 `src/api/track.ts`：搜索 / 每日推荐 / 榜单 / 歌单四种返回结构差异很大
（`FileHash` vs `hash_320` vs `audio_info.hash_128` vs `relate_goods[].bitrate`），
统一收敛成 `Track`，页面与播放器只面对一种结构。

## 歌词（P3）

| 形态 | 说明 |
| --- | --- |
| 歌词页 `/lyrics` | 点击播放栏封面进入；当前行居中放大，切行平滑滚动，点击任意行跳转；Esc / 返回按钮退出 |
| 逐字 / 逐行 | KRC 优先（逐字扫光），无 KRC 自动降级 LRC（整行高亮） |
| 译文 / 罗马音 | KRC `[language:]` 的 `type:1` 译文与 `type:0` 音译按行对齐；歌词页右上角独立开关 |
| 桌面歌词 | 独立置顶透明小窗，拖动移动，逐字跟随，开关状态与设置双向同步 |

> 全站唯一的播放控制入口是底部 PlayerBar，歌词页不重复实现进度条与三键。

链路：`/search/lyric`（hash + duration）→ `/lyric?id&accesskey&fmt=krc&decode=true` → 解析。

实现要点：

- 歌词接口的成功标志是 **`status=200`**（不是登录的 1），候选列表在响应**根节点** `candidates`。
- KRC 行格式 `[行开始ms,行时长ms]<字偏移ms,字时长ms,0>字...`，字偏移相对行开始；
  LRC 支持一行多时间标签与 `[offset:±ms]`。
- 定位用二分查找，只在行变化时写状态，避免 timeupdate 每帧触发渲染。
- 桌面歌词窗口由 Main 管理（transparent + alwaysOnTop + skipTaskbar），
  主窗口只推送「上一行 / 当前行（含逐字进度）/ 下一行」，窗口自身不发请求。

## 播放（P2）

| 能力 | 说明 |
| --- | --- |
| 取流 | `/song/url`，`url` 是数组取 `[0]`，`backupUrl` 作失败重试 |
| 音质 | **hash 必须与音质匹配**：128→`FileHash`、320→`HQFileHash`、flac→`SQFileHash`、high→`ResFileHash` |
| 降级 | 高音质无权限逐级降档；未登录直接走 128，避免无效请求 |
| 试听 | 全档失败后带 `free_part=1` 取 60s 片段，UI 标注「试听 N 秒」，与「不可播放」分开表达 |
| 队列 | 点击起播、整列替换、移除、清空、拖拽排序、当前高亮 |
| 进度 | 拖动定位；会话快照只保存「队列 + 当前曲进度」，重启恢复该曲（暂停态），其他曲目从头 |
| 系统集成 | 媒体键（Media Session：播放/暂停/上下首/seek）、封面旋转、自动连播 |

自动播放策略：主进程设置 `--autoplay-policy=no-user-gesture-required`，
否则自动连播与恢复播放会被 Chromium 的自动播放策略拒绝。

## 签到链（P5）

上游没有独立的「签到」端点，播放器把签到定义为登录/启动后的一条动作链，
由 `src/stores/checkin.ts` 编排，登录成功与冷启动两条路径都会汇入：

```
会话校验 /login/token + /user/info      （auth.hydrate）
  → 等级查询 /user/grade/info            （profileMeta.load）
  → 领取一天 VIP /youth/day/vip          （vip.claimToday，双键幂等）
  → 首播上报 /user/listen/report         （真实播放后触发，每日一次）
```

| 关注点 | 实现 |
| --- | --- |
| 触发 | `App.vue` 监听 `auth.isLoggedIn + sessionChecked`，通过后自动执行前三步 |
| 首播上报 | `audio` 的 `play` 事件发 CSCC `start`；自然播完/切歌/移除/清空/关窗时发 `end` |
| 真实时长 | `timeupdate` 只累计连续播放增量（暂停、拖动 >5s 的跳变不计入），少于 5s 不上报 |
| 等级同步 | `end` 携带 `d_sec`（上次查询的服务端累计）+ `diff_sec`（本次新增秒数），响应中的 `grade` 直接回写本地 |
| 每日一次 | 按 `账号 + 日期` 存 localStorage；当日已上报或正在上报时不再触发，避免重复累计 |
| 设备标识 | `src/utils/device.ts` 生成 32 位 uuid + 数字 mid 并持久化，start/end 必须一致 |
| 失败容错 | 任一步失败只提示，不阻塞登录与播放；end 事件不重试（超时也可能已记账） |
| 状态展示 | 个人中心链路卡片逐步显示状态、等级/累计时长、上报时长与失败原因，支持「重新校验」 |

> 服务端听歌时长可能延迟入账，上报成功后本地不会立即看到累计分钟变化。

## 每日一天 VIP（登录后自动领取）

登录成功（`auth.completeLogin`）与冷启动续期通过（`auth.hydrate`）后，自动调用
`POST /youth/day/vip` 领取当天的一天 VIP；失败仅提示，不阻塞登录与播放。

| 关注点 | 实现 |
| --- | --- |
| 入参 | `receive_day` 必须是 **`YYYY-MM-DD` 日期**，不是「1 天」；传 `1` 会返回 `304001 日期格式错误` |
| 幂等 | 本地 `lastClaimDate`（按 userid 存 localStorage）+ 服务端 `/youth/month/vip/record` 记录核对 |
| 已领取 | 响应文案含「已领取」时按已领取处理，不报错 |
| 未登录 | `error_code` `51002` / `20002` → 提示重新登录，不清理凭证 |
| 状态展示 | 个人中心：状态胶囊、到期时间、链路步骤状态、手动「立即领取 / 重试」 |

相关文件：`src/api/youth.ts`（接口与日期格式）、`src/stores/vip.ts`（状态、幂等、持久化）。

## 可用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 开发模式（Vite HMR + Electron 热重启） |
| `pnpm typecheck` | `vue-tsc --noEmit` 全量类型检查 |
| `pnpm build` | 类型检查 + 渲染层构建 + electron-builder 出包 |

## 环境变量

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `KUGOU_API_DIR` | 自动探测 | 显式指定 KuGouMusicApi 工程目录 |
| `KUGOU_API_PORT` | `3000` | 上游服务端口，同时注入 Renderer 的 apiBase |
| `KUGOU_API_MANAGED` | `true` | 置为 `false` 时不再拉起子进程，仅复用外部实例 |
| `VITE_API_BASE` | `http://127.0.0.1:3000` | 纯浏览器调试时的兜底地址 |

上游子进程启动时会**剔除 `HTTP_PROXY/HTTPS_PROXY` 等代理变量**，避免 axios 继承代理导致 socket hang up。

## 视觉与交互（P6）

| 能力 | 实现 |
| --- | --- |
| 封面取色 | `src/utils/palette.ts` 用 canvas 对封面做 4bit 直方图取色，校正饱和度/亮度后写入 `--cover-1/2/3`；CORS 失败或超时按封面 URL 哈希生成稳定回退色 |
| 极光背景 | `Backdrop` 三层模糊色块随曲目变色并缓慢漂移，网格/暗角改用主题令牌，减少动画偏好下自动静止 |
| 迷你模式 | 380×120 悬浮窗，只保留封面 / 曲名 / 进度 / 三键；Main 保存并恢复普通窗口几何与最大化状态，迷你期间不写窗口状态 |
| 快捷键 | 应用内 Space / ←→ / Ctrl+←→ / ↑↓ / M / Esc；硬件媒体键仍走 Media Session（SMTC），无需窗口聚焦 |
| 设计令牌 | 新增 `--fill-1..4`、`--scrim`、`--cover-1..3`；`--text-3` 提到 AA 对比度（暗 4.9:1 / 亮 5.0:1） |
| 高 DPI / 性能 | `backgroundThrottling: false`，迷你或最小化时进度与桌面歌词不被节流 |

> 迷你模式的窗口状态由 Main 独占：进入前保存 bounds，退出时恢复；写入 `window-state.json` 时统一跳过迷你状态，避免下次以小窗尺寸启动。

## 目录结构

```
electron/
├─ main.ts                 # 窗口 / 单实例 / 生命周期 / 安全基线
├─ preload.ts              # contextBridge，仅暴露 window.kugou
└─ services/
   ├─ upstream.ts          # 上游子进程守护：端口探测 / 健康等待 / 退避重启
   ├─ store.ts             # safeStorage 凭据加密、窗口状态持久化
   ├─ windowMode.ts        # 迷你窗口几何/能力保存与恢复
   ├─ lyricWindow.ts       # 桌面歌词窗口生命周期
   └─ ipc.ts               # IPC 通道注册与上游状态广播

src/
├─ api/
│  ├─ request.ts           # axios 实例：apiBase 注入、Authorization、proxy:false
│  ├─ login.ts             # 扫码 / 手机 / 密码登录、token 续期、凭证收敛
│  ├─ user.ts              # /user/info 字段归一化
│  ├─ youth.ts             # 一天 VIP 领取、当月领取记录
│  ├─ song.ts              # 取流：多音质 hash、降级链、60s 试听
│  ├─ search.ts            # 四类搜索与结果归一化
│  ├─ content.ts           # 每日推荐 / 排行榜 / 热搜
│  ├─ playlist.ts          # 歌单详情、歌单曲目、我的歌单、听歌历史
│  ├─ track.ts             # 四种曲目结构的统一归一化
│  ├─ report.ts            # 听歌上报：CSCC start/end、等级同步
│  └─ lyric.ts             # 歌词搜索 / 下载（decode）
├─ bridge.ts               # 安全获取 window.kugou（浏览器环境返回 null）
├─ stores/                 # auth / player / settings / vip / checkin / lyric / library / profile
│                          # discover / playlistPicker
├─ router/index.ts         # 全量路由 + 登录守卫
├─ composables/            # useUpstream / useQrLogin / useShortcuts
├─ utils/                  # format / lyric（LRC·KRC 解析）/ device（设备标识）/ palette（封面取色）
├─ components/
│  ├─ layout/              # TitleBar / Sidebar / Backdrop
│  ├─ player/              # PlayerBar / QueuePanel / MiniPlayer
│  └─ common/              # AppIcon / PageShell / EmptyState / UserAvatar / TrackTable / PlaylistPicker
├─ views/                  # Login / Discover / Search / Playlist / Rank / Library / Profile / Settings
│                          # Lyrics / Album / Artist / DesktopLyric
└─ styles/                 # tokens / base / glass / motion
```

## 进程与 IPC

```
Renderer ──contextBridge──> preload(window.kugou) ──ipcRenderer──> Main
                                                                   ├─ 窗口控制
                                                                   ├─ 凭据（safeStorage）
                                                                   └─ 上游状态 / 重启
Renderer ──HTTP(axios)──────────────────────────────────> KuGouMusicApi(127.0.0.1:3000)
```

IPC 通道：

| 通道 | 类型 | 说明 |
| --- | --- | --- |
| `app:info` | invoke | 版本、平台、apiBase、上游状态 |
| `app:open-external` | invoke | 仅允许 http/https |
| `window:minimize` / `window:close` | send | 窗口控制 |
| `window:toggle-maximize` / `window:is-maximized` | invoke | 最大化切换与查询 |
| `window:set-mini` / `window:is-mini` | invoke | 迷你播放器切换与查询（Main 保存/恢复普通窗口几何） |
| `window:maximized-changed` | on | 最大化状态推送 |
| `credential:get` / `credential:set` / `credential:clear` | invoke | 凭据读写与清理 |
| `upstream:status` / `upstream:restart` | invoke | 上游状态查询 / 重启 |
| `upstream:status` | on | 状态变化广播 |
| `lyric-window:open` / `lyric-window:close` / `lyric-window:toggle` | invoke | 桌面歌词窗口开关 |
| `lyric-window:sync` | send | 主窗口推送歌词数据 |
| `lyric-window:data` | on | 桌面歌词窗口接收数据 |
| `lyric-window:state` | on | 窗口开关状态回传（设置项同步） |

## 安全约定

- `contextIsolation: true`、`nodeIntegration: false`，Renderer 不触盘、不持有 Node 能力。
- 凭据经 IPC 交由 Main 用 `safeStorage` 加密落盘至 `userData/credential.bin`；
  系统加密不可用时降级为明文 base64 并打警告（仅开发环境可能出现）。
- 外链统一交给系统浏览器；应用内禁止新开窗口、禁止导航到外部页面。
- 渲染层预置 CSP（`index.html`），允许本地 API 与 HMR WebSocket。

## 下一步（P7 打包）

electron-builder 出包（Windows / macOS）、系统托盘与关闭策略、开机自启、检查更新。
