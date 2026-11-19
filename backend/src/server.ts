import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import { randomBytes } from 'crypto';
import { Server, Socket } from 'socket.io';
import axios from 'axios';

import { Player } from './Player';
import { parseTrackPayload, Room } from './Room';
import { RoomManager } from './RoomManager';
import { safeEqual, sanitizeInput } from './utils';
import { JellyfinProvider } from './JellyfinProvider';
import { YouTubeProvider } from './YouTubeProvider';
import { LastFmProvider } from './lastFmProvider';
import { openDb } from './comptes/db';
import { initEncryptionKey, randomToken, setEncryptionKeyForTests } from './comptes/secrets';
import { ensureBootstrap } from './comptes/bootstrap';
import { authFromCookie, createAccountRouter, getGameDefaults } from './comptes/routes';
import { loadAccountTracks } from './comptes/sources';
import { recordGame } from './comptes/history';
import { sanitizeScoring, startBlocker } from './comptes/jeu';

const app = express();
// Aucune requête sortante sans délai : un fournisseur qui ne répond plus ne bloque pas le serveur.
axios.defaults.timeout = 10_000;
// TRUST_PROXY : relais dont on croit X-Forwarded-For (syntaxe `trust proxy` d'Express, ex.
// le sous-réseau Docker de Caddy→nginx, ou un nombre de sauts ; pas « uniquelocal », qui couvre le LAN). Absent : IP du socket.
const TRUST_PROXY = process.env.TRUST_PROXY?.trim();
if (TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);

/** IP du client d'une requête brute (socket.io), même règle que req.ip d'Express. */
function clientIp(req: http.IncomingMessage): string {
  const trust = app.get('trust proxy fn') as (addr: string, i: number) => boolean;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((a) => a.trim()).filter(Boolean);
  const chain = [req.socket.remoteAddress || '', ...forwarded.reverse()];
  let i = 0;
  while (i < chain.length - 1 && trust(chain[i], i)) i++;
  return chain[i];
}

// shortcut: compteurs en mémoire du processus, à remplacer par un store partagé si plusieurs instances.
function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs).unref();
  return (key: string): boolean => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    return ++entry.count <= limit;
  };
}

function httpRateLimit(limit: number, windowMs: number) {
  const allow = rateLimiter(limit, windowMs);
  return (req: Request, res: Response, next: NextFunction) => {
    if (allow(req.ip || '')) return next();
    res.status(429).json({ error: 'Trop de requêtes, réessayez dans une minute.' });
  };
}

// Comptes : base SQLite et clé des jetons dans DATA_DIR (« :memory: » pour les tests, rien sur disque).
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../data');
if (DATA_DIR === ':memory:') setEncryptionKeyForTests(randomToken());
else initEncryptionKey(DATA_DIR);
const db = openDb(DATA_DIR === ':memory:' ? ':memory:' : path.join(DATA_DIR, 'tuneguess.db'));
ensureBootstrap(db, { reset: process.env.ADMIN_BOOTSTRAP_RESET === '1' });

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const CORS_ORIGIN = process.env.CORS_ORIGIN || FRONTEND_URL;
const PORT = Number(process.env.PORT) || 5000;

// Seule l'origine du front est autorisée ; localhost en plus hors production (Vite en dev).
const corsOrigins: (string | RegExp)[] = [CORS_ORIGIN];
if (process.env.NODE_ENV !== 'production') corsOrigins.push(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/);

app.use(cors({ origin: corsOrigins }));
app.use(express.json());
// Limites par IP : une partie de 10 joueurs sur un même wifi partage une seule IP.
// Le proxy média (extraits et pochettes, requêtes Range) a sa propre limite, bien plus haute.
const apiLimit = httpRateLimit(600, 60_000);
app.use('/api/proxy', httpRateLimit(3000, 60_000));
app.use(['/api', '/auth'], (req, res, next) => (req.originalUrl.startsWith('/api/proxy/') ? next() : apiLimit(req, res, next)));

// Comptes (Google, passkeys, sources liées, historique, admin) : /api/... et /auth/compte/...
const { router: accountRouter, requireAdmin } = createAccountRouter(db);
app.use(accountRouter);

