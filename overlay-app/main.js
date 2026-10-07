const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, session, globalShortcut } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const configPath = path.join(app.getPath("userData"), "config.json");

let overlayWin = null;
let tray = null;
let isPaused = false;
let isConnected = false;
let currentShortcut = null;
let saveConfigListenerActive = false;

const DEFAULT_CONFIG = {
  closeShortcut: "Escape",
  mediaSize: "medium",
  volume: 1.0,
  autoLaunch: false,
  addToApps: false,
  linkToken: "",
  discordUserId: "",
  serverUrl: "",
};

function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath, "utf8")) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}

function saveConfigToFile(data) {
  const merged = { ...loadConfig(), ...data };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
  return merged;
}

function applyAutoLaunch(enable, addToApps) {
  if (process.platform === "linux") {
    const exePath = process.env.APPIMAGE || process.execPath;
    const desktopContent = [
      "[Desktop Entry]",
      "Type=Application",
      "Name=MemeOverlay",
      `Exec=${exePath}`,
      "Hidden=false",
      "NoDisplay=false",
      "X-GNOME-Autostart-enabled=true",
    ].join("\n") + "\n";

    const autostartDir = path.join(os.homedir(), ".config", "autostart");
    const autostartFile = path.join(autostartDir, "memeoverlay.desktop");
    if (enable) {
      fs.mkdirSync(autostartDir, { recursive: true });
      fs.writeFileSync(autostartFile, desktopContent);
    } else {
      try { fs.unlinkSync(autostartFile); } catch {}
    }

    const appsDir = path.join(os.homedir(), ".local", "share", "applications");
    const appsFile = path.join(appsDir, "memeoverlay.desktop");
    if (addToApps) {
      fs.mkdirSync(appsDir, { recursive: true });
      fs.writeFileSync(appsFile, desktopContent);
    } else {
      try { fs.unlinkSync(appsFile); } catch {}
    }
  } else {
    app.setLoginItemSettings({ openAtLogin: enable, path: process.execPath });
  }
}

function registerCloseShortcut(key) {
  if (currentShortcut) {
    try { globalShortcut.unregister(currentShortcut); } catch {}
    currentShortcut = null;
  }
  if (!key) return;
  try {
    const ok = globalShortcut.register(key, () => {
      overlayWin?.webContents.send("close-meme");
    });
    if (ok) currentShortcut = key;
  } catch {}
}

function makeTrayIcon(status) {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;

  // Couleurs : actif (violet), pause (orange), déconnecté (gris)
  let color = [140, 140, 140, 255]; // déconnecté
  if (status === "active") color = [167, 139, 250, 255];
  if (status === "paused") color = [251, 191, 36, 255];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) {
        buf[i] = color[0]; buf[i+1] = color[1]; buf[i+2] = color[2]; buf[i+3] = color[3];
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

let trayHistory = [];

function updateTrayMenu() {
  let statusLabel = "🔴  Déconnecté";
  if (isConnected) statusLabel = isPaused ? "⏸  En pause" : "✅  Actif";

  const items = [
    { label: statusLabel, enabled: false },
    { type: "separator" },
    {
      label: isPaused ? "Reprendre" : "Mettre en pause",
      enabled: isConnected,
      click: () => {
        isPaused = !isPaused;
        overlayWin?.webContents.send("set-pause", isPaused);
        refreshTray();
      }
    },
    { label: "Vider la file d'attente", enabled: isConnected, click: () => overlayWin?.webContents.send("clear-queue") },
    { label: "Paramètres…", click: () => showSetup() },
    { type: "separator" },
  ];

  if (trayHistory.length) {
    items.push({ label: "Historique", enabled: false });
    for (const it of trayHistory.slice(0, 5)) {
      const label = `${it.senderName || "?"} — ${it.text || it.mediaType || "mème"}`.slice(0, 64);
      items.push({
        label,
        click: () => overlayWin?.webContents.send("replay-meme", it.id)
      });
    }
    items.push({ type: "separator" });
  }

  if (app.isPackaged) {
    items.push({
      label: "Vérifier les mises à jour",
      click: () => {
        try {
          const { autoUpdater } = require("electron-updater");
          autoUpdater.checkForUpdatesAndNotify();
        } catch {}
      }
    });
    items.push({ type: "separator" });
  }

  items.push({ label: "Quitter", click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function refreshTray() {
  if (!tray) return;
  const status = !isConnected ? "disconnected" : (isPaused ? "paused" : "active");
  tray.setImage(makeTrayIcon(status));
  tray.setToolTip(`MemeOverlay — ${status === "active" ? "Actif" : (status === "paused" ? "En pause" : "Déconnecté")}`);
  updateTrayMenu();
}

function createTray() {
  tray = new Tray(makeTrayIcon("disconnected"));
  refreshTray();
}

function createSetupWindow() {
  const win = new BrowserWindow({
    width: 440,
    height: 600,
    resizable: true,
    alwaysOnTop: true,
    frame: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js")
    }
  });
  win.loadFile(path.join(__dirname, "setup.html"));
  win.setMenuBarVisibility(false);
  return win;
}

function createOverlayWindow(serverUrl) {
  const { screen } = require("electron");
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();

  overlayWin = new BrowserWindow({
    width, height, x: 0, y: 0,
    transparent: true,
    frame: false,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    type: "screen-saver",
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  overlayWin.webContents.setUserAgent(CHROME_UA);
  overlayWin.loadURL(`${serverUrl}/overlay/overlay.html`);
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.setAlwaysOnTop(true, "screen-saver");

  if (!tray) createTray();
  isConnected = false;
  isPaused = false;
  refreshTray();
}

function showSetup() {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
  isConnected = false;
  refreshTray();

  const setup = createSetupWindow();

  ipcMain.once("save-config", (event, config) => {
    const saved = saveConfigToFile(config);
    applyAutoLaunch(saved.autoLaunch, saved.addToApps);
    registerCloseShortcut(saved.closeShortcut);
    setup.close();
    createOverlayWindow(saved.serverUrl);
  });
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["*://*.youtube.com/*", "*://*.googlevideo.com/*"] },
    (details, callback) => {
      details.requestHeaders["Referer"] = "https://www.youtube.com/";
      details.requestHeaders["Origin"]  = "https://www.youtube.com";
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ["*://*.youtube.com/*"] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      delete headers["x-frame-options"];
      delete headers["X-Frame-Options"];
      callback({ responseHeaders: headers });
    }
  );

  const config = loadConfig();
  applyAutoLaunch(config.autoLaunch, config.addToApps);
  registerCloseShortcut(config.closeShortcut);

  if (!config.linkToken || !config.serverUrl) {
    showSetup();
  } else {
    createOverlayWindow(config.serverUrl);
  }

  if (app.isPackaged) {
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.checkForUpdatesAndNotify();
    } catch {}
  }
});

ipcMain.handle("get-config", () => loadConfig());
ipcMain.on("set-socket-status", (event, { connected, paused }) => {
  isConnected = connected;
  isPaused = paused;
  refreshTray();
});

app.on("window-all-closed", () => {});
app.on("will-quit", () => globalShortcut.unregisterAll());
