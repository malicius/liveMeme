# MemeScreen — Contexte Projet

## Ce que fait ce projet

Application pour envoyer des memes depuis un channel Discord directement sur l'écran d'une personne, en temps réel. Le meme apparaît en overlay transparent par-dessus toutes ses applications, au centre de son écran.

## Architecture

```
Discord Channel
     │  !send @user [texte] + image/vidéo
     ▼
 bot.js (discord.js)
     │  POST /api/send-meme
     ▼
 server.js (Express + Socket.io)
     │  socket.emit("meme", payload)
     ▼
 overlay-app/ (Electron)
     • Fenêtre 100% transparente
     • Always-on-top (type: "screen-saver")
     • Click-through quand idle (setIgnoreMouseEvents)
     • Affiche le meme au centre pendant 12s
```

## Structure des fichiers

```
meme-poc/
├── CLAUDE.md              ← ce fichier
├── server.js              ← serveur Express + Socket.io (port 3000)
├── bot.js                 ← bot Discord (discord.js v14)
├── package.json           ← dépendances : discord.js, express, socket.io, dotenv, cors
├── .env                   ← DISCORD_TOKEN, MEME_CHANNEL_ID, PORT, SERVER_URL
└── overlay-app/
    ├── main.js            ← processus Electron principal
    ├── preload.js         ← bridge contextIsolation (IPC : meme-show / meme-hide)
    ├── overlay.html       ← UI de l'overlay (Socket.io client, fonts Bebas Neue)
    └── package.json       ← dépendances : electron ^28
```

## Variables d'environnement (.env)

```
DISCORD_TOKEN=        # token du bot Discord
MEME_CHANNEL_ID=      # ID du channel Discord dédié
SERVER_URL=http://localhost:3000
PORT=3000
```

## Commandes utiles

```bash
# Lancer serveur + bot ensemble
npm run dev

# Lancer séparément
node server.js
node bot.js

# Lancer l'app Electron (chez le destinataire)
cd overlay-app && npm install && npm start
```

## Comment utiliser (usage Discord)

Dans le channel dédié :
```
!send @Personne texte optionnel
```
+ une image ou vidéo en pièce jointe.

Le bot répond avec ✅ si envoyé, ou un message d'erreur si la personne n'est pas connectée.

## API REST du serveur

### POST /api/send-meme
```json
{
  "targetUserId": "DISCORD_USER_ID",
  "mediaUrl": "https://...",
  "mediaType": "image",
  "text": "caption optionnelle",
  "senderName": "nom de l'expéditeur"
}
```
Retourne `{ status: "sent" }` ou `{ error: "..." }`.

### GET /api/users
Retourne la liste des Discord User IDs actuellement connectés via Socket.io.

## Comportement de l'overlay Electron

| État | Fenêtre | Souris |
|---|---|---|
| Idle | Invisible | Click-through (`setIgnoreMouseEvents(true)`) |
| Meme reçu | Visible, centré | Clics actifs (bouton Fermer) |
| Fermé | Invisible | Click-through |

- Le destinataire entre son Discord User ID au premier lancement (stocké dans localStorage)
- Fermeture : bouton, touche Échap, ou auto après 12 secondes

## Décisions techniques importantes

- **Electron** choisi (et non un navigateur) car seul un vrai process natif peut créer une fenêtre transparente always-on-top click-through
- **Socket.io** pour le push temps réel (pas de polling)
- **contextIsolation: true** dans Electron — le renderer ne peut pas accéder directement à l'IPC, tout passe par `preload.js`
- L'identification socket se fait côté client via `socket.emit("identify", discordUserId)`

## Prochaines étapes possibles

- Auth OAuth Discord (remplace le prompt manuel pour l'User ID)
- Deploy sur Railway/Render pour fonctionner hors réseau local
- Packager l'app Electron avec `electron-builder` pour distribuer un `.exe` / `.dmg`
- Effets visuels : son, shake de l'écran, confetti
- Historique des memes reçus
