# music-app 项目长期记忆

## 定位与阶段
- 第三方酷狗音乐概念版桌面播放器：Electron + Vue3 + TS + Vite + Element Plus + Pinia + Vue Router。
- 后端为同级目录 `../KuGouMusicApi`（Express，`module/*.js` 即路由）。
- 设计文档唯一来源：`docs/开发文档.md`（阶段 §八：P0 骨架 → P7 打包）。
- 已完成：P0 骨架、P1 登录、一天 VIP 自动领取、P2 播放核心、P3 歌词、P4 内容、
  P5 签到链（等级查询 / CSCC 首播上报 / 等级同步 / 链路状态展示）、P6 视觉与交互打磨
  （迷你模式 / 封面主色 / 快捷键 / 令牌与对比度）、P4+ 专辑页 `/album/:id` 与歌手页 `/artist/:id`。
- 代码规模（2026-10-20）：src+electron 共 68 文件 / 约 15.8k 行。

## 定稿的形态约束（勿回退）
- **歌词只有两种形态**：歌词页 `/lyrics`（`views/Lyrics.vue`，入口＝单击播放栏封面）+ 桌面歌词独立窗。
  已删侧栏 `LyricPanel.vue` 与全屏 `FullscreenLyrics.vue` 及 `settings.lyricPanel` / `lyric.setFullscreen`。
- **导航入口（2026-10-21 定稿）**：标题栏**头像在前、设置在后**，头像即个人中心入口
  （未登录显示 user 图标，走登录守卫）。侧栏只剩「浏览（发现/搜索/排行榜）」与
  「我的（歌单列表直出）」；「我的」右侧 `+` 打开 `CreatePlaylistDialog`（名称 + 私密），
  调 `/playlist/add`（type=0、`list_create_userid/list_create_listid=0`），成功后刷新并跳新歌单。
  折叠态隐藏分组与 `+`，但保留 36px 歌单封面；用户卡片与「我的音乐/个人中心」入口已删除，
  `/library` 路由保留但无 UI 入口。
- **歌词高亮统一走 `--lyric-grad`**：暗色为亮白（前 40%）→ 青 → 蓝，亮色为主题品牌渐变。
  **不要加辉光 / drop-shadow**（用户明确否决："不要辉光效果，就把亮白拉高"）。
  歌词页与桌面歌词共用同一渐变。
- **全站唯一播放控制入口是 `PlayerBar`**：歌词页不再内联进度条/上下首（PlayerBar 是能力超集）。
- **FM 面板 =「开始收听 / 换一批 / 添加」**，「添加」打开全局 `el-dialog` 选择器
  （`common/PlaylistPicker.vue`，挂在 App.vue、`append-to-body`、带搜索）。
  已删 `stores/likes.ts`、红心按钮、`redPersonalFm`、下拉菜单方案（用户否决过下拉）。
  不显示「已收藏」状态、不提供移除入口。开关状态在 `stores/playlistPicker.ts`。
- **断点续播 = 会话快照，只保存「队列 + 当前曲」**：其余歌必须从 0 开始，不要为每首歌存进度。

## 硬约束（务必遵守）
### 构建 / 运行时
1. preload 必须打成 CJS + `.cjs`（项目 `type: module`，`.mjs` 会按 ESM 解析 `require` 崩）。
2. `vite.config.ts` 必须保留 `delete process.env.ELECTRON_RUN_AS_NODE`（宿主终端会注入）。
3. `base: './'`（打包后 `file://`，绝对路径白屏）。
4. axios 必须 `proxy: false`（继承 HTTP_PROXY → socket hang up）。
5. 上游 spawn 剔除全部代理变量，用 `ELECTRON_RUN_AS_NODE=1` + `process.execPath` 跑 Node。

