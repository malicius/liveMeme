// preload.js — Bridge sécurisé entre le processus Electron et la page web
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  // La page peut signaler à Electron qu'un meme est affiché/caché
  memeShow: () => ipcRenderer.send("meme-show"),
  memeHide: () => ipcRenderer.send("meme-hide"),
});
