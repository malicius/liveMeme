# CLAUDE.md

Ce fichier fournit des conseils à Claude Code (claude.ai/code) pour travailler sur le code de ce dépôt.

## Architecture

Ce projet se compose de deux parties principales :

1.  **Serveur & Bot (`/`)** : Une application Node.js utilisant `express`, `socket.io` et `discord.js`.
    - `server.js` : Serveur Express qui gère le streaming des mèmes et les connexions socket.io.
    - `bot.js` : Bot Discord qui reçoit les commandes (`!send`, `!who`, etc.) et demande au serveur de diffuser les médias sur l'overlay.
2.  **Application Overlay (`/overlay-app/`)** : Une application Electron qui affiche l'overlay des mèmes sur l'écran de l'utilisateur.
    - `main.js` : Processus principal Electron gérant la transparence de la fenêtre, l'icône dans la zone de notification (tray) et les raccourcis globaux.
    - `overlay.html` : Interface frontend affichant le mème.
    - `setup.html` : Interface de configuration.

## Commandes

### Serveur & Bot
À exécuter depuis le répertoire racine :

- `npm start` : Démarre le serveur (`server.js`).
- `npm run bot` : Démarre le bot Discord (`bot.js`).
- `npm run dev` : Exécute simultanément le serveur et le bot.

### Application Overlay
À exécuter depuis le répertoire `/overlay-app/` :

- `npm start` : Lance l'application Electron en mode développement.
- `npm run build` : Construit l'exécutable portable pour Windows.
- `npm run build:linux` : Construit l'AppImage pour Linux.

## Déploiement & Configuration

- **Serveur** : Configuré via `.env` (jeton Discord, ID du canal, URL du serveur).
- **GitHub Workflows** : Les versions automatiques sont définies dans `.github/workflows/build-release.yml`. Les builds sont déclenchés par l'ajout d'un tag git commençant par `v` (ex: `v1.2.1`).

## Notes

- Les fichiers `main.js`, `overlay.html` et `preload.js` à la racine sont hérités et obsolètes ; utilisez les versions présentes dans `overlay-app/`.
- Assurez-vous que toutes les autorisations du bot Discord sont correctement configurées selon le `README.md` (Server Members Intent, Message Content Intent).