### 接口契约
6. 登录：响应 200 + body.status；token 失效是 **HTTP 502 + `error_code:20017`**，须同时判 HTTP 与 body。
7. 上游 apicache 缓存 2 分钟 → **所有 GET 与轮询必须带 `timestamp`**；上报的 timestamp 必须放 **URL query**（body 里绕不过缓存）。
8. 扫码：`/login/qr/key` 返回 `qrcode`+`qrcode_img`；`/login/qr/create` 返回 `data.base64`（DataURL）；
   `/login/qr/check` 外层恒 `status:1`，真实状态在 `data.status`（0 过期/1 等待/2 已扫/4 成功）。
   成功后 token/userid/vip 在 `body.data`。不使作用 `/captcha/sent` 发短信。
9. `/song/url` 的 `url` 是数组取 `[0]`，不能用 `??`；失败用 `backupUrl` 重试一次。
10. **取流 hash 必须与音质匹配**：128→`FileHash`、320→`HQFileHash`、flac→`SQFileHash`、high→`ResFileHash`；
    `album_audio_id` 用 `MixSongID`。不匹配返回 `status=2`，易误判为无版权。
11. 付费曲：`fail_process=["pkg","buy"]` + `free_part=1` → 60s 试听（`hash_offset.end_ms`）。
12. 歌单曲目必须传 `gid`（`global_collection_id`），传 specialid 会 20010。
13. 歌词必须 `decode=true` 才有 `decodeContent`；成功标志是 **status=200**，候选在根节点 `candidates`；KRC 字偏移相对行开始。
13a. **KRC 行尾字可能编码为 `<0,0,0>`**（偏移、时长都是 0，如 `<0,0,0>可`）。
    不能直接 `行开始 + 偏移`，否则尾字从行首就整字高亮；必须用游标兜底
    `start = max(lineStart + offset, 上一字结束)`。已修在 `utils/lyric.ts` 的 `parseKrc`。
13b. **KRC 的 `[language:]` 是多块 base64 JSON，不是固定只有译文**：
    `{content:[{language, type, lyricContent}]}`，`type:1` = 中文译文、`type:0` = 日文罗马音，
    `language` 恒为 0 不能用于区分；块数与顺序都不固定（实测 Lemon 是 [译文, 罗马音]，
    打上花火是 [罗马音, 译文]），**必须按 type 选**，不能取 content[0]。
    每块行数与正文严格对齐；译文/音译只有整行文本、没有逐字时间。
    应用层：`LyricLine.translation` / `transliteration`，歌词页在原文下依次渲染
    罗马音（`--text-3`，当前行 15px）与译文；两个独立开关 `lyricTranslation` / `lyricRomaji`
    （默认都开），无对应数据时按钮不显示。
14. 曲目字段四种异构，统一走 `api/track.ts` 归一化：搜索 `FileHash/HQFileHash`、推荐 `hash_320/hash_flac`、
    榜单 `audio_info.hash_*`、歌单 `relate_goods[].bitrate`；时长单位秒/毫秒都有。
15. `/user/listen/report` 须自带 `uuid`(32 位字母数字) + `mid`(纯数字)，start/end 一致（`utils/device.ts` 生成持久化）；
    首播上报按「账号+日期」只做一次；**end 事件不重试**；等级同步 `end` 传 `d_sec`(上次累计)+`diff_sec`(本次新增)，
    响应 `data.grade.data` 可回写；服务端入账可能延迟，不要因此重报。
16. 专辑/歌手：GET 带 `timestamp`；`/album/songs` 的 `pagesize` 上限 50；`/album/detail` 的 `data` 是数组取 `[0]`；
    `/album/songs` 的曲名/歌手/`album_audio_id` 全在 **`base` 子对象**；**`/artist/detail` 响应没有 `status` 字段**；
    `/artist/audios` 用 `audio_name` + `timelength`(ms)。
17. `/youth/day/vip` 的 `receive_day` 是 `YYYY-MM-DD` 字符串（传 `1` 会 304001）；未登录 20002 / 51002。
    领取状态按 userid 存 localStorage（`kugou.concept.dayvip.v1`）+ `/youth/month/vip/record` 双键幂等。
