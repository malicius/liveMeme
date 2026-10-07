const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  saveConfig:       (config) => ipcRenderer.send("save-config", config),
  getConfig:        () => ipcRenderer.invoke("get-config"),
  setSocketStatus:  (connected, paused) => ipcRenderer.send("set-socket-status", { connected, paused }),
  sendHistory:      (items) => ipcRenderer.send("set-history", items),
  onPause:          (cb) => ipcRenderer.on("set-pause",       (_, val)      => cb(val)),
  onCloseMeme:      (cb) => ipcRenderer.on("close-meme",      ()            => cb()),
  onClearQueue:     (cb) => ipcRenderer.on("clear-queue",     ()            => cb()),
  onReplay:         (cb) => ipcRenderer.on("replay-meme",     (_, itemId)   => cb(itemId)),
  onUpdateSettings: (cb) => ipcRenderer.on("update-settings", (_, settings) => cb(settings)),
});
