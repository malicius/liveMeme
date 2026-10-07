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
const YOUTUBE_URL  = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)/i;
const TENOR_URL    = /^https?:\/\/(www\.)?tenor\.com\//i;
const GIPHY_MEDIA  = /^https?:\/\/media[0-9]*\.giphy\.com\//i;
const GIPHY_PAGE   = /^https?:\/\/(www\.)?giphy\.com\/gifs\//i;

async function resolveMediaUrl(url) {
  if (TENOR_URL.test(url) || GIPHY_PAGE.test(url)) {
    try {
      const res  = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      const html = await res.text();
      const video = html.match(/property="og:video(?::url)?"\s+content="([^"]+)"/i)
                 || html.match(/content="([^"]+)"\s+property="og:video(?::url)?"/i);
      const image = html.match(/property="og:image"\s+content="([^"]+)"/i)
                 || html.match(/content="([^"]+)"\s+property="og:image"/i);
      if (video?.[1]) return { url: video[1], type: "video" };
      if (image?.[1]) return { url: image[1], type: "image" };
    } catch {}
  }
  return null;
}

function parseFlags(content) {
  let text = content;
  let duration = 2;
  let position = "c";
  let sound = false;
  let start = 0;
  let urlFromText = null;
  let count = 40;

  text = text.replace(/--time\s+(\d+)/i, (_, n) => {
    duration = Math.min(10, Math.max(1, parseInt(n)));
    return "";
  });

  text = text.replace(/--pos\s+(\w+)/i, (_, p) => {
    if (VALID_POSITIONS.includes(p.toLowerCase())) position = p.toLowerCase();
    return "";
  });

  text = text.replace(/--sound/i, () => {
    sound = true;
    return "";
  });

  text = text.replace(/--start\s+([\d.]+)/i, (_, n) => {
    start = parseFloat(n);
    return "";
  });

  let audioOnly = false;
  text = text.replace(/--audio/i, () => {
    audioOnly = true;
    return "";
  });

  text = text.replace(/--count\s+(\d+)/i, (_, n) => {
    count = Math.min(200, Math.max(5, parseInt(n)));
    return "";
  });

  text = text.replace(/https?:\/\/\S+/gi, (url) => {
    if (!urlFromText) urlFromText = url;
    return "";
  });

  return { text: text.trim(), duration, position, sound, start, audioOnly, urlFromText, count };
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

**Sources supportées :** pièce jointe · image/gif/vidéo · YouTube · Tenor · Giphy

**Options !send :**
\`--time N\` — durée en secondes (1–10, défaut : **2**)
\`--pos X\` — position (défaut : **c**)
\`--sound\` — son à l'apparition
\`--start N\` — démarre à N secondes
\`--audio\` — son uniquement

**Options !wall :**
\`--time N\` — durée en secondes (défaut : **8**)
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
    const duration = parsedDuration === 2 ? 8 : parsedDuration;

    let mediaUrl = null;
    const attachment = message.attachments.first();
    if (attachment) {
      mediaUrl = attachment.url;
    } else if (urlFromText) {
      mediaUrl = urlFromText;
      if (TENOR_URL.test(mediaUrl) || GIPHY_PAGE.test(mediaUrl)) {
        const resolved = await resolveMediaUrl(mediaUrl);
        if (resolved) mediaUrl = resolved.url;
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
      "Usage : `!send @user [texte] [url] [--time 1-10] [--pos tl/t/tr/l/c/r/bl/b/br] [--sound] [--start secondes]`\n" +
      "Pièce jointe OU lien direct (image, gif, vidéo)."
    );
  }

  const raw = message.content
    .slice(6)
    .replace(/<@!?[0-9]+>/g, "")
    .replace(/@everyone|@here/gi, "")
    .trim();

  const { text, duration, position, sound, start, audioOnly, urlFromText } = parseFlags(raw);

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
    else mediaType = "image";
  }

  if (!mediaUrl) return message.reply("Ajoute une image/vidéo en pièce jointe ou colle un lien dans le message !");

  if (TENOR_URL.test(mediaUrl) || GIPHY_PAGE.test(mediaUrl)) {
    const resolved = await resolveMediaUrl(mediaUrl);
    if (resolved) { mediaUrl = resolved.url; mediaType = resolved.type; }
  } else if (GIPHY_MEDIA.test(mediaUrl)) {
    mediaType = "image";
  }

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