// --- SEO ENDPOINTS ---
app.get('/sitemap.xml', (req: Request, res: Response) => {
  res.header('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <!-- Page d'accueil -->
  <url>
    <loc>${FRONTEND_URL}/</loc>
    <lastmod>2026-06-05</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <!-- Mentions légales / Confidentialité -->
  <url>
    <loc>${FRONTEND_URL}/legal</loc>
    <lastmod>2026-06-05</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <!-- Crédits -->
  <url>
    <loc>${FRONTEND_URL}/credits</loc>
    <lastmod>2026-06-05</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>
</urlset>`);
});

app.get('/robots.txt', (req: Request, res: Response) => {
  res.header('Content-Type', 'text/plain');
  res.send(`User-agent: *
Allow: /

Sitemap: ${FRONTEND_URL}/sitemap.xml`);
});

const jellyfinProvider = new JellyfinProvider();
const youtubeProvider = new YouTubeProvider();
const lastFmProvider = new LastFmProvider();

// --- YOUTUBE (INVITÉ, SANS COMPTE) ---
// `state` aléatoire gardé dans un cookie HttpOnly (anti-CSRF de connexion) ; le jeton
// revient au front dans le fragment (#), jamais envoyé au serveur ni écrit dans les journaux.
for (const [name, provider] of [['youtube', youtubeProvider]] as const) {
  const stateCookie = `oauth_state_${name}`;

  app.get(`/auth/${name}/login`, (req: Request, res: Response) => {
    const state = randomBytes(16).toString('hex');
    res.cookie(stateCookie, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: FRONTEND_URL.startsWith('https:'),
      maxAge: 10 * 60 * 1000,
      path: '/auth',
    });
    res.redirect(provider.getAuthorizationUrl(state));
  });

  app.get(`/auth/${name}/callback`, async (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const expected = req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${stateCookie}=([^;]+)`))?.[1];
    res.clearCookie(stateCookie, { path: '/auth' });
    if (!expected || !safeEqual(state, expected)) {
      res.status(400).send("Requête d'authentification invalide");
      return;
    }
    if (!code) {
      res.status(400).send("Code manquant");
      return;
    }
    try {
      const access_token = await provider.getAccessToken(code);
      res.redirect(`${FRONTEND_URL}#provider=${name}&token=${encodeURIComponent(access_token)}`);
    } catch (error: any) {
      console.error(`Erreur Callback ${name}:`, error.message);
      res.status(500).send("Erreur d'authentification");
    }
  });
}

// --- JELLYFIN AUTHENTICATION ---
app.post('/auth/jellyfin/initiate', async (req: Request, res: Response) => {
  const { serverUrl } = req.body;
  if (!serverUrl) {
    res.status(400).json({ error: "serverUrl manquant" });
    return;
  }
  try {
    const data = await jellyfinProvider.initiateQuickConnect(serverUrl);
    res.json(data);
  } catch (error: any) {
    console.error("Erreur d'initialisation Jellyfin:", error.message);
    res.status(502).json({ error: "Serveur Jellyfin injoignable" });
  }
});

app.post('/auth/jellyfin/authenticate', async (req: Request, res: Response) => {
  const { serverUrl, secret } = req.body;
  if (!serverUrl || !secret) {
    res.status(400).json({ error: "Paramètres manquants" });
    return;
  }
  try {
    const data = await jellyfinProvider.pollQuickConnect(serverUrl, secret);
    res.json(data); // returns { token, userId, serverId } or null if not yet authenticated
  } catch (error: any) {
    console.error("Erreur d'authentification Jellyfin:", error.message);
    res.status(502).json({ error: "Serveur Jellyfin injoignable" });
  }
});

// --- UNIFIED TRACKS API ---
// Le corps de la réponse amont n'est jamais renvoyé : seul un code d'erreur sort.
function handleProviderError(res: Response, error: any, defaultMessage: string, provider: string) {
  const upstreamStatus = error.response?.status;
  const status = upstreamStatus === 401 || upstreamStatus === 403 ? upstreamStatus : 502;

  let code = 'API_ERROR';
  if (provider === 'youtube') {
    if (status === 401 || status === 403) {
      code = 'YOUTUBE_UNAUTHORIZED';
    }
  } else if (provider === 'jellyfin') {
    if (status === 401 || status === 403) {
      code = 'JELLYFIN_UNAUTHORIZED';
    } else if (['ENOTFOUND', 'ECONNREFUSED', 'ERR_BAD_RESPONSE', 'ECONNABORTED', 'EADDRBLOCKED'].includes(error.code)) {
      code = 'JELLYFIN_CONNECTION_ERROR';
    }
  }

  res.status(status).json({
    error: defaultMessage,
    code
  });
}

