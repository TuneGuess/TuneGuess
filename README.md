# 🎵 TuneGuess

`TuneGuess` est un jeu musical auto-hébergé où les joueurs devinent des titres à partir de leurs sources musicales (Spotify, YouTube, Jellyfin, Last.fm).

Ce dépôt contient un backend TypeScript (API + WebSocket) et un frontend Vue 3 (Vite). Le projet peut être lancé en local pour le développement ou déployé facilement avec Docker Compose.

**Résumé rapide**
- Backend: Node.js + TypeScript
- Frontend: Vue 3 + Vite
- Auth providers: Spotify, YouTube, Jellyfin, Last.fm
- Déploiement: Docker & Docker Compose

---

**Arborescence importante**

- `backend/` — API serveur TypeScript (src/, Dockerfile, package.json)
- `frontend/` — application Vue 3 (Vite) (src/, Dockerfile, package.json)
- `example.docker-compose.yml` — exemple d'orchestration Caddy, frontend et backend (à copier en `docker-compose.yml`)
- `deploy/` — configuration Caddy

---

## Prérequis

- Node.js (v18+ recommandé) pour le développement local
- npm ou yarn
- Docker & Docker Compose (pour le déploiement en conteneurs)
- (Optionnel) Comptes développeur pour les providers: Spotify, Google (YouTube)

---

## Configuration des variables d'environnement

Créez un fichier `.env` à la racine (ou utilisez les variables d'environnement système). Exemple minimal :

```env
# backend
PORT=5000
FRONTEND_URL=http://localhost:5173
CORS_ORIGIN=http://localhost:5173
REDIRECT_URI=http://localhost:5000/auth/spotify/callback

# Spotify
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

# Google / YouTube (optionnel)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5000/auth/youtube/callback

# Last.fm (optionnel)
LASTFM_API_KEY=your_lastfm_api_key

# Admin : sans mot de passe, l'API /admin répond 503 (désactivée)
ADMIN_PASSWORD=un_long_mot_de_passe_aleatoire

# Jellyfin : les serveurs sur réseau privé (LAN, 127.0.0.1, Tailscale) sont refusés par défaut
# JELLYFIN_ALLOW_PRIVATE_NETWORK=true
```

- `CORS_ORIGIN` (par défaut `FRONTEND_URL`) est la seule origine acceptée par l'API et socket.io ; `localhost`/`127.0.0.1` ne sont ajoutés que hors production (`NODE_ENV` différent de `production`).
- `JELLYFIN_ALLOW_PRIVATE_NETWORK=true` autorise un Jellyfin auto-hébergé sur le réseau local ; à n'activer que si le serveur n'est pas exposé à des inconnus (le backend pourrait sinon être utilisé pour sonder votre réseau). Les adresses de métadonnées cloud (169.254.x.x) restent toujours bloquées.
- En production, mettez les URL publiques dans `.env` : `FRONTEND_URL`, `CORS_ORIGIN`, `REDIRECT_URI`, `GOOGLE_REDIRECT_URI`. `example.docker-compose.yml` lit ce fichier et ne contient aucun secret.
- Au retour de Spotify/YouTube, le jeton est transmis au navigateur dans le fragment de l'URL (`#token=…`), puis envoyé à l'API dans l'en-tête `Authorization` : il n'apparaît jamais dans les journaux d'accès.

---

## Lancer en développement (local)

1. Backend (à la racine `backend/`)

```bash
cd backend
npm install
npm run dev
```

Le backend démarre sur `http://localhost:5000` (ou selon `PORT`).

2. Frontend (à la racine `frontend/`)

```bash
cd frontend
npm install
npm run dev
```

Le frontend Vite démarre par défaut sur `http://localhost:5173`.

3. Jouer

Ouvrez le frontend (`http://localhost:5173`), connectez-vous via un provider (Spotify/YouTube) et créez/rejoignez une partie.

---

## Lancer avec Docker Compose (production / self-hosting)

Le dépôt contient un `example.docker-compose.yml` qui fournit un service Caddy en front, le service `web` (frontend, nginx sans root sur le port 8080) et `backend` (port 5000). Seul Caddy publie des ports ; `web` et `backend` ne sont joignables que sur le réseau Docker.

```bash
cp example.docker-compose.yml docker-compose.yml
docker compose up --build -d
```

**Admin** : Caddy refuse `/admin` côté public. Pour l'utiliser, publiez `web` sur une interface privée (ex. `ports: ["127.0.0.1:8080:8080"]`) et passez par un tunnel SSH (`ssh -L 8080:127.0.0.1:8080 serveur`), puis ouvrez `http://localhost:8080/admin` avec `ADMIN_PASSWORD`. nginx (via `X-Forwarded-For` de Caddy) et le backend jugent l'admin sur l'IP réelle du client : réseau local ou Tailscale seulement. Côté backend, `X-Forwarded-For` n'est lu que si `TRUST_PROXY` liste les relais de confiance (`uniquelocal` dans l'exemple compose, syntaxe [`trust proxy` d'Express](https://expressjs.com/en/guide/behind-proxies.html)) ; sans `TRUST_PROXY`, c'est l'IP de la connexion qui compte (à garder si le backend est joint directement).

Vérifiez les logs si nécessaire :

```bash
docker compose logs -f backend
```

---

## Construction pour production

- Backend :

```bash
cd backend
npm install
npm run build
npm run start
```

- Frontend :

```bash
cd frontend
npm install
npm run build
```

Les images Docker fournies dans `frontend/Dockerfile` et `backend/Dockerfile` utilisent ces builds.

---

## Contribuer

- Ouvrez une issue pour discuter d'une nouvelle fonctionnalité ou d'un bug.
- Faites une branch dédiée (`feature/ma-fonctionnalite`), ouvrez une Pull Request claire et liée à une issue.

Merci d'ajouter des tests pour tout changement significatif.

---

## Ressources et liens

- Dashboard Spotify Developers: https://developer.spotify.com/dashboard
- Google API Console (YouTube): https://console.cloud.google.com/apis

