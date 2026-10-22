"use strict";
const electron = require("electron");
function invoke(channel, ...args) {
  return electron.ipcRenderer.invoke(channel, ...args);
}
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  electron.ipcRenderer.on(channel, listener);
  return () => electron.ipcRenderer.off(channel, listener);
}
const bridge = {
  app: {
    info: () => invoke("app:info"),
    openExternal: (url) => invoke("app:open-external", url)
  },
  window: {
    minimize: () => electron.ipcRenderer.send("window:minimize"),
    toggleMaximize: () => invoke("window:toggle-maximize"),
    close: () => electron.ipcRenderer.send("window:close"),
    isMaximized: () => invoke("window:is-maximized"),
    setMini: (enabled) => invoke("window:set-mini", enabled),
    isMini: () => invoke("window:is-mini"),
    onMaximizeChange: (cb) => subscribe("window:maximized-changed", cb)
  },
  credential: {
    get: () => invoke("credential:get"),
    set: (credential) => invoke("credential:set", credential),
    clear: () => invoke("credential:clear")
  },
  upstream: {
    status: () => invoke("upstream:status"),
    restart: () => invoke("upstream:restart"),
    onStatus: (cb) => subscribe("upstream:status", cb)
  },
  lyric: {
    open: () => invoke("lyric-window:open"),
    close: () => invoke("lyric-window:close"),
    toggle: () => invoke("lyric-window:toggle"),
    sync: (payload) => electron.ipcRenderer.send("lyric-window:sync", payload),
    onData: (cb) => subscribe("lyric-window:data", cb),
    onState: (cb) => subscribe("lyric-window:state", cb)
  }
};
electron.contextBridge.exposeInMainWorld("kugou", bridge);