// Jeton du fournisseur (ou pseudo Last.fm) en en-tête : jamais dans l'URL ni les journaux d'accès.
function bearerToken(req: Request): string {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

app.get('/api/tracks/top', async (req: Request, res: Response) => {
  const token = bearerToken(req);
  const provider = req.query.provider as string;
  const serverUrl = req.query.serverUrl as string;
  const userId = req.query.userId as string;

  if (!token) {
    res.status(400).json({ error: "Token manquant" });
    return;
  }
  if (!['jellyfin', 'youtube', 'lastfm'].includes(provider)) {
    res.status(400).json({ error: "Fournisseur inconnu" });
    return;
  }

  try {
    let tracks;
    if (provider === 'jellyfin') {
      tracks = await jellyfinProvider.getUserTopTracks(token, { serverUrl, userId });
    } else if (provider === 'youtube') {
      tracks = await youtubeProvider.getUserTopTracks(token);
    } else {
      tracks = await lastFmProvider.getUserTopTracks(token);
    }
    res.json(tracks);
  } catch (error: any) {
    console.error("Erreur top tracks:", error.message);
    handleProviderError(res, error, "Impossible de récupérer les tops morceaux", provider);
  }
});

app.get('/api/tracks/recent', async (req: Request, res: Response) => {
  const token = bearerToken(req);
  const provider = req.query.provider as string;
  const serverUrl = req.query.serverUrl as string;
  const userId = req.query.userId as string;

  if (!token) {
    res.status(400).json({ error: "Token manquant" });
    return;
  }
  if (!['jellyfin', 'youtube', 'lastfm'].includes(provider)) {
    res.status(400).json({ error: "Fournisseur inconnu" });
    return;
  }

  try {
    let tracks;
    if (provider === 'jellyfin') {
      tracks = await jellyfinProvider.getUserRecentTracks(token, { serverUrl, userId });
    } else if (provider === 'youtube') {
      tracks = await youtubeProvider.getUserRecentTracks(token);
    } else {
      tracks = await lastFmProvider.getUserRecentTracks(token);
    }
    res.json(tracks);
  } catch (error: any) {
    console.error("Erreur morceaux récents:", error.message);
    handleProviderError(res, error, "Impossible de récupérer les morceaux récents", provider);
  }
});

// --- JELLYFIN PROXY ENDPOINTS (SECURITY & PRIVACY) ---
// Seul l'extrait de la manche en cours est servi, désigné par une clé opaque ; l'URL est reconstruite ici.
const MAX_PROXY_BYTES = 50 * 1024 * 1024;
const PROXY_TYPES = { stream: /^(audio\/|application\/octet-stream)/, image: /^image\/(?!svg)/ };

app.get('/api/proxy/jellyfin/:kind', async (req: Request, res: Response) => {
  const kind = req.params.kind as string;
  const { roomId, key } = req.query;
  const room = typeof roomId === 'string' ? roomManager.getRoomById(roomId) : null;
  const question = room?.status === 'playing' ? room.currentQuestion : null;
  const source = question ? room!.jellyfinSources[question.playerId] : undefined;
  if ((kind !== 'stream' && kind !== 'image') || !question?.mediaKey || question.mediaKey !== key || !source) {
    res.status(404).send("Média introuvable");
    return;
  }

  try {
    const range = kind === 'stream' && typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const upstream = await jellyfinProvider.fetchMedia(source.serverUrl, source.token, question.track.id, kind, range);
    if (!PROXY_TYPES[kind].test(String(upstream.headers['content-type'] || ''))) {
      upstream.data.destroy();
      res.status(502).send("Média invalide");
      return;
    }

    res.status(upstream.status);
    for (const header of ['content-type', 'content-range', 'accept-ranges', 'content-length']) {
      if (upstream.headers[header]) res.setHeader(header, upstream.headers[header] as string);
    }
    let bytes = 0;
    upstream.data.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_PROXY_BYTES) {
        upstream.data.destroy();
        res.destroy(); // réponse coupée nettement, jamais laissée pendante
      }
    });
    res.on('close', () => upstream.data.destroy());
    upstream.data.pipe(res);
  } catch (error: any) {
    console.error(`Erreur proxy ${kind} Jellyfin:`, error.message);
    res.status(502).send("Média indisponible");
  }
});