18. 私人 FM：`POST /personal/fm` → 上游 `/v2/personal_recommend`，单批 5 首，未登录退化为随机；
    `time_length` 是秒；推荐理由 `rec_song_info.rec_desc`；batch 播放 + 「换一批」重取。

### 歌单写操作（`/playlist/tracks/add|del`）
- **listid 与 gid 是两套 id**：读曲目用 gid，写曲目必须用 `listid`。
- 写入 `POST /playlist/tracks/add?listid=&data=<歌名>|<hash>|<album_id>|<mixsongid>`；
  歌名里的 `,` `|` 必须先替换成空格（上游按此分段，会错位）。
- **只能写自己创建的歌单**：收藏来的歌单返回 502 + `error_code=30205`（弹框底部提示不可添加数量）。
- 重复添加不报错但 **fileid 会变** → 删除只能用删前重读的 fileid，用旧的会「status 1 但没删掉」。
- 「我喜欢」= `listid=2`、`gid=collection_3_<userid>_2_0`（按名字识别，勿硬编码）；
  **FM 的 `click_red` 不写入「我喜欢」**。

### UI / 布局踩坑
19. **纵向 flex 滚动列表必须给子项 `flex: none`**（子项 `overflow:hidden` 会失效 min-height:auto 保护，条目被压扁）。
20. `<button>` 当 flex 容器子项会被压扁：卡片需 `align-items: stretch` + 封面 `width:100%; flex:0 0 auto`。
21. 窄容器隐藏列用**容器查询**（`container-type: inline-size`），不用视口媒体查询。
22. TrackTable 行是 `div[role=button]`（内嵌跳转按钮，`<button>` 不能嵌套交互元素），
    跳转按钮必须 `@click.stop` **且 `@keydown.stop`**；隐藏专辑列时 `.row--no-album`/`.head--no-album` 要同步改栅格。
23. `AppIcon` **不透传 class 到 svg 根**（模板无 `v-bind="$attrs"`）→ 别用 class 控制它，换图标或外层包 span/button。
24. EP Dialog 外壳 teleport 到 body，scoped 样式命中不到 → 外壳用全局样式块 + `.picker-dialog` 限定作用域。
25. 桌面歌词是独立 BrowserWindow（transparent + alwaysOnTop + skipTaskbar），数据由主窗 IPC 推送；
    transparent 路由下 App 必须跳过主窗初始化，否则递归开窗。
26. 迷你模式窗口几何由 Main 独占（`electron/services/windowMode.ts`）；`window-state.json` 在迷你期间一律不写
    （入口与 400ms 回调都要判 `isMiniWindow`）；迷你不持久化，重启回普通窗口。
27. `getBounds()` 在最大化过渡期不可信（会返回接近工作区尺寸）→ maximize/unmaximize 后 1.2s 抑制窗 + 尺寸合理性校验。
28. 封面取色在渲染层做：`imge.kugou.com` 返回 `ACAO: *`，canvas 可读；失败用 URL 哈希稳定回退色；写入 `--cover-1/2/3`。
29. 快捷键：输入框/textarea/select/contenteditable 不拦截；Space 在 `BUTTON`/`A` 上让位原生激活；
    硬件媒体键走 Media Session，**不要注册 `globalShortcut`**。
30. **`no-drag` 只能标在「交互元素」上，绝不能标在容器上**（2026-10-21 修复）：
    `-webkit-app-region` 对子元素是**继承**语义，给容器加 `no-drag` 会让其撑开的留白整块失效。
    曾把 no-drag 加在 `.titlebar__center`（`flex:1`）与 `.titlebar__actions` 上，
    导致 1280 宽窗口只剩左侧 206px 品牌区可拖（约 16%）。
    正确写法：容器保持可拖，只给 button / label / 控件组加 `no-drag`。
