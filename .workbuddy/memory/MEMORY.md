# music-app 项目长期记忆

## 定位与阶段
- 第三方酷狗音乐概念版桌面播放器：Electron + Vue3 + TS + Vite + Element Plus + Pinia + Vue Router。
- 后端为同级目录 `../KuGouMusicApi`（Express，`module/*.js` 即路由）。
- 设计文档唯一来源：`docs/开发文档.md`，阶段划分见 §八（P0 骨架 → P7 打包）。
  已完成：P0 骨架、P1 登录、一天 VIP 自动领取（§4.3 领取部分）、P2 播放核心、P3 歌词、P4 内容、
  P5 签到链（等级查询 / CSCC 首播上报 / 等级同步 / 链路状态展示）、
  P4+ 专辑页 `/album/:id` 与歌手页 `/artist/:id`（TrackTable 专辑列 / 歌手名跳转）。
- 歌词 UI 形态（2026-10-20 定稿）：**只有「歌词页」+「桌面歌词」两种**。
  歌词页 = 路由 `/lyrics`（`views/Lyrics.vue`），入口是**单击底部播放栏封面**（原为双击进全屏）。
  已删除侧栏歌词 `LyricPanel.vue` 与全屏覆盖层 `FullscreenLyrics.vue`，
  及 `settings.lyricPanel` / `lyric.setFullscreen` / `LYRIC_PANEL_MIN_WIDTH`。
  **不要再把侧栏/全屏两种形态加回来**。
- **全站唯一的播放控制入口是 `PlayerBar`**（2026-10-20 定稿）：歌词页内联的进度条与
  上一首/播放/下一首已删除，`/lyrics` 下只显示 PlayerBar。理由：PlayerBar 是能力超集
  （音量/模式/队列/音质/错误重试），页脚版是纯子集。**不要在歌词页再补一套播放控制**。

## 上游接口实测结论（P1 验证）
- 登录响应是 **200 + body.status**；但 token 失效时酷狗返回 **HTTP 502 + `{"status":0,"error_code":20017}`**，
  必须同时看 HTTP 状态与 body 的 `error_code`，否则会把失效误判成临时网络错误。
- 上游 apicache 缓存 2 分钟（server.js 全局中间件），**所有 GET 与轮询必须带 `timestamp`**，
  否则扫码状态会一直读到第一次的缓存。
- `/login/qr/key` 直接返回 `data.qrcode` + `data.qrcode_img`；`/login/qr/create` 返回 `data.base64`（DataURL）。
- `/login/qr/check` 外层恒为 `status:1`，真实状态在 `data.status`（0 过期 / 1 等待 / 2 已扫 / 4 成功）。
- 登录成功后 token/userid/vip 字段在 `body.data`（模块把 secu_params 解密结果合并进去了）。
- `/captcha/sent` 可发短信，但按文档约定**不使用**，验证码由用户在官方端获取。
- **`/youth/day/vip` 的 `receive_day` 是日期字符串 `YYYY-MM-DD`**，传 `1` 会 304001（日期格式错误）。
  未登录返回 `20002`（无 cookie）/ `51002`（失效 token），HTTP 可能是 502。
- 领取状态按 userid 存 localStorage（`kugou.concept.dayvip.v1`），配合 `/youth/month/vip/record` 做双键幂等。

## 硬约束（务必遵守）
1. **preload 必须打成 CJS + `.cjs`**：项目 `type: module`，`.mjs` 会按 ESM 解析 `require` 导致崩。
2. **`vite.config.ts` 必须保留 `delete process.env.ELECTRON_RUN_AS_NODE`**：宿主终端会注入该变量。
3. **`base: './'`**：打包后 `file://` 加载，绝对路径会白屏。
4. **axios 必须 `proxy: false`**：继承 HTTP_PROXY 会让酷狗请求 socket hang up。
5. 上游 spawn 需剔除全部代理变量，并用 `ELECTRON_RUN_AS_NODE=1` + `process.execPath` 跑 Node。
6. `/song/url` 返回的 `url` 是数组，取 `[0]`，不能用 `??`（§7.4）；失败时用 `backupUrl` 重试一次。
7. **取流 hash 必须与音质匹配**：128→`FileHash`、320→`HQFileHash`、flac→`SQFileHash`、high→`ResFileHash`；
   `album_audio_id` 用 `MixSongID`。hash 不匹配会返回 `status=2`，极易误判成没版权。