const server = http.createServer(app);
// Le websocket ignore CORS : l'Origin est vérifiée à la poignée de main. Sans Origin (client hors
// navigateur), pas de cookie de victime à réutiliser : accepté.
const originAllowed = (origin: string | undefined) =>
  !origin || corsOrigins.some((o) => (typeof o === 'string' ? o === origin : o.test(origin)));

const io = new Server(server, {
  allowRequest: (req, callback) => callback(null, originAllowed(req.headers.origin)),
  cors: { origin: corsOrigins }
});

const roomManager = new RoomManager();

function getRoomSummary(room: Room) {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    status: room.status,
    creatorId: room.creatorId,
    currentRound: room.currentRound,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      isHost: player.isHost,
    })),
    settings: room.settings,
  };
}

// Salons en cours : réservé aux administrateurs (passkey confirmée ou Tailscale validé).
app.use('/api/admin/salons', httpRateLimit(30, 60_000), requireAdmin);

app.get('/api/admin/salons', (req: Request, res: Response) => {
  const rooms = roomManager.getAllRooms().map(getRoomSummary);
  res.json(rooms);
});

app.get('/api/admin/salons/:roomId', (req: Request, res: Response) => {
  const roomId = req.params.roomId as string;
  const room = roomManager.getRoomById(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room introuvable' });
    return;
  }
  res.json(getRoomSummary(room));
});

app.patch('/api/admin/salons/:roomId/players/:playerId', (req: Request, res: Response) => {
  const roomId = req.params.roomId as string;
  const playerId = req.params.playerId as string;
  const room = roomManager.getRoomById(roomId);
  const { name } = req.body as { name?: string };
  if (!room) {
    res.status(404).json({ error: 'Room introuvable' });
    return;
  }
  if (!sanitizeInput(name)) {
    res.status(400).json({ error: 'Nom invalide' });
    return;
  }
  const player = room.players.find((p) => p.id === playerId);
  if (!player) {
    res.status(404).json({ error: 'Joueur introuvable' });
    return;
  }
  player.name = sanitizeInput(name);
  emitRoomPlayers(room);
  res.json(getRoomSummary(room));
});

app.post('/api/admin/salons/:roomId/players/:playerId/kick', (req: Request, res: Response) => {
  const roomId = req.params.roomId as string;
  const playerId = req.params.playerId as string;
  const room = roomManager.getRoomById(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room introuvable' });
    return;
  }
  const player = room.players.find((p) => p.id === playerId);
  if (!player) {
    res.status(404).json({ error: 'Joueur introuvable' });
    return;
  }

  room.removePlayer(playerId);
  const socketToKick = io.sockets.sockets.get(playerId);
  if (socketToKick) {
    socketToKick.leave(room.id);
    socketToKick.data.roomId = null;
    socketToKick.emit('kicked');
  }

  if (room.players.length === 0) {
    roomManager.deleteRoom(room.id);
  } else {
    emitRoomPlayers(room);
    if (room.status === 'waiting') {
      io.to(room.id).emit('room_settings', room.settings);
    }
    if (room.status === 'playing') {
      emitRoundState(room);
    }
  }

  broadcastActiveRooms();
  res.json({ success: true });
});

app.delete('/api/admin/salons/:roomId', (req: Request, res: Response) => {
  const roomId = req.params.roomId as string;
  const room = roomManager.getRoomById(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room introuvable' });
    return;
  }

  room.resetForRound();
  room.players.forEach((player) => {
    const socket = io.sockets.sockets.get(player.id);
    if (socket) {
      socket.leave(room.id);
      socket.data.roomId = null;
      socket.emit('room_closed');
    }
  });

  roomManager.deleteRoom(room.id);
  broadcastActiveRooms();
  res.json({ success: true });
});

function broadcastActiveRooms() {
  io.emit('active_rooms', roomManager.getPublicRoomList());
}

function getSocketRoom(socket: Socket) {
  return roomManager.getRoomById(socket.data.roomId);
}

// Un socket n'occupe qu'un salon : il quitte l'ancien avant d'en créer ou d'en rejoindre un autre.
function leaveCurrentRoom(socket: Socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  socket.data.roomId = null;
  socket.leave(roomId);

  const room = roomManager.getRoomById(roomId);
  if (!room) return;
  room.removePlayer(socket.id);
  if (!roomManager.deleteRoomIfEmpty(roomId)) {
    emitRoomPlayers(room);
    if (room.status === 'waiting') io.to(roomId).emit('room_settings', room.settings);
    if (room.status === 'playing') emitRoundState(room);
  }
  broadcastActiveRooms();
}

