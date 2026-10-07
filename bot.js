const { Client, GatewayIntentBits } = require("discord.js");
require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const VALID_POSITIONS = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];
const VIDEO_EXT    = /\.(mp4|webm|mov|mkv|avi|m4v)(\?.*)?$/i;
const IMAGE_EXT    = /\.(gif|png|jpe?g|webp|avif|bmp|svg)(\?.*)?$/i;
const YOUTUBE_URL  = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)/i;

const SEND_DEFAULT_DURATION = 3;
const WALL_DEFAULT_DURATION = 8;

// Discordbot passe les protections anti-bot de la plupart des hébergeurs de GIF (Klipy, Tenor…)
// puisqu'ils veulent que Discord affiche leur aperçu.
const RESOLVE_UAS = [
  "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function parseMetaTags(html) {
  const metas = [];
  for (const [tag] of html.matchAll(/<meta\s[^>]*>/gi)) {
    const attrs = {};
    for (const [, k, v1, v2] of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[k.toLowerCase()] = decodeEntities(v1 ?? v2);
    }
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (key && attrs.content) metas.push({ key, value: attrs.content });
  }
  return metas;
}

function pickMediaFromMeta(metas) {
  const all = (...keys) => metas.filter(m => keys.includes(m.key)).map(m => m.value);
  const video = all("og:video:secure_url", "og:video:url", "og:video", "twitter:player:stream")
    .find(u => VIDEO_EXT.test(u));
  const images = all("og:image:secure_url", "og:image:url", "og:image", "twitter:image");
  const image = images.find(u => /\.gif(\?.*)?$/i.test(u)) || images[0];
  return { video, image };
}

// Transforme un lien de page (Klipy, Tenor, Giphy, …) en lien direct vers le média.
// Renvoie { video, image } (l'un ou l'autre peut manquer) ou null.
async function resolveMediaUrl(url) {
  for (const ua of RESOLVE_UAS) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": ua }, redirect: "follow", signal: AbortSignal.timeout(8000) });
      const type = res.headers.get("content-type") || "";
      if (type.startsWith("video/")) { res.body?.cancel(); return { video: res.url }; }
      if (type.startsWith("image/")) { res.body?.cancel(); return { image: res.url }; }
      if (!res.ok || !type.includes("html")) { res.body?.cancel(); continue; }
      const found = pickMediaFromMeta(parseMetaTags(await res.text()));
      if (found.video || found.image) return found;
    } catch {}
  }
  return null;
}

const FLAG_ALIASES = {
  time: "time", t: "time", duree: "time", durée: "time",
  pos: "pos", p: "pos", position: "pos",
  sound: "sound", son: "sound",
  silent: "silent", mute: "silent", nosound: "silent",
  start: "start", s: "start",
  audio: "audio", a: "audio",
  count: "count", c: "count", n: "count",
};
const VALUE_FLAGS = new Set(["time", "pos", "start", "count"]);

function readFlagValue(flag, raw) {
  if (raw == null) return undefined;
  if (flag === "pos") return VALID_POSITIONS.includes(raw.toLowerCase()) ? raw.toLowerCase() : undefined;
  const n = parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

// Les options peuvent être placées n'importe où après la commande :
// "!send @x --time 5 lien", "!send @x lien --time=5", "!send @x —time 5" (tiret auto-corrigé sur mobile)…
function parseFlags(content) {
  const tokens = content.replace(/[—–‒−]/g, "--").split(/\s+/).filter(Boolean);
  const flags = {};
  const words = [];
  let urlFromText = null;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const url = tok.match(/^<?(https?:\/\/[^\s>]+)>?$/i);
    if (url) {
      if (!urlFromText) urlFromText = url[1];
      continue;
    }

    const m = tok.match(/^-{1,2}([a-zéè]+)(?:[=:]?(.+))?$/i);
    const flag = m && FLAG_ALIASES[m[1].toLowerCase()];
    if (!flag) { words.push(tok); continue; }

    if (!VALUE_FLAGS.has(flag)) {
      if (m[2] == null) flags[flag] = true; else words.push(tok);
      continue;
    }

    if (m[2] != null) {
      const value = readFlagValue(flag, m[2]);
      if (value === undefined) words.push(tok); else flags[flag] = value;
      continue;
    }
    const value = readFlagValue(flag, tokens[i + 1]);
    if (value !== undefined) { flags[flag] = value; i++; }
  }

  return {
    text: words.join(" "),
    duration: flags.time ?? null,
    position: flags.pos ?? "c",
    sound: !flags.silent,
    start: Math.max(0, flags.start ?? 0),
    audioOnly: Boolean(flags.audio),
    count: flags.count != null ? Math.min(200, Math.max(5, Math.round(flags.count))) : 40,
    urlFromText,
  };
}

