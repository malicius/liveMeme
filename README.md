# MemeScreen v2.0.0

MemeScreen permet d'afficher des mèmes sur une fenêtre overlay par-dessus ton écran, contrôlée via un bot Discord.

## Installation

1. Prérequis : Node.js (v20+).
2. Cloner le dépôt et installer les dépendances :
   ```bash
   npm install
   cd overlay-app && npm install && cd ..
   ```
3. Configurer l'environnement :
   ```bash
   cp .env.example .env
   # Éditer .env et remplir :
   # DISCORD_TOKEN=...
   # MEME_CHANNEL_ID=...
   # SERVER_URL=...
   # API_KEY=... (génère avec `openssl rand -hex 32`)
   # LINK_SECRET=... (génère avec `openssl rand -hex 32`)
   ```
4. Lancer :
   ```bash
   npm run dev
   ```

## Utilisation

1. **Lier son compte** : Sur Discord, tape `!link` pour recevoir un code.
2. **Configurer l'overlay** : Ouvre `MemeOverlay`, va dans **Paramètres** et colle le code de liaison (Token) et l'URL du serveur.
3. **Commander** : Utilise les commandes Discord `!send`, `!wall`, etc.

## Commandes Discord

```
!send @user [url] [texte] [--time 1-10] [--pos tl/t/tr/l/c/r/bl/b/br] [--sound] [--start secondes]
!wall @user [emoji/image] [--time 5-30] [--count 5-200]
!who, !link, !history, !list
!block @user, !allow @user, !listmode blacklist|whitelist
```

## Développement

- Serveur : `npm start`
- Bot : `npm run bot`
- Overlay : `cd overlay-app && npm start`

🤖 Généré avec [Claude Code](https://claude.com/claude-code)