// Événements qui créent un salon, stockent des données ou appellent Deezer.
const COSTLY_EVENTS = new Set(['create_room', 'join_room', 'store_tracks', 'store_account_tracks', 'start_game', 'next_round']);
const allowSocketEvent = rateLimiter(30, 60_000);
// Par IP : un client qui ouvre des dizaines de sockets ne multiplie pas ses salons.
// 20 connexions laissent un salon complet (10 joueurs) derrière une même box, onglets en plus.
const MAX_CONNECTIONS_PER_IP = 20;
const connectionsPerIp = new Map<string, number>();
const allowCreateRoom = rateLimiter(10, 60_000);

function emitRoomPlayers(room: Room) {
  io.to(room.id).emit('update_players', room.publicPlayers());
}

function emitRoundState(room: Room) {
  io.to(room.id).emit('round_state', room.getRoundState(Date.now()));
}

function startRoundTimer(room: Room) {
  const now = Date.now();
  const durationMs = Math.max(10, Math.min(120, Math.floor(room.settings.roundDuration))) * 1000;
  room.roundStartedAtMs = now;
  room.roundEndsAtMs = now + durationMs;

  if (room.roundTimeout) {
    clearTimeout(room.roundTimeout);
    room.roundTimeout = null;
  }

  room.roundTimeout = setTimeout(() => {
    emitRoundState(room);
  }, durationMs);
}

function endGame(room: Room) {
  io.to(room.id).emit('game_over', {
    players: room.publicPlayers().sort((a, b) => b.score - a.score),
  });
  try {
    recordGame(db, {
      roomCode: room.code,
      roomName: room.name,
      startedAt: room.startedAt,
      endedAt: Date.now(),
      players: room.players.map((p) => ({ key: p.id, userId: p.userId, name: p.name, score: p.score })),
      rounds: room.rounds,
    });
  } catch (err: any) {
    console.error('Historique non enregistré:', err?.message);
  }
  room.status = 'waiting';
  room.currentQuestion = null;
  room.resetForRound();
  startInactivityTimer(room);
  broadcastActiveRooms();
}

// Verrou : la recherche Deezer est asynchrone, deux start_game/next_round simultanés
// lanceraient sinon deux manches et compteraient deux tours.
async function selectNextQuestionLocked(room: Room) {
  room.advancing = true;
  try {
    return await room.selectNextQuestion();
  } finally {
    room.advancing = false;
  }
}

function startQuestion(room: Room, result: NonNullable<Awaited<ReturnType<Room['selectNextQuestion']>>>) {
  room.currentQuestion = result.selected;
  startRoundTimer(room);
  io.to(room.id).emit('new_question', result.questionData);
  io.to(result.selected.playerId).emit('own_track');
  emitRoundState(room);
}

// Délai avant fermeture automatique d'une room inactive
const INACTIVITY_WAITING_MS = 30 * 60 * 1000;  // 30 min en salle d'attente
const INACTIVITY_PLAYING_MS = 2 * 60 * 60 * 1000; // 2h en cours de partie

function startInactivityTimer(room: Room) {
  room.clearInactivityTimer();

  const delayMs = room.status === 'playing' ? INACTIVITY_PLAYING_MS : INACTIVITY_WAITING_MS;

  room.inactivityTimeout = setTimeout(() => {
    console.log(`Room ${room.code} fermée pour inactivité (statut: ${room.status})`);
    room.clearInactivityTimer();
    room.players.forEach((player) => {
      const socket = io.sockets.sockets.get(player.id);
      if (socket) {
        socket.leave(room.id);
        socket.data.roomId = null;
        socket.emit('room_closed');
      }
    });
    roomManager.deleteRoom(room.id);
    broadcastActiveRooms();
  }, delayMs);
}