31. **两列详情页的最终形态：锁定视口高度，两列各自内部滚动，页面整体不滚动**
    （2026-10-21 用户拍板；中间方案「两列等高但整页滚动」已被明确否决，
    原话："超出部分出现滚动条也好过你现在整个页面出现滚动条"）。
    以 `views/Rank.vue` 为模板，四个要点：
    ① **不能用 `:deep(.page)`，要用 class 透传 `<PageShell class="rank-page">`**（踩过）：
       `:deep(.page)` 编译成 `[data-v-xxx] .page`，要求 `.page` 有**祖先**带 scope id；
       而 `.page` 是页面模板的根元素、自己带 scope id 却没有这样的祖先 → **选择器永远落空**
       （产物里看得到规则，但零命中）。写成 `.rank-page` 则编译为 `.rank-page[data-v-xxx]`，
       正好命中「自身带 scope id」的根元素。
       PageShell 默认 `min-height:100%` 撑不出确定高度，必须改 `height: 100%`，
       才能沿 `.page → .page__body → .layout → 两列` 传下去。
    ② `.layout { grid-template-rows: minmax(0, 1fr); height: 100% }` ——
       **minmax(0,1fr) 是关键**：写 `1fr` 或 `auto` 时轨道最小尺寸 = 内容高，会把页面撑破。
    ③ 两列各自 `min-height: 0` + `overflow-y: auto`。
    ④ 右侧再拆 `.detail__head{flex:none}` + `.detail__scroll{flex:1;min-height:0;overflow-y:auto}`
       让表头固定、只有曲目区滚动；并去掉 `.detail` 的 `min-height:420px`
       （它会阻止收缩，窗口一矮就溢出）。
    无头实测（stage 700 / 榜单 30 / 曲目 50）：pageScrolls=false，list=detail=580 等高，
    两者均可滚动，detailScroll=506 独立滚动。
    弯路记录：先改成「默认 stretch + 去 max-height」→ 两列等高了但整页滚（list 2074/detail 2074），
    用户否决后才改成现在的锁定高度方案。窄屏 900px 断点：`grid-template-rows: auto minmax(0,1fr)`
    + `.list { max-height: 260px }`。
30. **无头排查渲染 / 布局问题**（2026-10-21 补齐全流程与坑）：
    `vite build` → 写 `dist/measure.js`（外部脚本，CSP `script-src 'self'` 拦内联）→
    `sed` 注入 `dist/index.html` → `python -m http.server 8123 --bind 127.0.0.1` →
    `msedge --headless=new --disable-gpu --no-proxy-server --virtual-time-budget=15000
    --dump-dom "http://127.0.0.1:8123/index.html#/rank"` → grep `MEASURE:` →
    kill server + 重新 `vite build` 清除注入（emptyOutDir 会清掉）。
    坑：① python server 必须用 `run_in_background`（普通 `&` 会被回收）；
    ② curl / msedge **都要绕过代理**（`--noproxy '*'` / `--no-proxy-server`），否则 502；
    ③ 无数据时可在 measure.js 里往 DOM 塞假元素，照样能测滚动与高度。
    **警告：不要用「复刻 CSS 的对照 HTML」代替真实产物验证** —— 对照页不带 scoped 编译，
    测不出 `:deep` 选择器落空这类问题（2026-10-21 因此误判过一次）。

## 代码约定
- 颜色/圆角/动效只引用 `styles/tokens.css` 变量，禁止裸色值。
- 所有请求走 `src/api/request.ts` 的 `apiGet/apiPost`，鉴权头由 auth store 写入快照。
- 渲染层不触盘：凭据、窗口状态经 `window.kugou` IPC 交 Main。
- 组件命名：`layout/` 框架层、`player/` 播放层、`common/` 通用层；图标统一 `AppIcon`（不引图标库）。
- 登录态两段式：`boot()` 只读凭证（守卫可 await），`hydrate()` 后台续期 + 拉资料（失败不清凭证，除非 20017/401）；
  登录后统一 `auth.completeLogin()`：落盘 → `/login/token` 续期 → `/user/info`。
- 调试技巧：本机 `credential.bin` 是 Chromium OSCrypt `v10`（AES-256-GCM），主密钥在 `Local State` 的
  `os_crypt.encrypted_key`（DPAPI）。沙箱内可行组合 = **Python ctypes 调 CryptUnprotectData + Node crypto 解 GCM**；
  只打印歌单名/字段，绝不打印 token，用完即删临时密钥。

