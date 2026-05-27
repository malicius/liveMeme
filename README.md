# MemeScreen v1.2.1

Envoie des memes depuis Discord directement sur l'écran de quelqu'un — par-dessus toutes ses autres applications, en fond transparent, en temps réel.

## Architecture

```
Discord Channel
     │  !send @user [url ou pièce jointe] [texte] [options]
     ▼
 bot.js (discord.js)
     │  POST /api/send-meme
     ▼
 server.js (Express + Socket.io)  ←  hébergé sur livememe.romaincampanha.ch
     │  socket.emit("meme", payload)
     ▼
 overlay-app/ (Electron)
     • Fenêtre 100% transparente, always-on-top
     • Click-through quand idle
     • File d'attente si plusieurs memes arrivent en même temps
```

## Structure du projet

```
liveMeme/
├── server.js          ← Serveur Express + Socket.io (port auto via env)
├── bot.js             ← Bot Discord
├── package.json       ← Dépendances serveur/bot
├── .env               ← Config (token Discord, etc.)
└── overlay-app/
    ├── main.js        ← Electron (fenêtre transparente, tray, raccourcis)
    ├── preload.js     ← Bridge contextIsolation
    ├── overlay.html   ← Interface du meme
    ├── setup.html     ← Écran de configuration
    └── package.json   ← Dépendances Electron
```

## Déploiement serveur (Infomaniak)

Le serveur et le bot tournent sur `livememe.romaincampanha.ch`.

```bash
# Cloner le repo sur le serveur
git clone https://github.com/malicius/liveMeme.git /sites/livememe.romaincampanha.ch/liveMeme
cd /sites/livememe.romaincampanha.ch/liveMeme
npm install

# Créer le .env
cp .env.example .env
nano .env   # remplir DISCORD_TOKEN, MEME_CHANNEL_ID, SERVER_URL

# Lancer avec PM2
./node_modules/.bin/pm2 start bot.js --name memescreen-bot
./node_modules/.bin/pm2 save

# Mises à jour
git pull && ./node_modules/.bin/pm2 restart memescreen-bot
```

Le serveur Node.js est géré par Infomaniak (point d'entrée : `server.js`).

## App Electron (chez chaque destinataire)

Télécharge le fichier depuis les [Releases GitHub](https://github.com/malicius/liveMeme/releases) :

| Plateforme | Fichier |
|---|---|
| Windows | `MemeOverlay.exe` — portable, aucune installation |
| Linux | `MemeOverlay.AppImage` — rendre exécutable puis lancer |

```bash
# Linux uniquement
chmod +x MemeOverlay.AppImage && ./MemeOverlay.AppImage
```

Au premier lancement, l'app demande :
- Le **Discord User ID**
- L'**URL du serveur** : `http://livememe.romaincampanha.ch`

## Commandes Discord

Dans le channel dédié :

```
!send @user [url ou pièce jointe] [texte] [options]
!send @everyone [url ou pièce jointe] [texte]
!who
!help
```

**Sources média supportées :**
- Pièce jointe Discord (image, gif, vidéo)
- Lien direct (image, gif, `.mp4`, `.webm`…)
- YouTube (`youtube.com/watch`, `youtu.be`, Shorts)
- Tenor (`tenor.com/...`)
- Giphy (`giphy.com/gifs/...` ou lien direct `media.giphy.com`)

**Options :**

| Option | Description | Défaut |
|---|---|---|
| `--time N` | Durée d'affichage en secondes (1–10) | `2` |
| `--pos X` | Position sur l'écran (voir grille) | `c` |
| `--sound` | Son à l'apparition | off |
| `--start N` | Démarre la vidéo/YouTube à N secondes | `0` |
| `--audio` | Son uniquement (pas d'image) | off |

**Grille des positions (`--pos`) :**
```
tl  │  t  │  tr
────┼─────┼────
 l  │  c  │  r
────┼─────┼────
bl  │  b  │  br
```

**Exemples :**
```
!send @Jean https://tenor.com/xyz.gif --pos tr --time 5
!send @everyone --sound + gif en pièce jointe
!send @Jean https://youtu.be/dQw4w9WgXcQ --start 43 --time 10
!send @Jean https://youtu.be/xyz --audio
```

## Paramètres de l'overlay (tray → Paramètres…)

| Paramètre | Options |
|---|---|
| Taille du média | Petit / Moyen / Grand / Taille originale |
| Volume | 0 – 100% |
| Raccourci fermeture | Touche configurable (défaut : Échap) |
| Lancer au démarrage | On / Off |
| Menu des applications | On / Off (Linux) |

## Comportement de l'overlay

| État | Fenêtre | Souris |
|---|---|---|
| Idle | Invisible | Passe à travers |
| Meme affiché | Visible | Click-through (pas de blocage) |
| Plusieurs memes en attente | File d'attente — affichés l'un après l'autre | — |

## Créer le bot Discord

1. [discord.com/developers](https://discord.com/developers) → New Application → Bot
2. Copie le **Token**
3. Active : **Server Members Intent** + **Message Content Intent**
4. Invite avec les permissions : `Read Messages`, `Send Messages`, `Add Reactions`

## Debug

```bash
# Voir les utilisateurs connectés
curl http://livememe.romaincampanha.ch/api/users

# Envoyer un meme manuellement
curl -X POST http://livememe.romaincampanha.ch/api/send-meme \
  -H "Content-Type: application/json" \
  -d '{"targetUserId":"TON_ID","mediaUrl":"https://i.imgur.com/xyz.jpg","mediaType":"image","text":"LOL","senderName":"Test"}'
```