function clampDuration(d, max, fallback) {
  return d == null ? fallback : Math.min(max, Math.max(1, d));
}

function serverFetch(url, options = {}) {
  const headers = { ...options.headers, "X-API-Key": process.env.API_KEY };
  return fetch(`${process.env.SERVER_URL}${url}`, { ...options, headers });
}

async function postMeme(targetUserId, payload) {
  const res = await serverFetch("/api/send-meme", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetUserId, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function describeFailure(data, username) {
  if (data.status === "paused") return `⏸ ${username} a mis l'overlay en pause.`;
  if (data.status === "blocked") return `🚫 ${username} ne reçoit pas tes mèmes.`;
  if (data.status === "wall-busy") return `⏳ Un emote wall est déjà en cours chez ${username}.`;
  return `❌ ${username} n'est pas connecté(e) à l'overlay.`;
}

client.once("ready", () => {
  console.log(`Bot connecté : ${client.user.tag}`);
});

const HELP_MESSAGE = `
**Commandes MemeScreen**

\`\`\`
!send @user [url ou pièce jointe] [texte] [options]
!send @everyone [url ou pièce jointe] [texte] [options]
!wall @user [emoji ou image] [options]
!wall @everyone [emoji ou image] [options]
!who
!link
!history
!block @user
!allow @user
!list
!listmode blacklist|whitelist
\`\`\`

**Sources supportées :** pièce jointe · image/gif/vidéo · YouTube · Tenor · Giphy · Klipy · la plupart des liens de GIF

Les options se placent **n'importe où** après la commande (\`--time 5\`, \`--time=5\`, \`-t 5\`…).

**Options !send :**
\`--time N\` — durée en secondes (1–10, défaut : **${SEND_DEFAULT_DURATION}**)
\`--pos X\` — position (défaut : **c**)
\`--silent\` — pas de son de notification
\`--start N\` — démarre à N secondes
\`--audio\` — son uniquement

**Options !wall :**
\`--time N\` — durée en secondes (1–30, défaut : **${WALL_DEFAULT_DURATION}**)
\`--count N\` — nombre de particules (5–200, défaut : **40**)

**Grille des positions (\`--pos\`) :**
\`\`\`
tl  │  t  │  tr
────┼─────┼────
 l  │  c  │  r
────┼─────┼────
bl  │  b  │  br
\`\`\`

**Filtre d'expéditeurs** (réglable aussi dans l'overlay) :
\`!listmode blacklist\` — tout le monde sauf les bloqués
\`!listmode whitelist\` — seulement les autorisés
`.trim();

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== process.env.MEME_CHANNEL_ID) return;

  const content = message.content.trim();

  if (content === "!help") return message.reply(HELP_MESSAGE);

  if (content === "!link") {
    try {
      const res = await serverFetch("/api/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: message.author.id }),
      });
      const data = await res.json();
      if (!res.ok) return message.reply("❌ Impossible de générer le code.");
      await message.author.send(
        `Colle ce code dans **MemeOverlay → Paramètres → Code de liaison** :\n\`\`\`\n${data.token}\n\`\`\`\nIl est valable 30 jours et lié à ton compte.`
      );
      return message.reply("🔐 Code envoyé en message privé.");
    } catch {
      return message.reply("❌ Je ne peux pas t'envoyer de MP. Ouvre tes messages privés et réessaie.");
    }
  }

  if (content === "!who") {
    try {
      const res = await serverFetch("/api/users");
      const users = await res.json();
      if (!users.length) return message.reply("Aucun utilisateur connecté à l'overlay.");
      const names = await Promise.all(users.map(async (u) => {
        const flags = [u.paused ? "pause" : null, u.wall ? "wall" : null].filter(Boolean).join(", ");
        try {
          const member = await message.guild.members.fetch(u.id);
          return `• ${member.displayName}${flags ? ` _( ${flags} )_` : ""}`;
        } catch {
          return `• Inconnu (\`${u.id}\`)${flags ? ` _( ${flags} )_` : ""}`;
        }
      }));
      return message.reply(`**Connectés (${users.length}) :**\n${names.join("\n")}`);
    } catch {
      return message.reply("❌ Impossible de joindre le serveur.");
    }
  }

  if (content === "!history") {
    try {
      const res = await serverFetch(`/api/history?userId=${message.author.id}`);
      const items = await res.json();
      if (!items.length) return message.reply("Aucun mème reçu pour l'instant.");
      const lines = items.slice(0, 10).map((it, i) => {
        const when = new Date(it.ts).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
        return `**${i + 1}.** ${it.senderName || "?"} — ${it.text || it.mediaType} _(${when})_`;
      });
      return message.reply(`**Tes 10 derniers mèmes :**\n${lines.join("\n")}\n\nRejoue-les depuis le menu de l'overlay.`);
    } catch {
      return message.reply("❌ Impossible de joindre le serveur.");
    }
  }

  if (content === "!list") {
    try {
      const res = await serverFetch(`/api/lists?userId=${message.author.id}`);
      const list = await res.json();
      const names = await Promise.all((list.ids || []).map(async (id) => {
        try {
          const member = await message.guild.members.fetch(id);
          return `• ${member.displayName}`;
        } catch { return `• \`${id}\``; }
      }));
      const mode = list.mode === "whitelist" ? "whitelist (seulement eux)" : "blacklist (tout le monde sauf eux)";
      return message.reply(`**Mode : ${mode}**\n${names.length ? names.join("\n") : "_Liste vide._"}`);
    } catch {
      return message.reply("❌ Impossible de joindre le serveur.");
    }
  }

  const modeMatch = content.match(/^!listmode\s+(blacklist|whitelist)$/i);
  if (modeMatch) {
    try {
      const current = await serverFetch(`/api/lists?userId=${message.author.id}`).then(r => r.json());
      await serverFetch("/api/lists", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: message.author.id, mode: modeMatch[1].toLowerCase(), ids: current.ids || [] }),
      });
      return message.reply(`Mode réglé sur **${modeMatch[1].toLowerCase()}**.`);
    } catch {
      return message.reply("❌ Impossible de joindre le serveur.");
    }
  }

  const listEdit = content.match(/^!(block|allow|unblock|unallow)\s+/i);
  if (listEdit) {
    const target = message.mentions.users.first();
    if (!target) return message.reply("Mentionne quelqu'un : `!block @user`");
    if (target.id === message.author.id) return message.reply("Tu ne peux pas te filtrer toi-même.");
    const action = listEdit[1].toLowerCase();
    try {
      const current = await serverFetch(`/api/lists?userId=${message.author.id}`).then(r => r.json());
      const ids = new Set(current.ids || []);
      const add = action === "block" || action === "allow";
      if (add) ids.add(target.id); else ids.delete(target.id);
      await serverFetch("/api/lists", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: message.author.id, mode: current.mode || "blacklist", ids: [...ids] }),
      });
      const verb = add ? "ajouté à" : "retiré de";
      return message.reply(`**${target.username}** ${verb} ta liste.`);
    } catch {
      return message.reply("❌ Impossible de joindre le serveur.");
    }
  }

  if (content.startsWith("!wall")) {
    const isEveryone = message.mentions.everyone;
    const mention    = isEveryone ? null : message.mentions.users.first();

    if (!mention && !isEveryone) {
      return message.reply("Usage : `!wall @user [emoji ou image] [--time 5-30] [--count 10-200]`");
    }

    const raw = message.content
      .slice(5)
      .replace(/<@!?[0-9]+>/g, "")
      .replace(/@everyone|@here/gi, "")
      .trim();

    const { text, duration: parsedDuration, count, urlFromText } = parseFlags(raw);
    const duration = clampDuration(parsedDuration, 30, WALL_DEFAULT_DURATION);

    let mediaUrl = null;
    const attachment = message.attachments.first();
    if (attachment) {
      mediaUrl = attachment.url;
    } else if (urlFromText) {
      mediaUrl = urlFromText;
      // Les particules sont des <img> : on veut une image, pas une vidéo.
      if (!IMAGE_EXT.test(mediaUrl)) {
        const resolved = await resolveMediaUrl(mediaUrl);
        if (resolved?.image) mediaUrl = resolved.image;
      }
    }

    if (!mediaUrl && !text) return message.reply("Ajoute un emoji, une image ou un lien !");

    const senderName = message.member?.displayName || message.author.username;
    const payload = { mediaUrl, mediaType: "emote-wall", text, senderName, senderId: message.author.id, duration, count };

    if (isEveryone) {
      try {
        const users = await serverFetch("/api/users").then(r => r.json());
        const targets = users.filter(u => u.id !== message.author.id && !u.paused && !u.wall);
        if (!targets.length) return message.reply("Aucun overlay disponible (connecté, pas en pause, pas déjà en wall).");
        const results = await Promise.all(targets.map(u => postMeme(u.id, payload)));
        const sent = results.filter(r => r.data.status === "sent").length;
        await message.react("✅");
        return message.reply(`Emote wall envoyé à **${sent}** utilisateur(s).`);
      } catch { return message.reply("❌ Impossible de joindre le serveur."); }
    }

    try {
      const { data } = await postMeme(mention.id, payload);
      if (data.status === "sent") await message.react("✅");
      else await message.reply(describeFailure(data, mention.username));
    } catch { await message.reply("❌ Impossible de joindre le serveur."); }
    return;
  }

  if (!content.startsWith("!send")) return;

  const isEveryone = message.mentions.everyone;
  const mention = isEveryone ? null : message.mentions.users.first();

  if (!mention && !isEveryone) {
    return message.reply(
      "Usage : `!send @user [texte] [url] [--time 1-10] [--pos tl/t/tr/l/c/r/bl/b/br] [--silent] [--start secondes]`\n" +
      "Pièce jointe OU lien (image, gif, vidéo, YouTube, Tenor, Giphy, Klipy…). Les options peuvent être placées n'importe où."
    );
  }

  const raw = message.content
    .slice(5)
    .replace(/<@!?[0-9]+>/g, "")
    .replace(/@everyone|@here/gi, "")
    .trim();

  const { text, duration: parsedDuration, position, sound, start, audioOnly, urlFromText } = parseFlags(raw);
  const duration = clampDuration(parsedDuration, 10, SEND_DEFAULT_DURATION);

  let mediaUrl = null;
  let mediaType = "image";

  const attachment = message.attachments.first();
  if (attachment) {
    mediaUrl = attachment.url;
    mediaType = attachment.contentType?.startsWith("video") ? "video" : "image";
  } else if (urlFromText) {
    mediaUrl = urlFromText;
    if (YOUTUBE_URL.test(mediaUrl)) mediaType = "youtube";
    else if (VIDEO_EXT.test(mediaUrl)) mediaType = "video";
    else if (IMAGE_EXT.test(mediaUrl)) mediaType = "image";
    else {
      // Lien de page (Klipy, Tenor, Giphy…) ou lien direct sans extension.
      const resolved = await resolveMediaUrl(mediaUrl);
      if (!resolved) return message.reply("❌ Impossible de trouver une image ou une vidéo derrière ce lien.");
      if (resolved.video) { mediaUrl = resolved.video; mediaType = "video"; }
      else { mediaUrl = resolved.image; mediaType = "image"; }
    }
  }

  if (!mediaUrl) return message.reply("Ajoute une image/vidéo en pièce jointe ou colle un lien dans le message !");

  if (audioOnly && mediaType === "video") mediaType = "audio";

  const senderName = message.member?.displayName || message.author.username;
  const payload = { mediaUrl, mediaType, text, senderName, senderId: message.author.id, duration, position, sound, start, audioOnly };

  if (isEveryone) {
    try {
      const users = await serverFetch("/api/users").then(r => r.json());
      const targets = users.filter(u => !u.paused);
      if (!targets.length) return message.reply("Aucun utilisateur connecté (ou tous en pause).");
      const results = await Promise.all(targets.map(u => postMeme(u.id, payload)));
      const sent = results.filter(r => r.data.status === "sent").length;
      const paused = users.filter(u => u.paused).length;
      await message.react("✅");
      return message.reply(`Envoyé à **${sent}** utilisateur(s).${paused ? ` ${paused} en pause, ignoré(s).` : ""}`);
    } catch (err) {
      console.error(err);
      return message.reply("❌ Impossible de joindre le serveur.");
    }
  }

  try {
    const { data } = await postMeme(mention.id, payload);
    if (data.status === "sent") await message.react("✅");
    else await message.reply(describeFailure(data, mention.username));
  } catch (err) {
    console.error(err);
    await message.reply("❌ Impossible de joindre le serveur.");
  }
});

client.login(process.env.DISCORD_TOKEN);