## 未做的事（有结论但暂缓 / 被否决）
- **本地收藏**：上游无「查询是否已喜欢」接口，曾实现 localStorage 版被用户以「后端没接口就不做」否决，勿再做。
- **UI 库选型：维持「自研为主 + EP 作复杂控件」，不做「统一为 EP」**（2026-10-20 晚二次论证，结论维持）
  - 量化依据（本机实测）：自研全局样式仅 **657 行 / 5 文件**（tokens 130 + base 154 + glass 231 +
    motion 137 + index 5），组件 scoped 样式约 4.2k 行（25 个 vue 文件），
    全部 CSS 产物合计约 126 KB。
    EP 全套 CSS **403 KB**（index.css 361 KB）；单组件 CSS：button 19.5 / table 17.3 / tabs 16.3 /
    menu 10.5 / input 10.9 / select 8.4 / switch 3.8 / slider 3.7 / dialog 3.5 KB。
    EP 组件 JS（es 源码）：**table 164 KB**、select 66.5、slider 39.3、menu 38.6、tabs 29.8 KB。
    当前 EP 仅 **10 处 / 5 组件**（dialog / input / select / option / switch）；PlaylistPicker 挂在
    App.vue ⇒ EP 的 dialog+input CSS 已进入**入口 chunk**（index-*.css 60.7 KB），边际成本非从零起算。
  - 三条理由：① **目标集几乎为空** —— 能统一的只有设置页选择/开关、弹框、输入框，而这 4 项
    **已经在用 EP**；el-menu / el-tabs 虽可替代侧栏与页签，但项目里 `.tab` 是胶囊状筛选器，
    与 el-tabs 语义不匹配，需大量覆写。② **换即降级** —— 进度条/音量条改 el-slider 需覆写约八成样式；
    TrackTable 改 el-table 是 **164 KB JS 换 229 行 CSS**，且行内嵌跳转按钮、容器查询隐藏列、
    当前曲跳动条全部要重写。③ **EP 无对应物** —— 极光背景、封面取色、KRC 逐字扫光、迷你窗、
    桌面歌词窗、标题栏 no-drag 拖拽区，这些正是播放器的差异化所在。
  - **真正的痛点与 EP 无关**（这两项才值得动手）：
    ① `.tab` 被 5 个页面各写一遍（41 次使用）+ Settings 的 `.segmented` = 同一交互三套实现，
       抽 `common/SegmentedControl.vue` 即可解决；
    ② EP 变量桥接仅 **14/56**，未桥接高影响项 `--el-switch-off-color`、`--el-fill-color-light`、
       `--el-border-color-hover`、`--el-box-shadow-light` → 亮色主题下这几个控件观感不受控。
  - 若日后改为彻底移除 EP：须**同步**删 `main.ts` 的 `element-plus/theme-chalk/dark/css-vars.css`
    （它必须早于 `styles/index.css` 加载）与 `tokens.css` 末尾桥接块，并自研 `ToggleSwitch.vue`（约 20 行）。
    改完 EP 组件须**先 `vite build` 再 typecheck**（`components.d.ts` 由 build 生成）。
  - 分界线（何时改用库）：交互状态机 >3 层（级联 / 树形 / 日期区间 / 可编辑表格 / 异步表单校验联动）。
    目前无此类需求；若产品转向「内容管理型工具」再评估。

## 发现页状态缓存（`stores/discover.ts`）
- 路由卸载 `Discover.vue` 会销毁组件内 `ref` → 切回重新请求、FM 换一批。解法：FM / 每日推荐 / 排行榜 / 热搜 提到 Pinia。
- 缓存策略：FM 仅「换一批」或登录态变化重取；每日推荐按 userid 只取一次；榜单/热搜 10 分钟 TTL；
  `resetForLogout()` 清账号相关数据。页面组件只做展示 + 包装 `refreshFm/refreshEveryday`。
