// main.js — Processus principal Electron
// Fenêtre transparente, always-on-top, click-through quand idle
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

let win;

function createWindow() {
  const { screen } = require("electron");
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,

    // ── Transparent & frameless ──────────────────────────────
    transparent: true,         // fond 100% transparent
    frame: false,              // pas de barre de titre
    backgroundColor: "#00000000",

    // ── Toujours au premier plan ─────────────────────────────
    alwaysOnTop: true,
    type: "screen-saver",      // passe par-dessus tout, même les autres "always on top"

    // ── Pas dans la taskbar ──────────────────────────────────
    skipTaskbar: true,
    focusable: false,          // ne vole pas le focus au reste

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  // Charge la page overlay
  win.loadFile(path.join(__dirname, "overlay.html"));

  // ── Click-through par défaut (mode idle) ─────────────────
  // La souris traverse la fenêtre, l'utilisateur ne la voit pas
  win.setIgnoreMouseEvents(true, { forward: true });

  // ── IPC : activer/désactiver le click-through ─────────────
  // Quand un meme arrive → on réactive les clics (pour le bouton fermer)
  // Quand le meme est fermé → retour click-through
  ipcMain.on("meme-show", () => {
    win.setIgnoreMouseEvents(false); // la fenêtre capte les clics
    win.setAlwaysOnTop(true, "screen-saver");
  });

  ipcMain.on("meme-hide", () => {
    win.setIgnoreMouseEvents(true, { forward: true }); // click-through
  });

  // Dev : ouvrir devtools avec Ctrl+Shift+I
  // win.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
