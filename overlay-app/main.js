const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, session } = require("electron");
const path = require("path");
const fs = require("fs");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const configPath = path.join(app.getPath("userData"), "config.json");

let overlayWin = null;
let tray = null;
let isPaused = false;

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, "utf8")); }
  catch { return {}; }
}

function saveConfig(data) {
  fs.writeFileSync(configPath, JSON.stringify(data));
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
  const menu = Menu.buildFromTemplate([
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
    {
      label: "Se reconnecter…",
      click: () => showSetup()
    },
    { type: "separator" },
    { label: "Quitter", click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(makeTrayIcon(true));
  tray.setToolTip("MemeOverlay — Actif");
  updateTrayMenu();
}

function createSetupWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 260,
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

function showSetup() {
  // Ferme l'overlay actuel
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.close();
    overlayWin = null;
  }

  if (tray) {
    tray.setImage(makeTrayIcon(false));
    tray.setToolTip("MemeOverlay — Déconnecté");
  }

  const setup = createSetupWindow();

  ipcMain.once("save-config", (event, userId, serverUrl) => {
    saveConfig({ discordUserId: userId, serverUrl });
    setup.close();
    createOverlayWindow(serverUrl);
  });
}

app.whenReady().then(() => {
  // Bypass les restrictions d'embed YouTube (bloqué depuis localhost)
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

  if (!config.discordUserId || !config.serverUrl) {
    const setup = createSetupWindow();
    ipcMain.once("save-config", (event, userId, serverUrl) => {
      saveConfig({ discordUserId: userId, serverUrl });
      setup.close();
      createOverlayWindow(serverUrl);
    });
  } else {
    createOverlayWindow(config.serverUrl);
  }
});

ipcMain.handle("get-user-id", () => loadConfig().discordUserId || null);
ipcMain.handle("get-config",  () => loadConfig());

app.on("window-all-closed", () => { /* géré par le tray */ });
