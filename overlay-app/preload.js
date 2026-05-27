const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  saveConfig:       (config) => ipcRenderer.send("save-config", config),
  getUserId:        () => ipcRenderer.invoke("get-user-id"),
  getConfig:        () => ipcRenderer.invoke("get-config"),
  onPause:          (cb) => ipcRenderer.on("set-pause",       (_, val)      => cb(val)),
  onCloseMeme:      (cb) => ipcRenderer.on("close-meme",      ()            => cb()),
  onUpdateSettings: (cb) => ipcRenderer.on("update-settings", (_, settings) => cb(settings)),
});