8. 付费曲：`fail_process=["pkg","buy"]` + `free_part=1` → 60s 试听（`hash_offset.end_ms`）。
9. 歌单曲目必须传 `gid`（global_collection_id），传 specialid 会 20010。
10. 歌词必须 `decode=true` 才有 `decodeContent`；歌词接口成功标志是 **status=200**，
    候选在响应根节点 `candidates`；KRC 字偏移相对**行开始**。
11. 桌面歌词是独立 BrowserWindow（transparent + alwaysOnTop + skipTaskbar），
    数据由主窗口 IPC 推送；transparent 路由下 App 必须跳过主窗口初始化，否则递归开窗。
12. 曲目字段四种异构，统一走 `api/track.ts`：搜索 `FileHash/HQFileHash`、推荐 `hash_320/hash_flac`、
    榜单 `audio_info.hash_*`、歌单 `relate_goods[].bitrate`；时长单位既有秒也有毫秒。
13. `<button>` 当 flex 容器时子项会被压扁：卡片需 `align-items: stretch` + 封面 `width:100%; flex:0 0 auto`。
14. 窄容器隐藏列用**容器查询**（`container-type: inline-size`），不要用视口媒体查询。
15. `/user/listen/report` 必须自带 `uuid`（32 位字母数字）+ `mid`（纯数字），start/end 必须一致；
    本应用在 `src/utils/device.ts` 生成并持久化（不要求 mid = md5(uuid)）。
16. 上报 `timestamp` 必须放 **URL query**（body 里的 timestamp 绕不过 apicache）。
17. 首播上报按「账号 + 日期」只做一次；end 事件**不重试**（超时也可能已记账，重发会重复计时长）。
18. 等级同步：`end` 传 `d_sec`（上次服务端累计）+ `diff_sec`（本次新增秒），响应 `data.grade.data` 可直接回写；
    服务端累计时长可能延迟入账，不要因此重报。
19. 专辑 / 歌手接口：GET 同样要带 `timestamp`；**`/album/songs` 的 `pagesize` 上限 50**（60 起 20010）；
    `/album/detail` 的 `data` 是数组取 `[0]`；`/album/songs` 的曲名 / 歌手 / `album_audio_id`
    全在 **`base` 子对象**里（取流必传，不读就是「未知曲目」+ 取不到流）；
    **`/artist/detail` 响应没有 `status` 字段**，只能靠 `data` 判定成功；
    `/artist/audios` 用 `audio_name` + `timelength`(ms)。
20. TrackTable 的行是 `div[role=button]`（内部要放专辑 / 歌手跳转按钮，`<button>` 不能嵌套交互元素），
    跳转按钮必须 `@click.stop` **且 `@keydown.stop`**（行用 keydown.enter 起播，回车会冒泡成「跳转 + 起播」）；
    隐藏专辑列时 `.row--no-album` / `.head--no-album` 要同步改栅格，否则时长会串到专辑列。
21. **上游没有「查询某首歌是否已喜欢」的接口**，`favorite_count` 只读、FM 的 `click_red` 只写不读。
    曾实现过本地收藏版（`stores/favorite.ts` + 红心按钮），**用户以「后端没接口就不做」为由要求回退**。
    **不要再走 localStorage 收藏**。
21a. **纵向 flex 滚动列表必须给子项 `flex: none`**：容器 `flex-direction:column` + `max-height`
    时子项默认 flex-shrink:1，若子项自身 `overflow:hidden`（如 `.panel`）则 min-height:auto
    保护失效，条目一多全被均分压扁（Rank 页实测 55 张卡压成 22px）。溢出必须交给
    overflow-y 滚动，而不是让 flex 收缩。
21b. **无头排查渲染问题可行**：`vite build` 后用 `python -m http.server` 托管 dist
    （file:// 打不开 ES module），往 index.html 注入外部测量脚本（CSP `script-src 'self'`
    拦内联），`msedge --headless=new --dump-dom/--screenshot` + `MEASURE:` 文本节点读数据；
    用完重建 dist 即可清除注入。
