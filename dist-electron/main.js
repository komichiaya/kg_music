var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { safeStorage, app, screen, BrowserWindow, ipcMain, shell, Menu } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs$1 from "node:fs";
import net from "node:net";
const CREDENTIAL_FILE = "credential.bin";
const WINDOW_STATE_FILE = "window-state.json";
const userDataFile = (name) => path.join(app.getPath("userData"), name);
async function writeAtomic(filePath, content) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, content, "utf8");
  await fs.rename(tmpPath, filePath);
}
function normalizeCredential(input) {
  if (!input || typeof input !== "object") return null;
  const raw = input;
  if (typeof raw.token !== "string" || raw.token.length === 0) return null;
  if (raw.userid === void 0 || raw.userid === null) return null;
  return {
    token: raw.token,
    userid: String(raw.userid),
    vip_type: Number(raw.vip_type ?? 0) || 0,
    vip_token: typeof raw.vip_token === "string" ? raw.vip_token : "",
    t1: typeof raw.t1 === "string" ? raw.t1 : void 0,
    dfid: typeof raw.dfid === "string" ? raw.dfid : void 0
  };
}
async function readCredential() {
  try {
    const raw = await fs.readFile(userDataFile(CREDENTIAL_FILE), "utf8");
    const envelope = JSON.parse(raw);
    if (!envelope || typeof envelope.data !== "string") return null;
    const buffer = Buffer.from(envelope.data, "base64");
    let plain;
    if (envelope.enc === "safe") {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn("[store] 系统加密不可用，无法解密既有凭据，按未登录处理");
        return null;
      }
      plain = safeStorage.decryptString(buffer);
    } else {
      plain = buffer.toString("utf8");
    }
    return normalizeCredential(JSON.parse(plain));
  } catch (error) {
    const code = error == null ? void 0 : error.code;
    if (code !== "ENOENT") {
      console.warn("[store] 读取凭据失败，按未登录处理：", error);
    }
    return null;
  }
}
async function writeCredential(credential) {
  const normalized = normalizeCredential(credential);
  if (!normalized) throw new Error("凭据结构不合法：缺少 token 或 userid");
  const plain = JSON.stringify(normalized);
  const encrypted = safeStorage.isEncryptionAvailable();
  const envelope = {
    v: 1,
    enc: encrypted ? "safe" : "plain",
    data: encrypted ? safeStorage.encryptString(plain).toString("base64") : Buffer.from(plain, "utf8").toString("base64")
  };
  await fs.mkdir(path.dirname(userDataFile(CREDENTIAL_FILE)), { recursive: true });
  await writeAtomic(userDataFile(CREDENTIAL_FILE), JSON.stringify(envelope));
  if (!encrypted) {
    console.warn("[store] safeStorage 不可用，凭据以未加密形式落盘（仅建议在开发环境出现）");
  }
  return encrypted;
}
async function clearCredential() {
  try {
    await fs.unlink(userDataFile(CREDENTIAL_FILE));
  } catch (error) {
    if ((error == null ? void 0 : error.code) !== "ENOENT") {
      console.warn("[store] 清除凭据失败：", error);
    }
  }
}
async function readWindowState() {
  try {
    const raw = await fs.readFile(userDataFile(WINDOW_STATE_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) return null;
    return parsed;
  } catch {
    return null;
  }
}
async function writeWindowState(state) {
  try {
    await fs.mkdir(path.dirname(userDataFile(WINDOW_STATE_FILE)), { recursive: true });
    await writeAtomic(userDataFile(WINDOW_STATE_FILE), JSON.stringify(state));
  } catch (error) {
    console.warn("[store] 保存窗口状态失败：", error);
  }
}
const PROXY_KEYS = [
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "npm_config_proxy",
  "npm_config_https_proxy"
];
const DEFAULT_PORT = 3e3;
const HEALTH_TIMEOUT_MS = 45e3;
const HEALTH_INTERVAL_MS = 400;
const MAX_RESTARTS = 3;
const EXTERNAL_WATCH_MS = 5e3;
function probePort(port, host = "127.0.0.1", timeout = 600) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}
function resolvePort() {
  const raw = Number(process.env.KUGOU_API_PORT ?? DEFAULT_PORT);
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : DEFAULT_PORT;
}
function resolveApiDir() {
  const candidates = [];
  if (process.env.KUGOU_API_DIR) candidates.push(process.env.KUGOU_API_DIR);
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, "KuGouMusicApi"));
    candidates.push(path.join(path.dirname(app.getPath("exe")), "KuGouMusicApi"));
  }
  candidates.push(path.resolve(app.getAppPath(), "..", "KuGouMusicApi"));
  candidates.push(path.resolve(process.cwd(), "..", "KuGouMusicApi"));
  candidates.push(path.resolve(process.cwd(), "KuGouMusicApi"));
  for (const dir of candidates) {
    try {
      if (fs$1.existsSync(path.join(dir, "app.js"))) return dir;
    } catch {
    }
  }
  return null;
}
class UpstreamService extends EventEmitter {
  constructor() {
    super();
    __publicField(this, "child", null);
    __publicField(this, "stopping", false);
    __publicField(this, "restartTimer", null);
    __publicField(this, "watchTimer", null);
    __publicField(this, "port", resolvePort());
    __publicField(this, "apiDir", resolveApiDir());
    __publicField(this, "status", {
      state: "idle",
      port: resolvePort(),
      baseUrl: `http://127.0.0.1:${resolvePort()}`,
      pid: null,
      attempts: 0,
      lastError: null,
      logTail: [],
      apiDir: null
    });
    this.status.apiDir = this.apiDir;
    if (!this.apiDir) {
      console.warn("[upstream] 未找到 KuGouMusicApi 工程目录，将以「仅复用外部服务」模式运行");
    }
  }
  getStatus() {
    return { ...this.status, logTail: [...this.status.logTail] };
  }
  /** 启动上游：优先复用已监听端口，其次拉起子进程 */
  async start() {
    if (this.stopping) return this.getStatus();
    if (this.child) return this.getStatus();
    this.patch({ state: "starting", lastError: null });
    if (await probePort(this.port)) {
      console.info(`[upstream] 端口 ${this.port} 已有服务监听，复用外部实例`);
      this.patch({ state: "external", pid: null });
      this.startExternalWatch();
      return this.getStatus();
    }
    const managedDisabled = process.env.KUGOU_API_MANAGED === "false";
    if (managedDisabled) {
      this.patch({ state: "failed", lastError: "已配置 KUGOU_API_MANAGED=false，且未发现外部上游服务" });
      return this.getStatus();
    }
    if (!this.apiDir) {
      this.patch({
        state: "failed",
        lastError: "未找到 KuGouMusicApi 工程目录，可通过环境变量 KUGOU_API_DIR 指定"
      });
      return this.getStatus();
    }
    this.spawnChild();
    await this.waitHealthy();
    return this.getStatus();
  }
  /** 手动重启：先停止再启动，供设置页「重启服务」调用 */
  async restart() {
    await this.stop({ transient: true });
    this.stopping = false;
    this.patch({ attempts: 0 });
    return this.start();
  }
  /** 停止上游；transient=true 表示这是重启流程的一部分，不改变最终状态语义 */
  async stop(options = {}) {
    this.clearRestartTimer();
    this.stopExternalWatch();
    if (!options.transient) this.stopping = true;
    const child = this.child;
    if (!child) {
      if (!options.transient) this.patch({ state: "stopped", pid: null });
      return;
    }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
        }
        resolve();
      }, 3e3);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        child.kill();
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
    this.child = null;
    if (!options.transient) this.patch({ state: "stopped", pid: null });
  }
  spawnChild() {
    var _a, _b, _c, _d;
    if (!this.apiDir) return;
    const env = {
      ...process.env,
      // 用 Electron 二进制以 Node 模式运行上游，打包后无需额外安装 Node
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(this.port),
      // 概念版：上游 platform=lite 对应酷狗概念版的接口行为
      platform: "lite"
    };
    for (const key of PROXY_KEYS) delete env[key];
    if (app.isPackaged) {
      const dataDir = path.join(app.getPath("userData"), "upstream");
      try {
        fs$1.mkdirSync(dataDir, { recursive: true });
        env.KUGOU_API_DEVICE_FILE = path.join(dataDir, "device.json");
      } catch (error) {
        console.warn("[upstream] 创建设备身份目录失败，将退化为写入安装目录", error);
      }
    }
    const args = [path.join(this.apiDir, "app.js"), `--port=${this.port}`, "--swagger=false", "--platform=lite"];
    console.info(`[upstream] 启动子进程：${path.join(this.apiDir, "app.js")} (port=${this.port})`);
    const child = spawn(process.execPath, args, {
      cwd: this.apiDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    this.child = child;
    this.patch({ pid: child.pid ?? null });
    (_a = child.stdout) == null ? void 0 : _a.setEncoding("utf8");
    (_b = child.stderr) == null ? void 0 : _b.setEncoding("utf8");
    (_c = child.stdout) == null ? void 0 : _c.on("data", (chunk) => this.appendLog(chunk));
    (_d = child.stderr) == null ? void 0 : _d.on("data", (chunk) => this.appendLog(chunk));
    child.once("error", (error) => {
      console.error("[upstream] 子进程启动失败：", error);
      this.patch({ lastError: `子进程启动失败：${error.message}` });
    });
    child.once("exit", (code, signal) => {
      this.child = null;
      const reason = `上游进程退出（code=${code ?? "null"}, signal=${signal ?? "null"}）`;
      console.warn(`[upstream] ${reason}`);
      if (this.stopping) {
        this.patch({ state: "stopped", pid: null });
        return;
      }
      this.handleUnexpectedExit(reason);
    });
  }
  /** 等待端口就绪；期间子进程退出则立即判定失败，不做满时长空等 */
  async waitHealthy() {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await probePort(this.port)) {
        this.patch({ state: "running", lastError: null });
        console.info(`[upstream] 服务就绪：${this.status.baseUrl}`);
        return;
      }
      if (!this.child) return;
      await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS));
    }
    this.patch({ state: "failed", lastError: `上游在 ${HEALTH_TIMEOUT_MS / 1e3}s 内未就绪` });
    if (this.child) void this.stop();
  }
  handleUnexpectedExit(reason) {
    void (async () => {
      if (await probePort(this.port)) {
        this.patch({ state: "external", pid: null, lastError: null });
        this.startExternalWatch();
        return;
      }
      if (this.status.attempts >= MAX_RESTARTS) {
        this.patch({ state: "failed", pid: null, lastError: `${reason}；已自动重启 ${MAX_RESTARTS} 次仍失败` });
        return;
      }
      const attempts = this.status.attempts + 1;
      const delay = 1e3 * attempts;
      this.patch({ state: "starting", pid: null, attempts, lastError: reason });
      console.info(`[upstream] ${delay}ms 后第 ${attempts} 次自动重启`);
      this.clearRestartTimer();
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        if (this.stopping || this.child) return;
        this.spawnChild();
        void this.waitHealthy();
      }, delay);
    })();
  }
  /** 外部实例无 exit 事件可监听，改为轮询端口，断开后状态及时回落 */
  startExternalWatch() {
    this.stopExternalWatch();
    this.watchTimer = setInterval(() => {
      void (async () => {
        if (this.child) return;
        const alive = await probePort(this.port);
        if (!alive && this.status.state === "external") {
          this.patch({ state: "failed", lastError: "外部上游服务已断开" });
          this.stopExternalWatch();
        }
      })();
    }, EXTERNAL_WATCH_MS);
  }
  stopExternalWatch() {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }
  clearRestartTimer() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }
  appendLog(chunk) {
    const lines = chunk.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) return;
    for (const line of lines) console.log(`[upstream] ${line}`);
    const next = [...this.status.logTail, ...lines].slice(-40);
    this.patch({ logTail: next });
  }
  patch(partial) {
    const stateChanged = partial.state !== void 0 && partial.state !== this.status.state;
    this.status = { ...this.status, ...partial };
    if (partial.state !== void 0 || stateChanged) {
      this.emit("status", this.getStatus());
    }
  }
}
const upstream = new UpstreamService();
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const WIDTH = 860;
const HEIGHT = 176;
let lyricWin = null;
function broadcastState(open) {
  for (const win2 of BrowserWindow.getAllWindows()) {
    if (win2.isDestroyed() || win2 === lyricWin) continue;
    win2.webContents.send("lyric-window:state", open);
  }
}
function preloadPath() {
  return path.join(moduleDir, "preload.cjs");
}
function rendererDist() {
  const root = process.env.APP_ROOT ?? path.join(moduleDir, "..");
  return path.join(root, "dist");
}
function isAlive() {
  return Boolean(lyricWin && !lyricWin.isDestroyed());
}
async function openLyricWindow() {
  if (isAlive()) {
    lyricWin == null ? void 0 : lyricWin.showInactive();
    return lyricWin;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const win2 = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: Math.round(area.x + (area.width - WIDTH) / 2),
    y: Math.round(area.y + area.height - HEIGHT - 56),
    minWidth: 520,
    minHeight: 120,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    title: "桌面歌词",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win2.setAlwaysOnTop(true, "floating");
  win2.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win2.once("ready-to-show", () => win2.showInactive());
  win2.on("closed", () => {
    lyricWin = null;
    broadcastState(false);
  });
  lyricWin = win2;
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await win2.loadURL(`${devUrl.replace(/\/+$/, "")}/#/lyric-window`);
  } else {
    await win2.loadFile(path.join(rendererDist(), "index.html"), { hash: "/lyric-window" });
  }
  broadcastState(true);
  return win2;
}
function closeLyricWindow() {
  if (isAlive()) lyricWin == null ? void 0 : lyricWin.close();
  lyricWin = null;
}
function toggleLyricWindow() {
  if (isAlive()) {
    closeLyricWindow();
    return false;
  }
  void openLyricWindow();
  return true;
}
function pushLyricData(payload) {
  if (!isAlive()) return;
  lyricWin == null ? void 0 : lyricWin.webContents.send("lyric-window:data", payload);
}
const MINI_SIZE = { width: 380, height: 120 };
const NORMAL_MIN_SIZE = { width: 960, height: 640 };
const savedStates = /* @__PURE__ */ new WeakMap();
const miniWindows = /* @__PURE__ */ new WeakSet();
function isMiniWindow(win2) {
  return !win2.isDestroyed() && miniWindows.has(win2);
}
function clampToWorkArea(bounds, size) {
  const area = screen.getDisplayMatching(bounds).workArea;
  const x = Math.min(Math.max(bounds.x, area.x + 8), area.x + area.width - size.width - 8);
  const y = Math.min(Math.max(bounds.y, area.y + 8), area.y + area.height - size.height - 8);
  return { x: Math.round(x), y: Math.round(y), width: size.width, height: size.height };
}
function setMiniWindow(win2, enabled) {
  if (win2.isDestroyed()) return false;
  const current = isMiniWindow(win2);
  if (enabled === current) return current;
  if (enabled) {
    const maximized = win2.isMaximized();
    savedStates.set(win2, {
      bounds: maximized ? win2.getNormalBounds() : win2.getBounds(),
      maximized,
      resizable: win2.isResizable(),
      maximizable: win2.isMaximizable(),
      fullScreenable: win2.isFullScreenable()
    });
    if (maximized) win2.unmaximize();
    win2.setMinimumSize(MINI_SIZE.width, MINI_SIZE.height);
    win2.setResizable(false);
    win2.setMaximizable(false);
    win2.setFullScreenable(false);
    win2.setAlwaysOnTop(true, "floating");
    win2.setBounds(clampToWorkArea(win2.getBounds(), MINI_SIZE));
    miniWindows.add(win2);
    return true;
  }
  const saved = savedStates.get(win2);
  win2.setAlwaysOnTop(false);
  win2.setFullScreenable((saved == null ? void 0 : saved.fullScreenable) ?? true);
  win2.setResizable((saved == null ? void 0 : saved.resizable) ?? true);
  win2.setMaximizable((saved == null ? void 0 : saved.maximizable) ?? true);
  win2.setMinimumSize(NORMAL_MIN_SIZE.width, NORMAL_MIN_SIZE.height);
  miniWindows.delete(win2);
  if (saved) {
    win2.setBounds(saved.bounds);
    if (saved.maximized) win2.maximize();
  }
  savedStates.delete(win2);
  return false;
}
function windowOf(source) {
  return BrowserWindow.fromWebContents(source.sender);
}
function openExternal(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    void shell.openExternal(url.toString());
    return true;
  } catch {
    return false;
  }
}
function registerIpcHandlers() {
  ipcMain.handle("app:info", () => {
    const status = upstream.getStatus();
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      isPackaged: app.isPackaged,
      apiBase: status.baseUrl,
      upstream: status
    };
  });
  ipcMain.handle(
    "app:open-external",
    (_event, url) => typeof url === "string" ? openExternal(url) : false
  );
  ipcMain.on("window:minimize", (event) => {
    var _a;
    (_a = windowOf(event)) == null ? void 0 : _a.minimize();
  });
  ipcMain.handle("window:toggle-maximize", (event) => {
    const win2 = windowOf(event);
    if (!win2) return false;
    if (win2.isMaximized()) win2.unmaximize();
    else win2.maximize();
    return win2.isMaximized();
  });
  ipcMain.on("window:close", (event) => {
    var _a;
    (_a = windowOf(event)) == null ? void 0 : _a.close();
  });
  ipcMain.handle("window:is-maximized", (event) => {
    var _a;
    return ((_a = windowOf(event)) == null ? void 0 : _a.isMaximized()) ?? false;
  });
  ipcMain.handle("window:set-mini", (event, enabled) => {
    const win2 = windowOf(event);
    if (!win2) return false;
    return setMiniWindow(win2, enabled === true);
  });
  ipcMain.handle("window:is-mini", (event) => {
    const win2 = windowOf(event);
    return win2 ? isMiniWindow(win2) : false;
  });
  ipcMain.handle("credential:get", () => readCredential());
  ipcMain.handle("credential:set", async (_event, credential) => {
    await writeCredential(credential);
    return true;
  });
  ipcMain.handle("credential:clear", () => clearCredential());
  ipcMain.handle("upstream:status", () => upstream.getStatus());
  ipcMain.handle("upstream:restart", () => upstream.restart());
  ipcMain.handle("lyric-window:open", async () => {
    await openLyricWindow();
    return true;
  });
  ipcMain.handle("lyric-window:close", () => {
    closeLyricWindow();
    return true;
  });
  ipcMain.handle("lyric-window:toggle", () => toggleLyricWindow());
  ipcMain.on("lyric-window:sync", (_event, payload) => {
    pushLyricData(payload);
  });
}
function bindUpstreamBroadcast() {
  upstream.on("status", (status) => {
    for (const win2 of BrowserWindow.getAllWindows()) {
      if (!win2.isDestroyed()) win2.webContents.send("upstream:status", status);
    }
  });
}
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
const isMac = process.platform === "darwin";
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const DEFAULT_BOUNDS = { width: 1280, height: 800 };
let win = null;
let quitReady = false;
let saveTimer = null;
let lastNormalBounds = null;
let boundsSuppressUntil = 0;
function sanitizeBounds(state) {
  if (!state) return { ...DEFAULT_BOUNDS };
  const anchor = {
    x: typeof state.x === "number" ? state.x : 0,
    y: typeof state.y === "number" ? state.y : 0
  };
  const area = screen.getDisplayNearestPoint(anchor).workArea;
  const width = Math.max(960, Math.min(Math.round(state.width), area.width));
  const height = Math.max(640, Math.min(Math.round(state.height), area.height));
  if (typeof state.x !== "number" || typeof state.y !== "number") return { width, height };
  const visible = screen.getAllDisplays().some((display) => {
    const workArea = display.workArea;
    return state.x < workArea.x + workArea.width && state.x + width > workArea.x && state.y < workArea.y + workArea.height && state.y + height > workArea.y;
  });
  return visible ? { width, height, x: Math.round(state.x), y: Math.round(state.y) } : { width, height };
}
function rememberNormalBounds(target) {
  if (target.isDestroyed()) return;
  if (Date.now() < boundsSuppressUntil) return;
  if (isMiniWindow(target) || target.isMaximized() || target.isMinimized() || target.isFullScreen()) {
    return;
  }
  const bounds = target.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  if (bounds.width >= area.width - 8 && bounds.height >= area.height - 8) return;
  lastNormalBounds = bounds;
}
function collectWindowState(target) {
  const current = target.getBounds();
  const maximized = target.isMaximized();
  const bounds = maximized ? lastNormalBounds ?? target.getNormalBounds() : current;
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized
  };
}
function scheduleSaveWindowState(target) {
  if (target.isDestroyed()) return;
  if (isMiniWindow(target)) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (target.isDestroyed() || isMiniWindow(target)) return;
    rememberNormalBounds(target);
    void writeWindowState(collectWindowState(target));
  }, 400);
}
async function createWindow() {
  const state = await readWindowState();
  const initial = sanitizeBounds(state);
  win = new BrowserWindow({
    ...initial,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#0b0e14",
    title: "酷狗音乐 · 概念版",
    icon: path.join(process.env.VITE_PUBLIC ?? "", "electron-vite.svg"),
    frame: isMac,
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 16, y: 14 } : void 0,
    webPreferences: {
      preload: path.join(__dirname$1, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM 预加载脚本要求关闭沙箱；特权能力仍被限制在 preload 白名单内
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
      // 迷你模式/最小化时仍需推进进度与桌面歌词，禁用后台节流
      backgroundThrottling: false
    }
  });
  lastNormalBounds = {
    width: initial.width,
    height: initial.height,
    x: initial.x ?? 0,
    y: initial.y ?? 0
  };
  if (state == null ? void 0 : state.maximized) {
    boundsSuppressUntil = Date.now() + 1500;
    win.maximize();
  }
  win.once("ready-to-show", () => {
    win == null ? void 0 : win.show();
    if (win && !win.isMaximized()) rememberNormalBounds(win);
  });
  win.webContents.on("did-finish-load", () => {
    console.log("[main] 渲染层加载完成");
  });
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[main] 渲染层加载失败 code=${code} desc=${description} url=${url}`);
  });
  const notifyMaximize = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send("window:maximized-changed", win.isMaximized());
  };
  win.on("maximize", () => {
    boundsSuppressUntil = Date.now() + 1200;
    notifyMaximize();
  });
  win.on("unmaximize", () => {
    boundsSuppressUntil = Date.now() + 1200;
    notifyMaximize();
  });
  win.on("resize", () => win && scheduleSaveWindowState(win));
  win.on("move", () => win && scheduleSaveWindowState(win));
  win.on("close", () => {
    if (win && !win.isDestroyed() && !isMiniWindow(win)) {
      rememberNormalBounds(win);
      void writeWindowState(collectWindowState(win));
    }
  });
  win.on("closed", () => {
    win = null;
    lastNormalBounds = null;
    closeLyricWindow();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const devUrl = VITE_DEV_SERVER_URL;
    const allowed = devUrl ? url.startsWith(devUrl) : url.startsWith("file://");
    if (!allowed) event.preventDefault();
  });
  if (VITE_DEV_SERVER_URL) {
    win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      if (level >= 2) console.log(`[renderer] ${message} (${sourceId}:${line})`);
    });
    await win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    await win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.setAppUserModelId("com.kugo.concept");
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    registerIpcHandlers();
    bindUpstreamBroadcast();
    void upstream.start();
    await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (!isMac) app.quit();
  });
  app.on("before-quit", (event) => {
    if (quitReady) return;
    event.preventDefault();
    quitReady = true;
    void upstream.stop().finally(() => {
      app.quit();
    });
  });
}
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
