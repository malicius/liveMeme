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

  // Extraire une URL si présente dans le message
  text = text.replace(/https?:\/\/\S+/gi, (url) => {
    if (!urlFromText) urlFromText = url;
    return "";
  });

  return { text: text.trim(), duration, position, sound, start, audioOnly, urlFromText, count };
}

client.once("ready", () => {
  console.log(`Bot connecté : ${client.user.tag}`);
});

const HELP_MESSAGE = `
**📖 Commandes MemeScreen**

\`\`\`
!send @user [url ou pièce jointe] [texte] [options]
!send @everyone [url ou pièce jointe] [texte] [options]
!wall @user [emoji ou image] [options]
!wall @everyone [emoji ou image] [options]
!who
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

**Exemples :**
\`!who\`
\`!send @Jean\` + image en pièce jointe
\`!send @Jean https://youtu.be/xyz --start 43 --time 10 --sound\`
\`!wall @Jean 🔥\` — pluie de 🔥 pendant 8s
\`!wall @everyone 💀 --count 80 --time 12\`
\`!wall @Jean\` + gif en pièce jointe — pluie d'images
`.trim();

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== process.env.MEME_CHANNEL_ID) return;

  if (message.content.trim() === "!help") {
    return message.reply(HELP_MESSAGE);
  }

  if (message.content.trim() === "!who") {
    try {
      const res = await fetch(`${process.env.SERVER_URL}/api/users`);
      const ids = await res.json();
      if (!ids.length) return message.reply("Aucun utilisateur connecté à l'overlay.");
      const names = await Promise.all(ids.map(async (id) => {
        try {
          const member = await message.guild.members.fetch(id);
          return `• ${member.displayName}`;
        } catch {
          return `• Inconnu (\`${id}\`)`;
        }
      }));
      return message.reply(`**🟢 Connectés (${ids.length}) :**\n${names.join("\n")}`);
    } catch {
      return message.reply("❌ Impossible de joindre le serveur.");
    }
  }

  // ── !wall ────────────────────────────────────────────────────────────────
  if (message.content.startsWith("!wall")) {
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

    if (!mediaUrl && !text) {
      return message.reply("Ajoute un emoji, une image ou un lien !");
    }

    const senderName = message.member?.displayName || message.author.username;
    const payload    = { mediaUrl, mediaType: "emote-wall", text, senderName, duration, count };

    if (isEveryone) {
      try {
        const ids = await fetch(`${process.env.SERVER_URL}/api/users`).then(r => r.json());
        if (!ids.length) return message.reply("Aucun utilisateur connecté à l'overlay.");
        await Promise.all(ids.map(id =>
          fetch(`${process.env.SERVER_URL}/api/send-meme`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetUserId: id, ...payload }),
          })
        ));
        await message.react("✅");
        await message.reply(`🌊 Emote wall envoyé à **${ids.length}** utilisateur(s).`);
      } catch { await message.reply("❌ Impossible de joindre le serveur."); }
      return;
    }

    try {
      const res  = await fetch(`${process.env.SERVER_URL}/api/send-meme`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: mention.id, ...payload }),
      });
      const data = await res.json();
      if (data.status === "sent") await message.react("✅");
      else await message.reply(`❌ ${mention.username} n'est pas connecté(e) à l'overlay.`);
    } catch { await message.reply("❌ Impossible de joindre le serveur."); }
    return;
  }

  if (!message.content.startsWith("!send")) return;

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

  // Source média : pièce jointe en priorité, sinon URL dans le texte
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

  if (!mediaUrl) {
    return message.reply("Ajoute une image/vidéo en pièce jointe ou colle un lien dans le message !");
  }

  // Résolution Tenor / Giphy page → URL directe
  if (TENOR_URL.test(mediaUrl) || GIPHY_PAGE.test(mediaUrl)) {
    const resolved = await resolveMediaUrl(mediaUrl);
    if (resolved) { mediaUrl = resolved.url; mediaType = resolved.type; }
  } else if (GIPHY_MEDIA.test(mediaUrl)) {
    mediaType = "image";
  }

  // Mode audio seul : on garde youtube pour traitement serveur, video → audio
  if (audioOnly && mediaType === "video") mediaType = "audio";

  const senderName = message.member?.displayName || message.author.username;

  if (isEveryone) {
    try {
      const usersRes = await fetch(`${process.env.SERVER_URL}/api/users`);
      const ids = await usersRes.json();
      if (!ids.length) return message.reply("Aucun utilisateur connecté à l'overlay.");
      await Promise.all(ids.map(id =>
        fetch(`${process.env.SERVER_URL}/api/send-meme`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetUserId: id, mediaUrl, mediaType, text, senderName, duration, position, sound, start, audioOnly }),
        })
      ));
      await message.react("✅");
      await message.reply(`📡 Envoyé à **${ids.length}** utilisateur(s) connecté(s).`);
    } catch (err) {
      console.error(err);
      await message.reply("❌ Impossible de joindre le serveur.");
    }
    return;
  }

  try {
    const res = await fetch(`${process.env.SERVER_URL}/api/send-meme`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: mention.id,
        mediaUrl,
        mediaType,
        text,
        senderName,
        duration,
        position,
        sound,
        start,
        audioOnly,
      }),
    });

    const data = await res.json();

    if (data.status === "sent") {
      await message.react("✅");
    } else {
      await message.reply(`❌ ${mention.username} n'est pas connecté(e) à l'overlay.`);
    }
  } catch (err) {
    console.error(err);
    await message.reply("❌ Impossible de joindre le serveur.");
  }
});

client.login(process.env.DISCORD_TOKEN);
