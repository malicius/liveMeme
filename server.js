const express = require("express");
const http = require("http");
const https = require("https");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const { Server } = require("socket.io");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const youtubedl = require("youtube-dl-exec");
require("dotenv").config();

const API_KEY = process.env.API_KEY;
const LINK_SECRET = process.env.LINK_SECRET;
if (!API_KEY || !LINK_SECRET) {
  console.error("API_KEY et LINK_SECRET sont requis dans .env");
  process.exit(1);
}

const PORT = process.env.PORT || 38283;
const SERVER_ORIGIN = (process.env.SERVER_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

// setup.html est chargé en file:// → Origin "null" ou absent. On l'autorise :
// toutes les routes sensibles exigent de toute façon une clé API ou un jeton signé.
function corsOrigin(origin, callback) {
  if (!origin || origin === "null" || origin === SERVER_ORIGIN) return callback(null, true);
  callback(null, false);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin } });

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "32kb" }));

// Seule la page d'overlay est publique — main.js/preload.js ne doivent pas l'être.
const OVERLAY_DIR = path.join(__dirname, "overlay-app");
app.get("/overlay/overlay.html", (req, res) => res.sendFile(path.join(OVERLAY_DIR, "overlay.html")));
app.get("/overlay/setup.html", (req, res) => res.sendFile(path.join(OVERLAY_DIR, "setup.html")));

const listsPath = path.join(__dirname, "lists.json");
const historyPath = path.join(__dirname, "history.json");

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

const lists = loadJson(listsPath, {});
const historyStore = loadJson(historyPath, {});

function saveLists() {
  fs.writeFileSync(listsPath, JSON.stringify(lists, null, 2));
}
function saveHistory() {
  fs.writeFileSync(historyPath, JSON.stringify(historyStore));
}

function userLists(userId) {
  if (!lists[userId]) lists[userId] = { mode: "blacklist", ids: [] };
  return lists[userId];
}

function senderAllowed(targetUserId, senderId) {
  if (!senderId) return true;
  const list = lists[targetUserId];
  if (!list || !list.ids?.length) return true;
  const has = list.ids.includes(senderId);
  return list.mode === "whitelist" ? has : !has;
}

const HISTORY_PER_USER = 30;
const HISTORY_MAX_USERS = 200;

function pushHistory(userId, entry) {
  const arr = historyStore[userId] || [];
  arr.unshift(entry);
  historyStore[userId] = arr.slice(0, HISTORY_PER_USER);

  // Borne le nombre d'utilisateurs suivis pour que history.json ne grossisse pas sans fin.
  const ids = Object.keys(historyStore);
  if (ids.length > HISTORY_MAX_USERS) {
    const stale = ids
      .filter(id => id !== userId)
      .sort((a, b) => (historyStore[a][0]?.ts || 0) - (historyStore[b][0]?.ts || 0));
    for (const id of stale.slice(0, ids.length - HISTORY_MAX_USERS)) delete historyStore[id];
  }
  saveHistory();
}

const VALID_POSITIONS = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

function clamp(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function isPublicHttpUrl(raw) {
  let u;
  try { u = new URL(raw); }
  catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  return true;
}

function signToken(userId) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 30;
  const payload = Buffer.from(JSON.stringify({ userId, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", LINK_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", LINK_SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.userId || data.exp < Date.now()) return null;
    return data.userId;
  } catch { return null; }
}

function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"];
  const a = Buffer.from(String(key || ""));
  const b = Buffer.from(API_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: "Accès refusé" });
  }
  next();
}

const sendLimiter = rateLimit({
  windowMs: 10 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requêtes" },
});

// userId -> { socket, paused, wall }
const connectedUsers = new Map();

io.use((socket, next) => {
  const userId = verifyToken(socket.handshake.auth?.token);
  if (!userId) return next(new Error("unauthorized"));
  socket.userId = userId;
  next();
});

io.on("connection", (socket) => {
  const prev = connectedUsers.get(socket.userId);
  if (prev && prev.socket !== socket) prev.socket.disconnect(true);
  connectedUsers.set(socket.userId, { socket, paused: false, wall: false });
  console.log(`[+] Connecté : ${socket.userId}`);

  socket.on("status", (state) => {
    const entry = connectedUsers.get(socket.userId);
    if (!entry || entry.socket !== socket) return;
    if (typeof state?.paused === "boolean") entry.paused = state.paused;
    if (typeof state?.wall === "boolean") entry.wall = state.wall;
  });

  socket.on("disconnect", () => {
    const entry = connectedUsers.get(socket.userId);
    if (entry && entry.socket === socket) {
      connectedUsers.delete(socket.userId);
      console.log(`[-] Déconnecté : ${socket.userId}`);
    }
  });
});

const ytGrants = new Map();

function grantYt(videoId) {
  ytGrants.set(videoId, Date.now() + 10 * 60 * 1000);
}

function ytGranted(videoId) {
  const exp = ytGrants.get(videoId);
  if (!exp || exp < Date.now()) {
    ytGrants.delete(videoId);
    return false;
  }
  return true;
}

function extractYtId(url) {
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function proxyMedia(directUrl, res, req, fallbackType) {
  const proxyReq = https.get(directUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer": "https://www.youtube.com/",
    },
  }, (proxyRes) => {
    res.setHeader("Content-Type", proxyRes.headers["content-type"] || fallbackType);
    if (proxyRes.headers["content-length"]) res.setHeader("Content-Length", proxyRes.headers["content-length"]);
    res.setHeader("Accept-Ranges", "none");
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (err) => {
    console.error("[yt proxy]", err.message);
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  req.on("close", () => proxyReq.destroy());
}

async function ytDirect(videoId, format) {
  const info = await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
    dumpSingleJson: true,
    noWarnings: true,
    preferFreeFormats: true,
    format,
  });
  return info.url
    || info.formats?.find(f => f.ext === "mp4" && f.acodec !== "none" && f.vcodec !== "none")?.url
    || info.formats?.find(f => f.acodec !== "none" && f.vcodec === "none")?.url
    || info.formats?.[info.formats.length - 1]?.url;
}

