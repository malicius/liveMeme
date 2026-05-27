const express = require("express");
const http = require("http");
const https = require("https");
const path = require("path");
const { Server } = require("socket.io");
const cors = require("cors");
const youtubedl = require("youtube-dl-exec");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

app.use("/overlay", express.static(path.join(__dirname, "overlay-app")));

const connectedUsers = new Map();

io.on("connection", (socket) => {
  socket.on("identify", (userId) => {
    connectedUsers.set(userId, socket);
    socket.userId = userId;
    console.log(`[+] Connecté : ${userId}`);
  });

  socket.on("disconnect", () => {
    if (socket.userId) {
      connectedUsers.delete(socket.userId);
      console.log(`[-] Déconnecté : ${socket.userId}`);
    }
  });
});

// Extrait l'ID YouTube depuis n'importe quel format d'URL
function extractYtId(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([^&?/]+)/);
  return m ? m[1] : null;
}

// Proxy stream YouTube — évite tous les problèmes CORS et d'expiration d'URL
app.get("/api/yt-stream/:videoId", async (req, res) => {
  const { videoId } = req.params;

  try {
    const info = await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
      format: "best[ext=mp4]/best",
    });

    // Trouve l'URL directe du meilleur format mp4 avec audio+vidéo
    const directUrl = info.url || (info.formats && info.formats.find(f => f.ext === "mp4" && f.acodec !== "none" && f.vcodec !== "none")?.url) || info.formats?.[info.formats.length - 1]?.url;

    if (!directUrl) {
      console.error("[yt-stream] Aucune URL directe trouvée");
      return res.status(500).end();
    }

    console.log(`[yt] Proxying stream for ${videoId}`);

    const proxyReq = https.get(directUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://www.youtube.com/",
      }
    }, (proxyRes) => {
      res.setHeader("Content-Type", proxyRes.headers["content-type"] || "video/mp4");
      if (proxyRes.headers["content-length"]) {
        res.setHeader("Content-Length", proxyRes.headers["content-length"]);
      }
      res.setHeader("Accept-Ranges", "none");
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("[yt-stream proxy]", err.message);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });

    req.on("close", () => proxyReq.destroy());
  } catch (err) {
    console.error("[yt-stream]", err.message);
    if (!res.headersSent) res.status(500).end();
  }
});

// Proxy audio seul YouTube
app.get("/api/yt-audio/:videoId", async (req, res) => {
  const { videoId } = req.params;

  try {
    const info = await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      format: "bestaudio[ext=m4a]/bestaudio",
    });

    const directUrl = info.url || info.formats?.find(f => f.acodec !== "none" && f.vcodec === "none")?.url || info.formats?.[info.formats.length - 1]?.url;

    if (!directUrl) {
      console.error("[yt-audio] Aucune URL audio trouvée");
      return res.status(500).end();
    }

    console.log(`[yt] Proxying audio for ${videoId}`);

    const proxyReq = https.get(directUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://www.youtube.com/",
      }
    }, (proxyRes) => {
      res.setHeader("Content-Type", proxyRes.headers["content-type"] || "audio/mp4");
      if (proxyRes.headers["content-length"]) {
        res.setHeader("Content-Length", proxyRes.headers["content-length"]);
      }
      res.setHeader("Accept-Ranges", "none");
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("[yt-audio proxy]", err.message);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });

    req.on("close", () => proxyReq.destroy());
  } catch (err) {
    console.error("[yt-audio]", err.message);
    if (!res.headersSent) res.status(500).end();
  }
});

app.post("/api/send-meme", (req, res) => {
  const { targetUserId, mediaUrl, mediaType, text, senderName, duration, position, sound, start, audioOnly, count } = req.body;

  if (!targetUserId || (!mediaUrl && mediaType !== "emote-wall")) {
    return res.status(400).json({ error: "targetUserId et mediaUrl sont requis" });
  }

  const targetSocket = connectedUsers.get(targetUserId);
  if (!targetSocket) {
    return res.status(404).json({ error: "Utilisateur non connecté" });
  }

  let resolvedUrl = mediaUrl;
  let resolvedType = mediaType;

  if (mediaType === "youtube") {
    const id = extractYtId(mediaUrl);
    if (!id) return res.status(400).json({ error: "URL YouTube invalide" });
    if (audioOnly) {
      resolvedUrl = `/api/yt-audio/${id}`;
      resolvedType = "youtube-audio";
      console.log(`[yt] Audio proxy → /api/yt-audio/${id}`);
    } else {
      resolvedUrl = `/api/yt-stream/${id}`;
      resolvedType = "youtube-stream";
      console.log(`[yt] Stream proxy → /api/yt-stream/${id}`);
    }
  }

  targetSocket.emit("meme", {
    mediaUrl: resolvedUrl,
    mediaType: resolvedType,
    text,
    senderName,
    duration: duration ?? 2,
    position: position ?? "c",
    sound: sound ?? false,
    start: start ?? 0,
    count: count ?? 40,
  });

  console.log(`[meme] ${senderName} -> ${targetUserId} | ${resolvedType} | ${duration}s`);
  res.json({ status: "sent" });
});

app.get("/api/users", (req, res) => {
  res.json([...connectedUsers.keys()]);
});

const PORT = process.env.PORT || 38283;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
