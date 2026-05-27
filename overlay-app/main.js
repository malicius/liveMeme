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
let currentShortcut = null;
let saveConfigListenerActive = false;

const DEFAULT_CONFIG = {
  closeShortcut: "Escape",
  mediaSize: "medium",
  volume: 1.0,
  autoLaunch: false,
  addToApps: false,
};

function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath, "utf8")) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}

function saveConfigToFile(data) {
  const merged = { ...DEFAULT_CONFIG, ...data };
  fs.writeFileSync(configPath, JSON.stringify(merged));
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

function makeTrayIcon(active) {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) {
        if (active) { buf[i]=250; buf[i+1]=139; buf[i+2]=167; buf[i+3]=255; }
        else        { buf[i]=140; buf[i+1]=140; buf[i+2]=140; buf[i+3]=255; }
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function updateTrayMenu() {
  const items = [
    { label: isPaused ? "⏸  En pause" : "✅  Actif", enabled: false },
    { type: "separator" },
    {
      label: isPaused ? "Reprendre" : "Mettre en pause",
      click: () => {
        isPaused = !isPaused;
        tray.setImage(makeTrayIcon(!isPaused));
        tray.setToolTip(isPaused ? "MemeOverlay — En pause" : "MemeOverlay — Actif");
        overlayWin?.webContents.send("set-pause", isPaused);
        updateTrayMenu();
      }
    },
    { label: "Paramètres…", click: () => showSetup() },
    { type: "separator" },
  ];

  if (app.isPackaged) {
    items.push({
      label: "Vérifier les mises à jour",
      click: () => {
        try {
          const { autoUpdater } = require("electron-updater");
          autoUpdater.checkForUpdates();
        } catch {}
      }
    });
    items.push({ type: "separator" });
  }

  items.push({ label: "Quitter", click: () => app.quit() });

  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray() {
  tray = new Tray(makeTrayIcon(true));
  tray.setToolTip("MemeOverlay — Actif");
  updateTrayMenu();
}

function createSetupWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 520,
    resizable: false,
    alwaysOnTop: true,
    frame: true,
    skipTaskbar: false,
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

  isPaused = false;
  if (tray) {
    tray.setImage(makeTrayIcon(true));
    tray.setToolTip("MemeOverlay — Actif");
    updateTrayMenu();
  } else {
    createTray();
  }
}

function registerSaveConfigOnce(callback) {
  if (saveConfigListenerActive) ipcMain.removeAllListeners("save-config");
  saveConfigListenerActive = true;
  ipcMain.once("save-config", (event, config) => {
    saveConfigListenerActive = false;
    callback(config);
  });
}

function handleSaveConfig(config) {
  const saved = saveConfigToFile(config);
  applyAutoLaunch(saved.autoLaunch, saved.addToApps);
  registerCloseShortcut(saved.closeShortcut);
  overlayWin?.webContents.send("update-settings", {
    volume: saved.volume,
    mediaSize: saved.mediaSize,
  });
  return saved;
}

function showSetup() {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.close();
    overlayWin = null;
  }
  if (tray) {
    tray.setImage(makeTrayIcon(false));
    tray.setToolTip("MemeOverlay — Déconnecté");
  }

  const setup = createSetupWindow();
  registerSaveConfigOnce((config) => {
    const saved = handleSaveConfig(config);
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

  if (!config.discordUserId || !config.serverUrl) {
    const setup = createSetupWindow();
    registerSaveConfigOnce((newConfig) => {
      const saved = handleSaveConfig(newConfig);
      setup.close();
      createOverlayWindow(saved.serverUrl);
    });
  } else {
    createOverlayWindow(config.serverUrl);
  }

  if (app.isPackaged) {
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.logger = null;
      autoUpdater.checkForUpdatesAndNotify();
    } catch {}
  }
});

ipcMain.handle("get-user-id", () => loadConfig().discordUserId || null);
ipcMain.handle("get-config",  () => loadConfig());

app.on("window-all-closed", () => { /* géré par le tray */ });
app.on("will-quit", () => globalShortcut.unregisterAll());