app.get("/yt/:videoId", async (req, res) => {
  const { videoId } = req.params;
  if (!YT_ID.test(videoId) || !ytGranted(videoId)) return res.status(404).end();
  try {
    const directUrl = await ytDirect(videoId, "best[ext=mp4]/best");
    if (!directUrl) return res.status(500).end();
    proxyMedia(directUrl, res, req, "video/mp4");
  } catch (err) {
    console.error("[yt]", err.message);
    if (!res.headersSent) res.status(500).end();
  }
});

app.get("/yt-audio/:videoId", async (req, res) => {
  const { videoId } = req.params;
  if (!YT_ID.test(videoId) || !ytGranted(videoId)) return res.status(404).end();
  try {
    const directUrl = await ytDirect(videoId, "bestaudio[ext=m4a]/bestaudio");
    if (!directUrl) return res.status(500).end();
    proxyMedia(directUrl, res, req, "audio/mp4");
  } catch (err) {
    console.error("[yt-audio]", err.message);
    if (!res.headersSent) res.status(500).end();
  }
});

app.post("/api/send-meme", requireApiKey, sendLimiter, (req, res) => {
  const body = req.body || {};
  const { targetUserId, mediaType, senderName, senderId } = body;
  let { mediaUrl, text } = body;

  if (!targetUserId || typeof targetUserId !== "string") {
    return res.status(400).json({ error: "targetUserId requis" });
  }

  const duration = clamp(body.duration, 1, 30, 2);
  const position = VALID_POSITIONS.includes(body.position) ? body.position : "c";
  const sound = Boolean(body.sound);
  const start = clamp(body.start, 0, 60 * 60 * 12, 0);
  const count = clamp(body.count, 5, 200, 40);
  text = typeof text === "string" ? text.slice(0, 200) : "";
  const safeSender = typeof senderName === "string" ? senderName.slice(0, 64) : "";

  if (mediaType === "emote-wall") {
    if (mediaUrl && !isPublicHttpUrl(mediaUrl)) return res.status(400).json({ error: "URL refusée" });
    if (!mediaUrl && !text) return res.status(400).json({ error: "emoji ou média requis" });
  } else if (mediaType === "youtube") {
    const id = mediaUrl && extractYtId(mediaUrl);
    if (!id) return res.status(400).json({ error: "URL YouTube invalide" });
  } else {
    if (!mediaUrl || !isPublicHttpUrl(mediaUrl)) return res.status(400).json({ error: "URL refusée" });
  }

  const entry = connectedUsers.get(targetUserId);
  if (!entry) return res.status(404).json({ error: "Utilisateur non connecté" });
  if (entry.paused) return res.status(409).json({ error: "paused", status: "paused" });

  if (!senderAllowed(targetUserId, senderId)) {
    return res.status(403).json({ error: "blocked", status: "blocked" });
  }

  if (mediaType === "emote-wall" && entry.wall) {
    return res.status(409).json({ error: "wall-busy", status: "wall-busy" });
  }

  let resolvedUrl = mediaUrl || null;
  let resolvedType = mediaType;

  if (mediaType === "youtube") {
    const id = extractYtId(mediaUrl);
    grantYt(id);
    if (body.audioOnly) {
      resolvedUrl = `/yt-audio/${id}`;
      resolvedType = "youtube-audio";
    } else {
      resolvedUrl = `/yt/${id}`;
      resolvedType = "youtube-stream";
    }
  }

  const payload = {
    id: crypto.randomUUID(),
    mediaUrl: resolvedUrl,
    mediaType: resolvedType,
    text,
    senderName: safeSender,
    senderId: senderId || null,
    duration,
    position,
    sound,
    start,
    count,
    ts: Date.now(),
  };

  entry.socket.emit("meme", payload);
  pushHistory(targetUserId, payload);
  console.log(`[meme] ${safeSender} -> ${targetUserId} | ${resolvedType} | ${duration}s`);
  res.json({ status: "sent" });
});

app.get("/api/users", requireApiKey, (req, res) => {
  res.json([...connectedUsers.entries()].map(([id, e]) => ({
    id, paused: e.paused, wall: e.wall,
  })));
});

app.post("/api/link", requireApiKey, (req, res) => {
  const { userId } = req.body || {};
  if (!userId || typeof userId !== "string" || !/^\d{17,20}$/.test(userId)) {
    return res.status(400).json({ error: "userId invalide" });
  }
  res.json({ token: signToken(userId) });
});

app.get("/api/history", requireApiKey, (req, res) => {
  const { userId } = req.query;
  res.json(historyStore[userId] || []);
});

app.get("/api/lists", requireApiKey, (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "userId requis" });
  res.json(userLists(userId));
});

app.put("/api/lists", requireApiKey, (req, res) => {
  const { userId, mode, ids } = req.body || {};
  if (!userId || typeof userId !== "string") return res.status(400).json({ error: "userId requis" });
  if (mode !== "blacklist" && mode !== "whitelist") return res.status(400).json({ error: "mode invalide" });
  const clean = Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === "string" && /^\d{17,20}$/.test(id)))].slice(0, 200) : [];
  lists[userId] = { mode, ids: clean };
  saveLists();
  res.json(lists[userId]);
});

server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