22. **FM 面板的最终形态（2026-10-20 第四轮定稿）：红心按钮已被「添加」按钮取代，选择器是全局弹框**。
    - UI：`开始收听 / 换一批 / 添加`。点「添加」打开**全局 `el-dialog` 弹框**
      （`components/common/PlaylistPicker.vue`，挂在 `App.vue`、`append-to-body`、带搜索框），
      **不再是按钮下的下拉菜单**（用户明确否决过下拉：滚动容器会裁切、放不下几十个歌单）。
    - 开关状态在 `stores/playlistPicker.ts`（`open(track)` / `close()`），任意页面可复用；
      页面侧只写 `picker.open(lead)`，不再各自维护弹框状态。
    - 数据：歌单列表复用 `stores/library.ts`（`PlaylistSummary` 已补 `listid`，并有
      `noteTrackAdded()` 本地 +1）；**只列 `mine` 的歌单**；收藏来的歌单（type=1）上游拒写
      （502 / 30205），弹框底部提示「另有 N 个收藏来的歌单不可添加」。
    - 写入：`api/playlist.ts` 的 `addTrackToPlaylist(listid, track)`；
      成功后弹框内回显 800ms 再关闭（不要弹 ElMessage，会与弹框抢层级）。
    - 已删除：`stores/likes.ts`、「我喜欢」索引比对、`redPersonalFm`（click_red 动作）、
      `Track.songId`、`--fav` 令牌、`.fm__red*` / `.fm__menu*` / `.fm__scrim` 样式。
      **不要再把这些加回来**。
    - 已确认的交互取舍（后续不要再提「红心」）：不显示「已收藏」状态、不提供移除入口。
    - EP Dialog 外壳 teleport 到 body，scoped 样式命中不到 → 只在外壳上用全局样式块 +
      `.picker-dialog` 限定作用域（PlaylistPicker.vue 末尾）。

23. **断点续播只服务「跨应用重启」，不服务「会话内切歌」**（2026-10-20 定稿）：
    手动切走的曲目再切回来必须从 0 开始，这是用户明确要求的预期。
    - 实现：`player.ts` 里 `touched`（内存 Set，不落盘）判定——装载过即从 0 起并清落盘值；
      只有本会话未装载过的 hash 才 `readResume()`。
    - `loadCurrent(autoPlay, keepPosition)` 第二参数只给 `setQuality` / `retry` 用（同曲重载保位置），
      **任何切歌路径必须为 false**。
    - `switching` 标记守护写盘：替换 `audio.src` / `load()` 会异步派生 `pause`，
      此刻 `current` 已指向新曲，不拦会串写（旧曲秒数记到新曲头上）。
    - 增量基准 `lastPos` 必须在 `seek` / `loadedmetadata` 落位 / 单曲循环重播三处同步，
      否则 `addListenTime` 会把跳变算成负增量。
    - 位置 <3s 或 ≥ duration-3 一律清断点（避免重启停在开头/末尾）。
    - 注意 `playAt()` 对「同一 index + 同一 hash」走短路，点当前曲不 `resetProgress`，
      否则进度条会闪一下归零。

## 歌单写操作（`/playlist/tracks/add|del`）实测
- **listid 与 gid 是两套 id**：读曲目用 gid（`global_collection_id`），写曲目必须用 `listid`。
- 写入：`POST /playlist/tracks/add?listid=<listid>&data=<歌名>|<hash>|<album_id>|<mixsongid>`；
  `data` 里的歌名会被上游改写为「歌手 - 歌名」，只传歌名即可；歌名里的 `,` `|` 必须先替换成空格，
  否则上游按 `,`、`|` 分段会错位。
- **只能写自己创建的歌单**：收藏来的歌单返回 HTTP 502 + `status:0` + `error_code=30205`。
- 重复添加同一首不报错（status 1）也不产生第二条，但**该曲的 `fileid` 会变**；
  删除（`/playlist/tracks/del?listid=&fileids=<fileid>`）只能用删前重读到的 fileid，
  用旧 fileid 会「status 1 但没删掉」——静默失效，排查时优先怀疑这里。
- 「我喜欢」= `listid=2`、`gid=collection_3_<userid>_2_0`（按名字识别，别硬编码）；
  **FM 的 `click_red` 不会写入「我喜欢」**（实测 count 不变），只影响 FM 推荐偏好。
- 调试技巧：本机 `credential.bin` 是 Chromium OSCrypt 的 `v10`（AES-256-GCM），主密钥在
  `Local State` 的 `os_crypt.encrypted_key`（DPAPI 保护）。沙箱里 `Add-Type` 被拦、PowerShell 5.1 无
  `AesGcm`，可行组合是 **Python ctypes 调 CryptUnprotectData + Node crypto 解 GCM**；
  验证接口时只打印歌单名/字段，绝不打印 token，用完立即删临时密钥。

