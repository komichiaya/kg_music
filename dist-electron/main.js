var zt = Object.defineProperty;
var Lt = (t, e, n) => e in t ? zt(t, e, { enumerable: !0, configurable: !0, writable: !0, value: n }) : t[e] = n;
var g = (t, e, n) => Lt(t, typeof e != "symbol" ? e + "" : e, n);
import { safeStorage as $, app as l, screen as P, BrowserWindow as b, Tray as Nt, Menu as pt, nativeImage as Wt, net as $t, ipcMain as u, shell as mt } from "electron";
import a from "node:path";
import { fileURLToPath as wt } from "node:url";
import y from "node:fs/promises";
import { spawn as Ft } from "node:child_process";
import { EventEmitter as yt } from "node:events";
import gt from "node:fs";
import jt from "node:net";
const F = "credential.bin", q = "window-state.json", v = (t) => a.join(l.getPath("userData"), t);
async function Tt(t, e) {
  const n = `${t}.${process.pid}.tmp`;
  await y.writeFile(n, e, "utf8"), await y.rename(n, t);
}
function St(t) {
  if (!t || typeof t != "object") return null;
  const e = t;
  return typeof e.token != "string" || e.token.length === 0 || e.userid === void 0 || e.userid === null ? null : {
    token: e.token,
    userid: String(e.userid),
    vip_type: Number(e.vip_type ?? 0) || 0,
    vip_token: typeof e.vip_token == "string" ? e.vip_token : "",
    t1: typeof e.t1 == "string" ? e.t1 : void 0,
    dfid: typeof e.dfid == "string" ? e.dfid : void 0
  };
}
async function Ct() {
  try {
    const t = await y.readFile(v(F), "utf8"), e = JSON.parse(t);
    if (!e || typeof e.data != "string") return null;
    const n = Buffer.from(e.data, "base64");
    let r;
    if (e.enc === "safe") {
      if (!$.isEncryptionAvailable())
        return console.warn("[store] 系统加密不可用，无法解密既有凭据，按未登录处理"), null;
      r = $.decryptString(n);
    } else
      r = n.toString("utf8");
    return St(JSON.parse(r));
  } catch (t) {
    return (t == null ? void 0 : t.code) !== "ENOENT" && console.warn("[store] 读取凭据失败，按未登录处理：", t), null;
  }
}
async function Bt(t) {
  const e = St(t);
  if (!e) throw new Error("凭据结构不合法：缺少 token 或 userid");
  const n = JSON.stringify(e), r = $.isEncryptionAvailable(), i = {
    v: 1,
    enc: r ? "safe" : "plain",
    data: r ? $.encryptString(n).toString("base64") : Buffer.from(n, "utf8").toString("base64")
  };
  return await y.mkdir(a.dirname(v(F)), { recursive: !0 }), await Tt(v(F), JSON.stringify(i)), r || console.warn("[store] safeStorage 不可用，凭据以未加密形式落盘（仅建议在开发环境出现）"), r;
}
async function Ht() {
  try {
    await y.unlink(v(F));
  } catch (t) {
    (t == null ? void 0 : t.code) !== "ENOENT" && console.warn("[store] 清除凭据失败：", t);
  }
}
async function Vt() {
  try {
    const t = await y.readFile(v(q), "utf8"), e = JSON.parse(t);
    return !e || !Number.isFinite(e.width) || !Number.isFinite(e.height) ? null : e;
  } catch {
    return null;
  }
}
async function bt(t) {
  try {
    await y.mkdir(a.dirname(v(q)), { recursive: !0 }), await Tt(v(q), JSON.stringify(t));
  } catch (e) {
    console.warn("[store] 保存窗口状态失败：", e);
  }
}
const Gt = [
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "npm_config_proxy",
  "npm_config_https_proxy"
], et = 3e3, nt = 45e3, Kt = 400, rt = 3, qt = 5e3;
function I(t, e = "127.0.0.1", n = 600) {
  return new Promise((r) => {
    const i = new jt.Socket();
    let o = !1;
    const d = (h) => {
      o || (o = !0, i.removeAllListeners(), i.destroy(), r(h));
    };
    i.setTimeout(n), i.once("connect", () => d(!0)), i.once("timeout", () => d(!1)), i.once("error", () => d(!1)), i.connect(t, e);
  });
}
function H() {
  const t = Number(process.env.KUGOU_API_PORT ?? et);
  return Number.isInteger(t) && t > 0 && t < 65536 ? t : et;
}
function Jt() {
  const t = [];
  process.env.KUGOU_API_DIR && t.push(process.env.KUGOU_API_DIR), l.isPackaged && (t.push(a.join(process.resourcesPath, "KuGouMusicApi")), t.push(a.join(a.dirname(l.getPath("exe")), "KuGouMusicApi"))), t.push(a.resolve(l.getAppPath(), "..", "KuGouMusicApi")), t.push(a.resolve(process.cwd(), "..", "KuGouMusicApi")), t.push(a.resolve(process.cwd(), "KuGouMusicApi"));
  for (const e of t)
    try {
      if (gt.existsSync(a.join(e, "app.js"))) return e;
    } catch {
    }
  return null;
}
class Yt extends yt {
  constructor() {
    super();
    g(this, "child", null);
    g(this, "stopping", !1);
    g(this, "restartTimer", null);
    g(this, "watchTimer", null);
    g(this, "port", H());
    g(this, "apiDir", Jt());
    g(this, "status", {
      state: "idle",
      port: H(),
      baseUrl: `http://127.0.0.1:${H()}`,
      pid: null,
      attempts: 0,
      lastError: null,
      logTail: [],
      apiDir: null
    });
    this.status.apiDir = this.apiDir, this.apiDir || console.warn("[upstream] 未找到 KuGouMusicApi 工程目录，将以「仅复用外部服务」模式运行");
  }
  getStatus() {
    return { ...this.status, logTail: [...this.status.logTail] };
  }
  /** 启动上游：优先复用已监听端口，其次拉起子进程 */
  async start() {
    return this.stopping ? this.getStatus() : this.child ? this.getStatus() : (this.patch({ state: "starting", lastError: null }), await I(this.port) ? (console.info(`[upstream] 端口 ${this.port} 已有服务监听，复用外部实例`), this.patch({ state: "external", pid: null }), this.startExternalWatch(), this.getStatus()) : process.env.KUGOU_API_MANAGED === "false" ? (this.patch({ state: "failed", lastError: "已配置 KUGOU_API_MANAGED=false，且未发现外部上游服务" }), this.getStatus()) : this.apiDir ? (this.spawnChild(), await this.waitHealthy(), this.getStatus()) : (this.patch({
      state: "failed",
      lastError: "未找到 KuGouMusicApi 工程目录，可通过环境变量 KUGOU_API_DIR 指定"
    }), this.getStatus()));
  }
  /** 手动重启：先停止再启动，供设置页「重启服务」调用 */
  async restart() {
    return await this.stop({ transient: !0 }), this.stopping = !1, this.patch({ attempts: 0 }), this.start();
  }
  /** 停止上游；transient=true 表示这是重启流程的一部分，不改变最终状态语义 */
  async stop(n = {}) {
    this.clearRestartTimer(), this.stopExternalWatch(), n.transient || (this.stopping = !0);
    const r = this.child;
    if (!r) {
      n.transient || this.patch({ state: "stopped", pid: null });
      return;
    }
    await new Promise((i) => {
      const o = setTimeout(() => {
        try {
          r.kill("SIGKILL");
        } catch {
        }
        i();
      }, 3e3);
      r.once("exit", () => {
        clearTimeout(o), i();
      });
      try {
        r.kill();
      } catch {
        clearTimeout(o), i();
      }
    }), this.child = null, n.transient || this.patch({ state: "stopped", pid: null });
  }
  spawnChild() {
    var o, d, h, D;
    if (!this.apiDir) return;
    const n = {
      ...process.env,
      // 用 Electron 二进制以 Node 模式运行上游，打包后无需额外安装 Node
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(this.port),
      // 概念版：上游 platform=lite 对应酷狗概念版的接口行为
      platform: "lite"
    };
    for (const m of Gt) delete n[m];
    if (l.isPackaged) {
      const m = a.join(l.getPath("userData"), "upstream");
      try {
        gt.mkdirSync(m, { recursive: !0 }), n.KUGOU_API_DEVICE_FILE = a.join(m, "device.json");
      } catch (B) {
        console.warn("[upstream] 创建设备身份目录失败，将退化为写入安装目录", B);
      }
    }
    const r = [a.join(this.apiDir, "app.js"), `--port=${this.port}`, "--swagger=false", "--platform=lite"];
    console.info(`[upstream] 启动子进程：${a.join(this.apiDir, "app.js")} (port=${this.port})`);
    const i = Ft(process.execPath, r, {
      cwd: this.apiDir,
      env: n,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: !0
    });
    this.child = i, this.patch({ pid: i.pid ?? null }), (o = i.stdout) == null || o.setEncoding("utf8"), (d = i.stderr) == null || d.setEncoding("utf8"), (h = i.stdout) == null || h.on("data", (m) => this.appendLog(m)), (D = i.stderr) == null || D.on("data", (m) => this.appendLog(m)), i.once("error", (m) => {
      console.error("[upstream] 子进程启动失败：", m), this.patch({ lastError: `子进程启动失败：${m.message}` });
    }), i.once("exit", (m, B) => {
      this.child = null;
      const tt = `上游进程退出（code=${m ?? "null"}, signal=${B ?? "null"}）`;
      if (console.warn(`[upstream] ${tt}`), this.stopping) {
        this.patch({ state: "stopped", pid: null });
        return;
      }
      this.handleUnexpectedExit(tt);
    });
  }
  /** 等待端口就绪；期间子进程退出则立即判定失败，不做满时长空等 */
  async waitHealthy() {
    const n = Date.now() + nt;
    for (; Date.now() < n; ) {
      if (await I(this.port)) {
        this.patch({ state: "running", lastError: null }), console.info(`[upstream] 服务就绪：${this.status.baseUrl}`);
        return;
      }
      if (!this.child) return;
      await new Promise((r) => setTimeout(r, Kt));
    }
    this.patch({ state: "failed", lastError: `上游在 ${nt / 1e3}s 内未就绪` }), this.child && this.stop();
  }
  handleUnexpectedExit(n) {
    (async () => {
      if (await I(this.port)) {
        this.patch({ state: "external", pid: null, lastError: null }), this.startExternalWatch();
        return;
      }
      if (this.status.attempts >= rt) {
        this.patch({ state: "failed", pid: null, lastError: `${n}；已自动重启 ${rt} 次仍失败` });
        return;
      }
      const r = this.status.attempts + 1, i = 1e3 * r;
      this.patch({ state: "starting", pid: null, attempts: r, lastError: n }), console.info(`[upstream] ${i}ms 后第 ${r} 次自动重启`), this.clearRestartTimer(), this.restartTimer = setTimeout(() => {
        this.restartTimer = null, !(this.stopping || this.child) && (this.spawnChild(), this.waitHealthy());
      }, i);
    })();
  }
  /** 外部实例无 exit 事件可监听，改为轮询端口，断开后状态及时回落 */
  startExternalWatch() {
    this.stopExternalWatch(), this.watchTimer = setInterval(() => {
      (async () => {
        if (this.child) return;
        !await I(this.port) && this.status.state === "external" && (this.patch({ state: "failed", lastError: "外部上游服务已断开" }), this.stopExternalWatch());
      })();
    }, qt);
  }
  stopExternalWatch() {
    this.watchTimer && (clearInterval(this.watchTimer), this.watchTimer = null);
  }
  clearRestartTimer() {
    this.restartTimer && (clearTimeout(this.restartTimer), this.restartTimer = null);
  }
  appendLog(n) {
    const r = n.split(/\r?\n/).filter((o) => o.trim().length > 0);
    if (r.length === 0) return;
    for (const o of r) console.log(`[upstream] ${o}`);
    const i = [...this.status.logTail, ...r].slice(-40);
    this.patch({ logTail: i });
  }
  patch(n) {
    const r = n.state !== void 0 && n.state !== this.status.state;
    this.status = { ...this.status, ...n }, (n.state !== void 0 || r) && this.emit("status", this.getStatus());
  }
}
const A = new Yt(), xt = a.dirname(wt(import.meta.url)), it = 860, st = 176;
let f = null;
function ot(t) {
  for (const e of b.getAllWindows())
    e.isDestroyed() || e === f || e.webContents.send("lyric-window:state", t);
}
function Xt() {
  return a.join(xt, "preload.cjs");
}
function Zt() {
  const t = process.env.APP_ROOT ?? a.join(xt, "..");
  return a.join(t, "dist");
}
function k() {
  return !!(f && !f.isDestroyed());
}
function vt() {
  return k() ? f : null;
}
async function Et() {
  if (k())
    return f == null || f.showInactive(), f;
  const t = P.getPrimaryDisplay().workArea, e = new b({
    width: it,
    height: st,
    x: Math.round(t.x + (t.width - it) / 2),
    y: Math.round(t.y + t.height - st - 56),
    minWidth: 520,
    minHeight: 120,
    frame: !1,
    transparent: !0,
    backgroundColor: "#00000000",
    resizable: !0,
    minimizable: !1,
    maximizable: !1,
    fullscreenable: !1,
    skipTaskbar: !0,
    alwaysOnTop: !0,
    hasShadow: !1,
    show: !1,
    title: "桌面歌词",
    webPreferences: {
      preload: Xt(),
      contextIsolation: !0,
      nodeIntegration: !1,
      sandbox: !1
    }
  });
  e.setAlwaysOnTop(!0, "floating"), e.setVisibleOnAllWorkspaces(!0, { visibleOnFullScreen: !0 }), e.once("ready-to-show", () => e.showInactive()), e.on("closed", () => {
    f = null, ot(!1);
  }), f = e;
  const n = process.env.VITE_DEV_SERVER_URL;
  return n ? await e.loadURL(`${n.replace(/\/+$/, "")}/#/lyric-window`) : await e.loadFile(a.join(Zt(), "index.html"), { hash: "/lyric-window" }), ot(!0), e;
}
function Q() {
  k() && (f == null || f.close()), f = null;
}
function _t() {
  return k() ? (Q(), !1) : (Et(), !0);
}
function Qt(t) {
  k() && (f == null || f.webContents.send("lyric-window:data", t));
}
const V = { width: 380, height: 120 }, at = { width: 960, height: 640 }, G = /* @__PURE__ */ new WeakMap(), J = /* @__PURE__ */ new WeakSet();
function E(t) {
  return !t.isDestroyed() && J.has(t);
}
function te(t, e) {
  const n = P.getDisplayMatching(t).workArea, r = Math.min(Math.max(t.x, n.x + 8), n.x + n.width - e.width - 8), i = Math.min(Math.max(t.y, n.y + 8), n.y + n.height - e.height - 8);
  return { x: Math.round(r), y: Math.round(i), width: e.width, height: e.height };
}
function ee(t, e) {
  if (t.isDestroyed()) return !1;
  const n = E(t);
  if (e === n) return n;
  if (e) {
    const i = t.isMaximized();
    return G.set(t, {
      bounds: i ? t.getNormalBounds() : t.getBounds(),
      maximized: i,
      resizable: t.isResizable(),
      maximizable: t.isMaximizable(),
      fullScreenable: t.isFullScreenable()
    }), i && t.unmaximize(), t.setMinimumSize(V.width, V.height), t.setResizable(!1), t.setMaximizable(!1), t.setFullScreenable(!1), t.setAlwaysOnTop(!0, "floating"), t.setBounds(te(t.getBounds(), V)), J.add(t), !0;
  }
  const r = G.get(t);
  return t.setAlwaysOnTop(!1), t.setFullScreenable((r == null ? void 0 : r.fullScreenable) ?? !0), t.setResizable((r == null ? void 0 : r.resizable) ?? !0), t.setMaximizable((r == null ? void 0 : r.maximizable) ?? !0), t.setMinimumSize(at.width, at.height), J.delete(t), r && (t.setBounds(r.bounds), r.maximized && t.maximize()), G.delete(t), !1;
}
const ne = "system-prefs.json", M = {
  autoStart: !1,
  closeToTray: !0,
  trayHintShown: !1
};
function O() {
  return a.join(l.getPath("userData"), ne);
}
function re(t) {
  const e = t ?? {}, n = (r, i) => typeof r == "boolean" ? r : i;
  return {
    autoStart: n(e.autoStart, M.autoStart),
    closeToTray: n(e.closeToTray, M.closeToTray),
    trayHintShown: n(e.trayHintShown, M.trayHintShown)
  };
}
function ie() {
  return l.isPackaged && (process.platform === "win32" || process.platform === "darwin");
}
const At = "--autostart";
function lt(t) {
  if (!ie()) {
    t && console.warn("[systemPrefs] 开发态不写入系统登录项，autoStart 仅作为偏好保存");
    return;
  }
  try {
    l.setLoginItemSettings({
      openAtLogin: t,
      // args 仅 Windows 生效；macOS 由系统登录项自行拉起，不认这个参数
      ...process.platform === "win32" ? { args: [At] } : {}
    });
  } catch (e) {
    console.warn("[systemPrefs] 写入系统登录项失败", e);
  }
}
class se extends yt {
  constructor() {
    super(...arguments);
    g(this, "current", null);
    g(this, "loading", null);
  }
  /** 读取偏好；首次运行没有文件时返回默认值（不抛错） */
  async load() {
    return this.current ? this.current : this.loading ? this.loading : (this.loading = (async () => {
      let n = { ...M };
      try {
        const r = await y.readFile(O(), "utf8");
        n = re(JSON.parse(r));
      } catch (r) {
        r.code !== "ENOENT" && console.warn("[systemPrefs] 读取失败，使用默认值", r);
      }
      return this.current = n, this.loading = null, lt(n.autoStart), n;
    })(), this.loading);
  }
  /** 同步取当前值（未 load 前返回 null，调用方需自行兜底） */
  snapshot() {
    return this.current ? { ...this.current } : null;
  }
  /** 合并写入并立即生效；返回写入后的完整偏好 */
  async patch(n) {
    const r = await this.load(), i = {
      ...r,
      ...typeof n.autoStart == "boolean" ? { autoStart: n.autoStart } : {},
      ...typeof n.closeToTray == "boolean" ? { closeToTray: n.closeToTray } : {},
      ...typeof n.trayHintShown == "boolean" ? { trayHintShown: n.trayHintShown } : {}
    };
    if (!(i.autoStart !== r.autoStart || i.closeToTray !== r.closeToTray || i.trayHintShown !== r.trayHintShown)) return { ...r };
    this.current = i, i.autoStart !== r.autoStart && lt(i.autoStart);
    try {
      await y.mkdir(a.dirname(O()), { recursive: !0 });
      const d = `${O()}.${process.pid}.tmp`;
      await y.writeFile(d, JSON.stringify(i, null, 2), "utf8"), await y.rename(d, O());
    } catch (d) {
      console.warn("[systemPrefs] 写入失败", d);
    }
    return this.emit("change", { ...i }), { ...i };
  }
  /** 是否关闭到托盘（close 拦截用，未初始化时用默认值） */
  closeToTray() {
    var n;
    return ((n = this.current) == null ? void 0 : n.closeToTray) ?? M.closeToTray;
  }
}
const T = new se(), oe = "酷狗音乐概念版";
let w = null, c = null, Dt = () => null, S = !1;
function ct(t) {
  const e = process.env.VITE_PUBLIC ?? a.join(process.env.APP_ROOT ?? "", "dist");
  return a.join(e, t);
}
function ae() {
  const t = process.platform === "win32" ? ct("tray.ico") : ct("tray.png"), e = Wt.createFromPath(t);
  return e.isEmpty() ? null : process.platform === "darwin" ? e.resize({ width: 18, height: 18 }) : e;
}
function Mt() {
  const t = Dt();
  return t && !t.isDestroyed() ? t : null;
}
function Pt() {
  const t = Mt();
  return !!(t && t.isVisible() && !t.isMinimized());
}
function kt() {
  const t = Mt();
  return !!(t && E(t));
}
function It() {
  return {
    available: S,
    windowVisible: Pt(),
    mini: kt(),
    lyricOpen: !!vt()
  };
}
function Y() {
  return S;
}
function le() {
  const t = It();
  for (const e of b.getAllWindows())
    e.isDestroyed() || e.webContents.send("system:tray-state", t);
}
function ce() {
  const t = T.snapshot(), e = Pt(), n = kt(), r = !!vt(), i = [
    {
      label: e ? "隐藏主窗口" : "显示主窗口",
      click: () => e ? c == null ? void 0 : c.hide() : c == null ? void 0 : c.show()
    },
    {
      label: "迷你播放器",
      type: "checkbox",
      checked: n,
      click: (o) => c == null ? void 0 : c.setMini(o.checked)
    },
    {
      label: "桌面歌词",
      type: "checkbox",
      checked: r,
      click: () => {
        _t(), p();
      }
    },
    { type: "separator" },
    {
      label: "开机自启",
      type: "checkbox",
      checked: !!(t != null && t.autoStart),
      click: (o) => {
        T.patch({ autoStart: o.checked }).then(() => p());
      }
    },
    { label: "设置…", click: () => c == null ? void 0 : c.openSettings() },
    { type: "separator" },
    { label: "退出", click: () => c == null ? void 0 : c.quit() }
  ];
  return pt.buildFromTemplate(i);
}
function p() {
  w && (w.setContextMenu(ce()), w.setToolTip(oe), le());
}
function ue() {
  var t;
  if (w && !((t = T.snapshot()) != null && t.trayHintShown) && (T.patch({ trayHintShown: !0 }), process.platform === "win32"))
    try {
      w.displayBalloon({
        title: "仍在后台运行",
        content: "窗口已最小化到托盘，播放不会中断。右键托盘图标可退出。"
      });
    } catch (e) {
      console.warn("[tray] 气泡提示失败", e);
    }
}
function de(t, e) {
  if (Dt = t, c = e, w)
    return p(), S;
  const n = ae();
  if (!n)
    return console.warn("[tray] 未找到托盘图标，跳过托盘创建"), S = !1, !1;
  try {
    w = new Nt(n);
  } catch (r) {
    return console.warn("[tray] 创建托盘失败", r), S = !1, !1;
  }
  return S = !0, w.on("click", () => c == null ? void 0 : c.show()), w.on("double-click", () => c == null ? void 0 : c.show()), p(), S;
}
function he() {
  w == null || w.destroy(), w = null, S = !1;
}
const fe = 8e3;
function pe() {
  const t = process.env.KUGOU_UPDATE_FEED;
  return typeof t == "string" && /^https?:\/\//i.test(t.trim()) ? t.trim() : null;
}
function ut(t) {
  const n = (t.trim().replace(/^v/i, "").split("-")[0] ?? "").split(".").map((r) => Number.parseInt(r, 10));
  for (; n.length < 3; ) n.push(0);
  return n.map((r) => Number.isFinite(r) ? r : 0);
}
function me(t, e) {
  const n = ut(t), r = ut(e);
  for (let i = 0; i < Math.max(n.length, r.length); i += 1) {
    const o = (n[i] ?? 0) - (r[i] ?? 0);
    if (o !== 0) return o;
  }
  return 0;
}
function R(t) {
  return {
    phase: t,
    currentVersion: l.getVersion(),
    latestVersion: null,
    releaseNotes: null,
    releaseDate: null,
    downloadUrl: null,
    message: null
  };
}
function x(t) {
  return typeof t == "string" && t.trim() ? t.trim() : null;
}
function we(t) {
  const e = {};
  for (const n of t.split(/\r?\n/)) {
    const r = n.trim();
    if (!r || r.startsWith("#")) continue;
    if (/^\s/.test(n)) {
      if (e.url === void 0) {
        const D = /^-?\s*url:\s*(.*)$/.exec(r);
        D && (e.url = D[1].replace(/^['"]|['"]$/g, ""));
      }
      continue;
    }
    const i = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(r);
    if (!i) continue;
    const [, o, d] = i, h = d.replace(/^['"]|['"]$/g, "");
    h && (o === "version" ? e.version = h : o === "releaseDate" ? e.releaseDate = h : o === "path" ? e.path = h : o === "url" && (e.url = h));
  }
  return e;
}
function ye(t) {
  try {
    const e = new URL(t), n = e.pathname.lastIndexOf("/");
    return e.pathname = e.pathname.slice(0, n + 1), e.search = "", e.hash = "", e.toString();
  } catch {
    return null;
  }
}
async function ge(t) {
  const e = new AbortController(), n = setTimeout(() => e.abort(), fe);
  try {
    const r = await $t.fetch(t, {
      method: "GET",
      headers: { accept: "application/json, text/yaml, text/plain, */*" },
      // 清单必须实时，避免被中间层缓存住导致永远看到旧版本
      cache: "no-store",
      signal: e.signal
    });
    if (!r.ok)
      throw new Error(`更新清单返回 HTTP ${r.status}`);
    const o = (await r.text()).replace(/^\uFEFF/, "");
    try {
      return JSON.parse(o);
    } catch {
      return we(o);
    }
  } finally {
    clearTimeout(n);
  }
}
function K(t, e) {
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  const n = ye(e);
  return n ? `${n}${t.replace(/^\.?\//, "")}` : null;
}
async function Te() {
  const t = pe();
  if (!t)
    return {
      ...R("unconfigured"),
      message: "当前版本未配置更新源，无法在线检查。可前往项目主页获取新版本。"
    };
  try {
    const e = await ge(t), n = x(e.version);
    if (!n)
      return { ...R("error"), message: "更新清单缺少 version 字段" };
    const r = Array.isArray(e.files) ? e.files[0] : void 0, i = K(x(e.url), t) ?? K(x(e.path), t) ?? K(x(r == null ? void 0 : r.url), t), o = {
      ...R("idle"),
      latestVersion: n,
      releaseNotes: x(e.notes),
      releaseDate: x(e.pub_date) ?? x(e.releaseDate),
      downloadUrl: i
    };
    return me(n, l.getVersion()) <= 0 ? { ...o, phase: "latest" } : { ...o, phase: "available" };
  } catch (e) {
    const r = e instanceof Error && e.name === "AbortError" ? "检查更新超时，请稍后重试" : `检查更新失败：${e instanceof Error ? e.message : String(e)}`;
    return console.warn("[updater]", r), { ...R("error"), message: r };
  }
}
function _(t) {
  return b.fromWebContents(t.sender);
}
function Se(t) {
  try {
    const e = new URL(t);
    return e.protocol !== "http:" && e.protocol !== "https:" ? !1 : (mt.openExternal(e.toString()), !0);
  } catch {
    return !1;
  }
}
function be() {
  u.handle("app:info", () => {
    const t = A.getStatus();
    return {
      name: l.getName(),
      version: l.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      isPackaged: l.isPackaged,
      apiBase: t.baseUrl,
      upstream: t
    };
  }), u.handle(
    "app:open-external",
    (t, e) => typeof e == "string" ? Se(e) : !1
  ), u.on("window:minimize", (t) => {
    var e;
    (e = _(t)) == null || e.minimize();
  }), u.handle("window:toggle-maximize", (t) => {
    const e = _(t);
    return e ? (e.isMaximized() ? e.unmaximize() : e.maximize(), e.isMaximized()) : !1;
  }), u.on("window:close", (t) => {
    var e;
    (e = _(t)) == null || e.close();
  }), u.handle("window:is-maximized", (t) => {
    var e;
    return ((e = _(t)) == null ? void 0 : e.isMaximized()) ?? !1;
  }), u.handle("window:set-mini", (t, e) => {
    const n = _(t);
    return n ? ee(n, e === !0) : !1;
  }), u.handle("window:is-mini", (t) => {
    const e = _(t);
    return e ? E(e) : !1;
  }), u.handle("credential:get", () => Ct()), u.handle("credential:set", async (t, e) => (await Bt(e), !0)), u.handle("credential:clear", () => Ht()), u.handle("upstream:status", () => A.getStatus()), u.handle("upstream:restart", () => A.restart()), u.handle("lyric-window:open", async () => (await Et(), !0)), u.handle("lyric-window:close", () => (Q(), !0)), u.handle("lyric-window:toggle", () => _t()), u.on("lyric-window:sync", (t, e) => {
    Qt(e);
  }), u.handle("system:preferences", () => T.load()), u.handle(
    "system:set-preferences",
    async (t, e) => {
      const n = e && typeof e == "object" && !Array.isArray(e) ? e : {}, r = await T.patch(n);
      return p(), r;
    }
  ), u.handle("system:tray-state", () => It()), u.handle("system:check-update", () => Te());
}
function xe() {
  A.on("status", (t) => {
    for (const e of b.getAllWindows())
      e.isDestroyed() || e.webContents.send("upstream:status", t);
  });
}
function ve() {
  T.on("change", (t) => {
    for (const e of b.getAllWindows())
      e.isDestroyed() || e.webContents.send("system:preferences", t);
  });
}
const Ot = a.dirname(wt(import.meta.url));
process.env.APP_ROOT = a.join(Ot, "..");
const z = process.env.VITE_DEV_SERVER_URL, $e = a.join(process.env.APP_ROOT, "dist-electron"), Rt = a.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = z ? a.join(process.env.APP_ROOT, "public") : Rt;
const L = process.platform === "darwin";
l.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const Ee = { width: 1280, height: 800 };
let s = null, dt = !1, j = !1, U = null, C = null, N = 0;
const _e = process.argv.includes(At);
function Ae(t) {
  if (!t) return { ...Ee };
  const e = {
    x: typeof t.x == "number" ? t.x : 0,
    y: typeof t.y == "number" ? t.y : 0
  }, n = P.getDisplayNearestPoint(e).workArea, r = Math.max(960, Math.min(Math.round(t.width), n.width)), i = Math.max(640, Math.min(Math.round(t.height), n.height));
  return typeof t.x != "number" || typeof t.y != "number" ? { width: r, height: i } : P.getAllDisplays().some((d) => {
    const h = d.workArea;
    return t.x < h.x + h.width && t.x + r > h.x && t.y < h.y + h.height && t.y + i > h.y;
  }) ? { width: r, height: i, x: Math.round(t.x), y: Math.round(t.y) } : { width: r, height: i };
}
function X(t) {
  if (t.isDestroyed() || Date.now() < N || E(t) || t.isMaximized() || t.isMinimized() || t.isFullScreen())
    return;
  const e = t.getBounds(), n = P.getDisplayMatching(e).workArea;
  e.width >= n.width - 8 && e.height >= n.height - 8 || (C = e);
}
function Ut(t) {
  const e = t.getBounds(), n = t.isMaximized(), r = n ? C ?? t.getNormalBounds() : e;
  return {
    width: r.width,
    height: r.height,
    x: r.x,
    y: r.y,
    maximized: n
  };
}
function ht(t) {
  t.isDestroyed() || E(t) || (U && clearTimeout(U), U = setTimeout(() => {
    U = null, !(t.isDestroyed() || E(t)) && (X(t), bt(Ut(t)));
  }, 400));
}
async function Z() {
  const t = await Vt(), e = Ae(t);
  s = new b({
    ...e,
    minWidth: 960,
    minHeight: 640,
    show: !1,
    backgroundColor: "#0b0e14",
    title: "酷狗音乐 · 概念版",
    icon: a.join(process.env.VITE_PUBLIC ?? "", "app-icon.png"),
    frame: L,
    titleBarStyle: L ? "hiddenInset" : "default",
    trafficLightPosition: L ? { x: 16, y: 14 } : void 0,
    webPreferences: {
      preload: a.join(Ot, "preload.cjs"),
      contextIsolation: !0,
      nodeIntegration: !1,
      // ESM 预加载脚本要求关闭沙箱；特权能力仍被限制在 preload 白名单内
      sandbox: !1,
      webSecurity: !0,
      spellcheck: !1,
      // 迷你模式/最小化时仍需推进进度与桌面歌词，禁用后台节流
      backgroundThrottling: !1
    }
  }), C = {
    width: e.width,
    height: e.height,
    x: e.x ?? 0,
    y: e.y ?? 0
  }, t != null && t.maximized && (N = Date.now() + 1500, s.maximize()), s.once("ready-to-show", () => {
    if (_e && Y()) {
      p();
      return;
    }
    s == null || s.show(), s && !s.isMaximized() && X(s);
  }), s.webContents.on("did-finish-load", () => {
    console.log("[main] 渲染层加载完成");
  }), s.webContents.on("did-fail-load", (r, i, o, d) => {
    console.error(`[main] 渲染层加载失败 code=${i} desc=${o} url=${d}`);
  });
  const n = () => {
    !s || s.isDestroyed() || s.webContents.send("window:maximized-changed", s.isMaximized());
  };
  s.on("maximize", () => {
    N = Date.now() + 1200, n();
  }), s.on("unmaximize", () => {
    N = Date.now() + 1200, n();
  }), s.on("resize", () => s && ht(s)), s.on("move", () => s && ht(s)), s.on("show", () => p()), s.on("hide", () => p()), s.on("minimize", () => p()), s.on("restore", () => p()), s.on("close", (r) => {
    s && !s.isDestroyed() && !E(s) && (X(s), bt(Ut(s))), !(j || !T.closeToTray() || !Y()) && (r.preventDefault(), s == null || s.hide(), ue(), p());
  }), s.on("closed", () => {
    s = null, C = null, Q();
  }), s.webContents.setWindowOpenHandler(({ url: r }) => ((r.startsWith("http://") || r.startsWith("https://")) && mt.openExternal(r), { action: "deny" })), s.webContents.on("will-navigate", (r, i) => {
    const o = z;
    (o ? i.startsWith(o) : i.startsWith("file://")) || r.preventDefault();
  }), z ? (s.webContents.on("console-message", (r, i, o, d, h) => {
    i >= 2 && console.log(`[renderer] ${o} (${h}:${d})`);
  }), await s.loadURL(z)) : await s.loadFile(a.join(Rt, "index.html"));
}
function ft(t) {
  !s || s.isDestroyed() || s.webContents.send("system:tray-command", t);
}
async function W() {
  if (!s || s.isDestroyed()) {
    await Z(), p();
    return;
  }
  s.isMinimized() && s.restore(), s.show(), s.focus(), p();
}
function De() {
  !s || s.isDestroyed() || (s.hide(), p());
}
function Me() {
  j = !0, l.quit();
}
function Pe() {
  if (!de(() => s, {
    show: () => void W(),
    hide: De,
    setMini: (e) => {
      W().then(() => ft(e ? "mini" : "restore"));
    },
    openSettings: () => {
      W().then(() => ft("settings"));
    },
    quit: Me
  })) {
    console.warn("[main] 托盘不可用，关闭到托盘将被跳过（避免窗口藏起来找不回）");
    return;
  }
  console.log("[main] 系统托盘已就绪");
}
l.requestSingleInstanceLock() ? (l.on("second-instance", () => {
  W();
}), l.setAppUserModelId("com.kugo.concept"), l.on("web-contents-created", (t, e) => {
  e.on("will-attach-webview", (n) => n.preventDefault());
}), l.whenReady().then(async () => {
  pt.setApplicationMenu(null), be(), xe(), ve(), await T.load(), Pe(), A.start(), await Z(), l.on("activate", () => {
    b.getAllWindows().length === 0 && Z();
  });
}), l.on("window-all-closed", () => {
  L || !j && T.closeToTray() && Y() || l.quit();
}), l.on("before-quit", (t) => {
  j = !0, !dt && (t.preventDefault(), dt = !0, he(), A.stop().finally(() => {
    l.quit();
  }));
})) : l.quit();
export {
  $e as MAIN_DIST,
  Rt as RENDERER_DIST,
  z as VITE_DEV_SERVER_URL
};