io.use((socket, next) => {
  const ip = clientIp(socket.request);
  const count = connectionsPerIp.get(ip) || 0;
  if (count >= MAX_CONNECTIONS_PER_IP) {
    next(new Error('Trop de connexions depuis cette adresse.'));
    return;
  }
  connectionsPerIp.set(ip, count + 1);
  socket.data.ip = ip;
  // Compte connecté (cookie de session, même origine) : seulement s'il a choisi son @identifiant.
  const user = authFromCookie(db, socket.request.headers.cookie)?.user;
  socket.data.userId = user?.username ? user.id : null;
  socket.data.username = user?.username ?? null;
  socket.on('disconnect', () => {
    const left = (connectionsPerIp.get(ip) || 1) - 1;
    if (left > 0) connectionsPerIp.set(ip, left);
    else connectionsPerIp.delete(ip);
  });
  next();
});

io.on('connection', (socket: Socket) => {
  console.log('Connexion socket:', socket.id);

  socket.use(([event], next) => {
    if (COSTLY_EVENTS.has(event) && !allowSocketEvent(socket.id)) {
      socket.emit('room_error', { message: 'Trop de requêtes, réessayez dans une minute.' });
      return;
    }
    next();
  });

  socket.on('list_active_rooms', () => {
    socket.emit('active_rooms', roomManager.getPublicRoomList());
  });

  socket.on('create_room', ({ roomName, playerName }: { roomName: unknown; playerName: unknown }) => {
    const safePlayerName = sanitizeInput(playerName);
    const safeRoomName = sanitizeInput(roomName) || 'Partie sans nom';

    if (!safePlayerName) {
      socket.emit('room_error', { message: 'Pseudo invalide.' });
      return;
    }

    if (!allowCreateRoom(socket.data.ip)) {
      socket.emit('room_error', { message: 'Trop de salons créés depuis cette adresse, réessayez dans une minute.' });
      return;
    }
    let room: Room;
    try {
      room = roomManager.createRoom(safeRoomName, socket.id, safePlayerName);
      room.settings = { ...getGameDefaults(db) };
      room.players[0].userId = socket.data.userId;
      room.players[0].username = socket.data.username;
    } catch (err: any) {
      socket.emit('room_error', { message: err.message });
      return;
    }
    leaveCurrentRoom(socket);
    socket.data.roomId = room.id;
    socket.join(room.id);
    startInactivityTimer(room);

    socket.emit('room_joined', {
      roomId: room.id,
      code: room.code,
      name: room.name,
      settings: room.settings,
      isHost: true,
    });
    emitRoomPlayers(room);
    broadcastActiveRooms();
  });

  socket.on('join_room', ({ roomCode, playerName }: { roomCode: unknown; playerName: unknown }) => {
    const safePlayerName = sanitizeInput(playerName);
    if (!safePlayerName) {
      socket.emit('room_error', { message: 'Pseudo invalide.' });
      return;
    }

    const room = roomManager.findRoomByCode(roomCode);
    if (!room) {
      socket.emit('room_error', { message: 'Salon introuvable.' });
      return;
    }
    if (room.status !== 'waiting') {
      socket.emit('room_error', { message: 'La partie est déjà en cours.' });
      return;
    }

    try {
      const newPlayer = new Player(socket.id, safePlayerName, 0, false, socket.data.userId, socket.data.username);
      room.addPlayer(newPlayer); // refuse aussi le salon où l'on est déjà
      leaveCurrentRoom(socket);

      socket.data.roomId = room.id;
      socket.join(room.id);

      socket.emit('room_joined', {
        roomId: room.id,
        code: room.code,
        name: room.name,
        settings: room.settings,
        isHost: false,
      });
      io.to(room.id).emit('room_settings', room.settings);
      emitRoomPlayers(room);
      startInactivityTimer(room);
      broadcastActiveRooms();
    } catch (err: any) {
      socket.emit('room_error', { message: err.message });
    }
  });

  socket.on('update_settings', (settings: any) => {
    const room = getSocketRoom(socket);
    if (!room || room.creatorId !== socket.id || room.status !== 'waiting') return;

    if (settings && typeof settings === 'object') {
      Object.assign(room.settings, sanitizeScoring(settings, room.settings));
      if (typeof settings.maxRounds === 'number') {
        room.settings.maxRounds = Math.min(50, Math.max(1, Math.floor(settings.maxRounds)));
      }
      if (typeof settings.roundDuration === 'number') {
        room.settings.roundDuration = Math.min(120, Math.max(10, Math.floor(settings.roundDuration)));
      }
    }

    io.to(room.id).emit('room_settings', room.settings);
  });

  socket.on('store_tracks', (payload: unknown) => {
    const room = getSocketRoom(socket);
    if (!room) return;
    const parsed = parseTrackPayload(payload);
    if (!parsed) {
      socket.emit('room_error', { message: 'Liste de morceaux invalide.' });
      return;
    }
    room.storeTracks(socket.id, parsed.tracks, parsed.jellyfin);
    emitRoomPlayers(room);
  });

  // Pistes des sources liées au compte, lues côté serveur (aucun jeton ne passe par le navigateur).
  socket.on('store_account_tracks', async () => {
    const room = getSocketRoom(socket);
    if (!room) return;
    // Session relue : une déconnexion depuis un autre onglet compte tout de suite.
    const user = authFromCookie(db, socket.request.headers.cookie)?.user;
    if (!user?.username || user.id !== socket.data.userId) {
      socket.emit('account_tracks', { ok: false, count: 0, errors: [], error: 'Connectez-vous pour utiliser les sources de votre compte.' });
      return;
    }
    try {
      const { tracks, jellyfin, errors } = await loadAccountTracks(db, user.id);
      if (getSocketRoom(socket) !== room) return;
      if (tracks.length > 0) room.storeTracks(socket.id, tracks, jellyfin);
      socket.emit('account_tracks', { ok: tracks.length > 0, count: tracks.length, errors });
      emitRoomPlayers(room);
    } catch (err: any) {
      console.error('Sources du compte:', err?.message);
      socket.emit('account_tracks', { ok: false, count: 0, errors: [], error: 'Sources du compte indisponibles.' });
    }
  });

  socket.on('start_game', async () => {
    const room = getSocketRoom(socket);
    if (!room) return;
    if (room.creatorId !== socket.id) return;
    if (room.status === 'playing' || room.advancing) return;
    const blocker = startBlocker(room.readyCount());
    if (blocker) {
      socket.emit('room_error', { message: blocker });
      return;
    }

    room.startGame(Date.now());
    room.clearInactivityTimer();
    emitRoomPlayers(room);
    broadcastActiveRooms();

    const result = await selectNextQuestionLocked(room);
    // Le salon a pu être fermé ou remis en attente pendant la recherche Deezer.
    if ((room.status as Room['status']) !== 'playing') return;
    if (!result) {
      room.status = 'waiting';
      startInactivityTimer(room);
      broadcastActiveRooms();
      io.to(room.id).emit('no_tracks');
      return;
    }
    startQuestion(room, result);
  });

  socket.on('next_round', async () => {
    const room = getSocketRoom(socket);
    if (!room || room.status !== 'playing' || room.advancing) return;
    if (room.creatorId !== socket.id) return;

    const roundState = room.getRoundState(Date.now());
    if (!roundState.canProceed) {
      socket.emit('room_error', { message: "Impossible de passer à la suite : tous les joueurs n'ont pas répondu et le temps n'est pas écoulé." });
      return;
    }

    if (room.currentRound >= room.settings.maxRounds) {
      endGame(room);
      return;
    }

    room.resetForRound();
    const result = await selectNextQuestionLocked(room);
    if (room.status !== 'playing') return;
    // Plus aucun morceau inédit : la partie se termine au lieu de rester bloquée.
    if (!result) {
      endGame(room);
      return;
    }
    startQuestion(room, result);
  });

  socket.on('answer', ({ playerId }: { playerId: unknown }) => {
    const room = getSocketRoom(socket);
    if (!room || !room.currentQuestion || room.answeredPlayers.has(socket.id)) return;

    try {
      const res = room.submitAnswer(socket.id, playerId as string, Date.now());
      socket.emit('answer_result', res);
      emitRoomPlayers(room);
      emitRoundState(room);

      const state = room.getRoundState(Date.now());
      if (state.allAnswered && room.roundTimeout) {
        clearTimeout(room.roundTimeout);
        room.roundTimeout = null;
        emitRoundState(room);
      }
    } catch (err) {
      // Ignorer
    }
  });

  socket.on('leave_room', () => {
    if (!socket.data.roomId) return;
    leaveCurrentRoom(socket);
    socket.emit('left_room');
  });

  socket.on('disconnect', () => leaveCurrentRoom(socket));
});

// Les tests importent le module et écoutent eux-mêmes sur un port libre.
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Serveur TuneGuess sur http://127.0.0.1:${PORT}`);
  });
}

export { app, server, io, roomManager, db };