## 代码约定
- 颜色/圆角/动效只引用 `styles/tokens.css` 变量，禁止裸色值。
- 所有请求走 `src/api/request.ts` 的 `apiGet/apiPost`，鉴权头由 auth store 写入快照。
- 渲染层不触盘：凭据、窗口状态经 `window.kugou` IPC 交 Main 处理。
- 组件命名：`layout/` 框架层、`player/` 播放层、`common/` 通用层；图标统一用 `AppIcon`（不引图标库）。
  **`AppIcon` 不透传 class 到 svg 根**（模板无 `v-bind="$attrs"`），别用 `class` 控制它的显隐/样式，
  直接换图标或在外层包 `<span>`/`<button>` 挂 class。
- 登录态两段式：`boot()` 只读凭证（守卫可 await），`hydrate()` 后台续期 + 拉资料（失败不清凭证，除非 20017/401）。
- 登录后统一走 `auth.completeLogin()`：落盘 → `/login/token` 续期 → `/user/info`。

## UI 技术选型决策（2026-10-20，结论已定，暂不执行）
- 方向：以自研样式为主；Element Plus 只作为「复杂表单控件按需库」保留，不作 UI 基础。
  用户选择**暂不改动**，维持现状（设置页 3 类控件仍用 Element）。
- 量化依据：设置页构建 CSS **34.0 KB / 56 个 el- 选择器**，其余页面 1.6–6.5 KB（5–20 倍差）。
- 桥接覆盖率 **14 / 56 = 25%**：组件实际引用 56 个 `--el-*`，`tokens.css` 只桥接 14 个。
  高影响未桥接项：`--el-switch-off-color`（关闭态完全不受令牌控制）、`--el-fill-color-light`、
  `--el-border-color-hover`、`--el-box-shadow-light` → 亮色主题存在色差盲区，改动主题时需实测。
- 功能重叠：`Settings.vue` 的「主题」用自研 `.segmented`，「音质(4项)/播放模式(3项)」用 `el-select`，
  同页两套控件语言；`el-select` 的搜索/多选/远程能力均未使用，与 segmented 完全同构。
- 若日后执行（成本已评估为低）：抽 `common/SegmentedControl.vue`（提自 `.segmented`）三处复用；
  新建 `common/ToggleSwitch.vue`（约 20 行，色取 `--brand-grad` / `--bg-3`）；
  移除依赖时须**同步**删 `main.ts` 的 `element-plus/theme-chalk/dark/css-vars.css`
  （它必须早于 `styles/index.css` 加载，删漏会丢变量）与 `tokens.css` 末尾的桥接块。
- 引入 UI 库的分界线：交互状态机 >3 层（级联/树形/日期区间/可编辑表格/异步表单校验联动）就用库，否则自研。
- 2026-10-20 用户明确「这里你觉得合适可以直接使用 Element Plus」：**歌单选择弹框**用 `el-dialog` + `el-input`
  （遮罩 / 焦点管理 / Esc / 滚动锁定自己写不值得）。EP 走 unplugin 自动导入，
  `components.d.ts` 由 `vite build` 重新生成 —— **改完 EP 组件先 build 再 typecheck**，否则声明缺失。


## 私人 FM（`/personal/fm`）实测要点
- `POST /personal/fm` ⇒ `module/personal_fm.js`，上游 `/v2/personal_recommend`；**未登录可调**，匿名退化为随机推荐。
- 单批 **5 首**（`data.song_list`），是电台式小队列；继续拉歌需带上一首的 `hash` / `playtime` 续播，
  当前实现按批次播放 + 「换一批」重取（`src/api/content.ts` 的 `fetchPersonalFm`）。
- 字段与每日推荐同族：`hash` / `hash_320` / `hash_flac` / `time_length`（**秒**）/ `mixsongid` /
  `author_name` / `singerinfo[]` / `trans_param.union_cover`，`normalizeTracks` 可直接吃。
- 推荐理由在 `rec_song_info.rec_desc`（匿名时恒为「正在随机推荐歌曲」），可当副文案展示。
- `timestamp` 必须同时进 **query**，否则 2 分钟 apicache 会把「换一批」变成同一批。

## 发现页状态缓存（`stores/discover.ts`）
- 路由卸载 `Discover.vue` 会销毁组件内 `ref`，导致切回发现页重新请求、私人 FM「换一批歌」。
  解法：四块数据（FM / 每日推荐 / 排行榜 / 热搜）提到 Pinia，生命周期跟随账号会话。
- 缓存策略：FM 仅「换一批」或登录态变化重取；每日推荐按 `userid` 只取一次；
  榜单/热搜 10 分钟 TTL；`resetForLogout()` 清账号相关数据。
- 页面组件只做展示 + 包装 `refreshFm/refreshEveryday`，不要把请求状态再放回组件。
