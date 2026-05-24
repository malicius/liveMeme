# 🎭 MemeScreen POC

Envoie des memes depuis Discord directement sur l'écran de quelqu'un — par-dessus toutes ses autres applications, en fond transparent.

## Architecture

```
Discord Channel
     │
     ▼
 Bot Discord  ──POST──▶  Serveur Express + Socket.io
  (bot.js)               (server.js)
                              │
                         Socket.io emit
                              │
                              ▼
                    App Electron (overlay-app/)
                    • Fenêtre 100% transparente
                    • Always-on-top
                    • Click-through quand idle
```

## Structure du projet

```
meme-poc/
├── server.js          ← Serveur Express + Socket.io
├── bot.js             ← Bot Discord
├── package.json       ← Dépendances serveur/bot
├── .env               ← Config (token Discord, etc.)
└── overlay-app/
    ├── main.js        ← Electron (fenêtre transparente)
    ├── preload.js     ← Bridge sécurisé Electron ↔ page
    ├── overlay.html   ← Interface du meme
    └── package.json   ← Dépendances Electron
```

## Setup

### 1. Serveur + Bot
```bash
npm install
cp .env.example .env   # remplis DISCORD_TOKEN + MEME_CHANNEL_ID
npm run dev            # lance serveur et bot en parallèle
```

### 2. App Electron (chez chaque destinataire)
```bash
cd overlay-app
npm install
npm start
```
Au premier lancement, l'app demande le Discord User ID de l'utilisateur.

## Comment utiliser

Dans le channel Discord dédié :
```
!send @Jean lol t'as vu ça ?
```
+ une image ou vidéo en pièce jointe

→ Le meme apparaît au centre de l'écran de Jean, par-dessus tout.
→ Il disparaît après 12 secondes ou avec le bouton Fermer / Échap.
→ Entre les memes, la fenêtre est invisible et click-through (ça ne gêne pas du tout).

## Comportement de l'overlay

| État | Fenêtre | Souris |
|---|---|---|
| Idle (pas de meme) | Invisible | Passe à travers |
| Meme affiché | Visible au centre | Clics actifs (bouton fermer) |

## Créer le bot Discord

1. https://discord.com/developers/applications → New Application → Bot
2. Copie le **Token**
3. Active : **Server Members Intent** + **Message Content Intent**
4. Invite sur ton serveur avec : `Read Messages`, `Send Messages`, `Add Reactions`

## Debug

Tester sans Discord (curl) :
```bash
curl -X POST http://localhost:3000/api/send-meme \
  -H "Content-Type: application/json" \
  -d '{"targetUserId":"TON_ID","mediaUrl":"https://i.imgur.com/xyz.jpg","mediaType":"image","text":"LOL","senderName":"Test"}'
```

Voir les utilisateurs connectés :
```
GET http://localhost:3000/api/users
```


### Note

- ajouter que un sond
- regler la force du sond