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
- `docker-compose.yml` — orchestration pour Caddy, frontend et backend
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

# (Jellyfin / Last.fm n'ont pas forcément besoin de variables globales)
```

Remarque: le `docker-compose.yml` fourni définit déjà des variables `FRONTEND_URL`, `CORS_ORIGIN`, `REDIRECT_URI` pour l'environnement de production (ajustez-les si nécessaire).

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

Le dépôt contient un `docker-compose.yml` qui fournit un service Caddy en front, le service `web` (frontend) et `backend`.

```bash
docker compose up --build -d
```

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

