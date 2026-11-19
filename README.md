# 🎵 TuneGuess

`TuneGuess` est un jeu musical auto-hébergé où les joueurs devinent des titres à partir de leurs sources musicales (Last.fm, YouTube, Jellyfin).

Ce dépôt contient un backend TypeScript (API + WebSocket) et un frontend Vue 3 (Vite). Le projet peut être lancé en local pour le développement ou déployé facilement avec Docker Compose.

**Résumé rapide**
- Backend: Node.js + TypeScript
- Frontend: Vue 3 + Vite
- Comptes : Google + passkeys (aucun mot de passe), `@identifiant` obligatoire
- Sources musicales : Last.fm (principale), Jellyfin (QuickConnect), YouTube (optionnel)
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
- Un client OAuth Google (connexion, YouTube) et une clé d'API Last.fm

---

## Configuration des variables d'environnement

Créez un fichier `.env` à la racine (ou utilisez les variables d'environnement système). Exemple minimal :

```env
# backend
PORT=5000
FRONTEND_URL=http://localhost:5173
CORS_ORIGIN=http://localhost:5173

# Comptes : base SQLite + clé des jetons (dossier à sauvegarder)
DATA_DIR=./data
# Obligatoire en production, 32 caractères minimum (openssl rand -hex 32)
TOKEN_ENCRYPTION_KEY=

# Google : connexion aux comptes, et YouTube (consentement à part, désactivable)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
# YOUTUBE_ENABLED=false

# Last.fm : la clé suffit pour lier un pseudo, le secret active la connexion Last.fm
LASTFM_API_KEY=your_lastfm_api_key
LASTFM_API_SECRET=your_lastfm_api_secret

# Jellyfin (QuickConnect) : les serveurs sur réseau privé (LAN, 127.0.0.1, Tailscale) sont refusés par défaut
# JELLYFIN_ENABLED=false
# JELLYFIN_ALLOW_PRIVATE_NETWORK=true

# Recrée un code d'amorçage admin au démarrage (accès admin perdu)
# ADMIN_BOOTSTRAP_RESET=1
```

- `CORS_ORIGIN` (par défaut `FRONTEND_URL`) est la seule origine acceptée par l'API et socket.io ; `localhost`/`127.0.0.1` ne sont ajoutés que hors production (`NODE_ENV` différent de `production`).
- `JELLYFIN_ALLOW_PRIVATE_NETWORK=true` autorise un Jellyfin auto-hébergé sur le réseau local ; à n'activer que si le serveur n'est pas exposé à des inconnus (le backend pourrait sinon être utilisé pour sonder votre réseau). Les adresses de métadonnées cloud (169.254.x.x) restent toujours bloquées.
- En production, mettez les URL publiques dans `.env` : `FRONTEND_URL`, `CORS_ORIGIN`. `example.docker-compose.yml` lit ce fichier et ne contient aucun secret.
- Google, Last.fm, YouTube et Jellyfin se règlent aussi dans l'admin (onglet Configuration) : la valeur en base prime sur l'environnement, les secrets y sont chiffrés avec `TOKEN_ENCRYPTION_KEY`.
- Adresses de retour à déclarer chez Google et Last.fm (`FRONTEND_URL` en tête) : `/auth/compte/google/callback`, `/auth/compte/youtube/callback`, `/auth/compte/lastfm/callback`. L'admin les affiche.
- YouTube : tant que l'application Google n'est pas validée par Google, seuls 100 utilisateurs de test déclarés dans la console peuvent lier YouTube. Last.fm reste la source principale.
- Si le front est construit avec `VITE_API_BASE` (API sur une autre origine que le site), ajoutez cette origine (`https://…` et `wss://…`) à `connect-src` dans la CSP de `frontend/nginx.conf`, sinon le navigateur bloque les appels à l'API.
- Joueur sans compte : au retour de YouTube, le jeton est transmis au navigateur dans le fragment de l'URL (`#token=…`), puis envoyé à l'API dans l'en-tête `Authorization` : il n'apparaît jamais dans les journaux d'accès.

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

Ouvrez le frontend (`http://localhost:5173`), créez/rejoignez une partie, puis ajoutez une source (Last.fm, YouTube, Jellyfin, ou celles de votre compte). Il faut 2 joueurs prêts (avec des morceaux) pour lancer. Les joueurs connectés retrouvent leurs parties dans Mon compte → Historique.

**Premier administrateur** : au premier démarrage, le backend écrit dans ses journaux un code d'amorçage. Ouvrez `/admin/amorcage`, saisissez-le et enregistrez une passkey : ce compte devient administrateur. L'admin (`/admin`) exige ensuite une passkey confirmée ; l'API des salons en cours est sous `/api/admin/salons`.

---

## Lancer avec Docker Compose (production / self-hosting)

Le dépôt contient un `example.docker-compose.yml` qui fournit un service Caddy en front, le service `web` (frontend, nginx sans root sur le port 8080) et `backend` (port 5000). Seul Caddy publie des ports ; `web` et `backend` ne sont joignables que sur le réseau Docker.

```bash
cp example.docker-compose.yml docker-compose.yml
docker compose up --build -d
```

**Données** : comptes, sources liées et historique sont dans le volume `tuneguess_data` (`DATA_DIR=/data`) : à sauvegarder. Le code d'amorçage admin s'affiche dans `docker compose logs backend`.

**Admin** : `/admin` est servi publiquement, mais toute l'API d'administration exige un compte administrateur avec une passkey confirmée (ou une connexion depuis une adresse Tailscale déjà validée). Côté backend, `X-Forwarded-For` n'est lu que si `TRUST_PROXY` liste les relais de confiance (le sous-réseau Docker fixé dans l'exemple compose, jamais `uniquelocal` qui inclut le réseau local et Tailscale ; syntaxe [`trust proxy` d'Express](https://expressjs.com/en/guide/behind-proxies.html)) ; sans `TRUST_PROXY`, c'est l'IP de la connexion qui compte (à garder si le backend est joint directement).

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

## Intégration continue (CI/CD)

`.github/workflows/ci-qualite.yml` tourne sur chaque PR vers `main`. Ses catégories sont des jobs parallèles :

| Catégorie | Ce qui est vérifié | En local |
|---|---|---|
| Lint | ESLint : `typescript-eslint` (backend), `eslint-plugin-vue` essential (frontend), zéro erreur | `npm run lint` (dans `backend/` et `frontend/`) |
| Types | `tsc --noEmit` du backend (le frontend est en JavaScript) | `cd backend && npm run typecheck` |
| Tests et couverture | `node:test` avec couverture native ; échec sous 68 % lignes, 80 % branches, 75 % fonctions ; `lcov.info` en artefact | `cd backend && npm run test:coverage` |
| Build | `npm run build` backend et frontend (`dist` en artefact, non publié) | `npm run build` |
| Dépendances | `npm audit --omit=dev --audit-level=high` (back et front) ; `dependency-review-action` sur les PR | `npm audit --omit=dev --audit-level=high` |
| Analyse de code | CodeQL `javascript-typescript` | (GitHub seulement) |
| Secrets | gitleaks sur tout l'historique git | `gitleaks git . --redact` |
| Conteneurs | hadolint sur les deux Dockerfiles, puis image construite (non poussée) et scannée par Trivy (HIGH/CRITICAL corrigeables) | `hadolint backend/Dockerfile frontend/Dockerfile` ; `docker build -t tg-backend backend && trivy image --severity HIGH,CRITICAL --ignore-unfixed tg-backend` |
| Workflows | actionlint et zizmor sur `.github/workflows` | `actionlint` ; `uvx zizmor .` |
| Test de fumée | backend construit démarré avec des variables factices : `/robots.txt` 200, `/admin` refusé sans mot de passe (401), création d'un salon par socket.io | `cd backend && npm run build && npm run smoke` |

**Publication** : `.github/workflows/publish-docker.yml` (push sur `main`, tags `v*`, lancement manuel) appelle d'abord `ci-qualite.yml` en entier, puis pousse les images `ghcr.io/<propriétaire>/tuneguess-backend` et `tuneguess-frontend` (amd64 + arm64) seulement si toutes les catégories sont vertes. Rien n'est jamais poussé depuis une PR.

Les actions sont épinglées par SHA de commit (tag en commentaire) ; Dependabot (`.github/dependabot.yml`) propose chaque semaine des mises à jour groupées npm, Docker et GitHub Actions.

---

## Contribuer

- Ouvrez une issue pour discuter d'une nouvelle fonctionnalité ou d'un bug.
- Faites une branch dédiée (`feature/ma-fonctionnalite`), ouvrez une Pull Request claire et liée à une issue.

Merci d'ajouter des tests pour tout changement significatif.

---

## Ressources et liens

- Last.fm API : https://www.last.fm/api/account/create
- Google API Console (YouTube): https://console.cloud.google.com/apis

