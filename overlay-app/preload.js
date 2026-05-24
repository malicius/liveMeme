const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  saveConfig: (userId, serverUrl) => ipcRenderer.send("save-config", userId, serverUrl),
  getUserId:  () => ipcRenderer.invoke("get-user-id"),
  getConfig:  () => ipcRenderer.invoke("get-config"),
  onPause:    (cb) => ipcRenderer.on("set-pause", (_, val) => cb(val)),
});
