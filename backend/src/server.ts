import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import axios from 'axios';
import { Server, Socket } from 'socket.io';

import { Player } from './Player';
import { Room } from './Room';
import { RoomManager } from './RoomManager';
import { sanitizeInput } from './utils';
import { SpotifyProvider } from './SpotifyProvider';
import { JellyfinProvider } from './JellyfinProvider';

const app = express();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const CORS_ORIGIN = process.env.CORS_ORIGIN || FRONTEND_URL;
const PORT = Number(process.env.PORT) || 5000;

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const spotifyProvider = new SpotifyProvider();
const jellyfinProvider = new JellyfinProvider();

// --- SPOTIFY AUTHENTICATION ---
app.get('/auth/spotify/login', (req: Request, res: Response) => {
  res.redirect(spotifyProvider.getAuthorizationUrl());
});

app.get('/auth/spotify/callback', async (req: Request, res: Response) => {
  const code = (req.query.code as string) || null;
  if (!code) {
    res.status(400).send("Code manquant");
    return;
  }
  try {
    const access_token = await spotifyProvider.getAccessToken(code);
    res.redirect(`${FRONTEND_URL}?provider=spotify&token=${access_token}`);
  } catch (error: any) {
    console.error("Erreur Callback Spotify:", error.message);
    res.status(500).send("Erreur d'authentification");
  }
});

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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

// --- UNIFIED TRACKS API ---
function handleProviderError(res: Response, error: any, defaultMessage: string, provider: string) {
  const status = error.response?.status || 500;
  let details = error.message || "Erreur inconnue";
  
  if (error.response?.data) {
    if (provider === 'spotify') {
      details = error.response.data.error?.message || JSON.stringify(error.response.data);
    } else if (provider === 'jellyfin') {
      details = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
    }
  }

  let code = 'API_ERROR';
  if (provider === 'spotify') {
    if (status === 403) {
      code = 'SPOTIFY_WHITELIST_ERROR';
    } else if (status === 401) {
      code = 'SPOTIFY_UNAUTHORIZED';
    }
  } else if (provider === 'jellyfin') {
    if (status === 401 || status === 403) {
      code = 'JELLYFIN_UNAUTHORIZED';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ERR_BAD_RESPONSE') {
      code = 'JELLYFIN_CONNECTION_ERROR';
    }
  }

  res.status(status).json({
    error: defaultMessage,
    details,
    code
  });
}

// --- UNIFIED TRACKS API ---
app.get('/api/tracks/top', async (req: Request, res: Response) => {
  const token = req.query.token as string;
  const provider = (req.query.provider as string) || 'spotify';
  const serverUrl = req.query.serverUrl as string;
  const userId = req.query.userId as string;

  if (!token) {
    res.status(400).json({ error: "Token manquant" });
    return;
  }

  try {
    let tracks;
    if (provider === 'jellyfin') {
      tracks = await jellyfinProvider.getUserTopTracks(token, { serverUrl, userId });
    } else {
      tracks = await spotifyProvider.getUserTopTracks(token);
    }
    res.json(tracks);
  } catch (error: any) {
    console.error("Erreur top tracks:", error.message);
    handleProviderError(res, error, "Impossible de récupérer les tops morceaux", provider);
  }
});

app.get('/api/tracks/recent', async (req: Request, res: Response) => {
  const token = req.query.token as string;
  const provider = (req.query.provider as string) || 'spotify';
  const serverUrl = req.query.serverUrl as string;
  const userId = req.query.userId as string;

  if (!token) {
    res.status(400).json({ error: "Token manquant" });
    return;
  }

  try {
    let tracks;
    if (provider === 'jellyfin') {
      tracks = await jellyfinProvider.getUserRecentTracks(token, { serverUrl, userId });
    } else {
      tracks = await spotifyProvider.getUserRecentTracks(token);
    }
    res.json(tracks);
  } catch (error: any) {
    console.error("Erreur morceaux récents:", error.message);
    handleProviderError(res, error, "Impossible de récupérer les morceaux récents", provider);
  }
});

// --- JELLYFIN PROXY ENDPOINTS (SECURITY & PRIVACY) ---
app.get('/api/proxy/jellyfin/stream', async (req: Request, res: Response) => {
  const { roomId, playerId, trackId } = req.query as { roomId: string; playerId: string; trackId: string };
  if (!roomId || !playerId || !trackId) {
    res.status(400).send("Paramètres manquants");
    return;
  }

  const room = roomManager.getRoomById(roomId);
  if (!room) {
    res.status(404).send("Salon introuvable");
    return;
  }

  const tracks = room.playerTracks[playerId];
  if (!tracks) {
    res.status(404).send("Joueur introuvable ou pas de morceaux");
    return;
  }

  const track = tracks.find((t) => t.id === trackId);
  if (!track || !track.previewUrl) {
    res.status(404).send("Morceau ou extrait introuvable");
    return;
  }

  try {
    const response = await axios({
      method: 'get',
      url: track.previewUrl,
      responseType: 'stream',
      headers: {
        Range: req.headers.range || ''
      },
      validateStatus: () => true
    });

    res.status(response.status);
    if (response.headers['content-type']) {
      res.setHeader('content-type', response.headers['content-type'] as any);
    }
    if (response.headers['content-range']) {
      res.setHeader('content-range', response.headers['content-range'] as any);
    }
    if (response.headers['accept-ranges']) {
      res.setHeader('accept-ranges', response.headers['accept-ranges'] as any);
    }
    if (response.headers['content-length']) {
      res.setHeader('content-length', response.headers['content-length'] as any);
    }

    response.data.pipe(res);
  } catch (error: any) {
    console.error("Erreur proxy stream Jellyfin:", error.message);
    res.status(500).send("Erreur lors de la lecture du flux audio");
  }
});

app.get('/api/proxy/jellyfin/image', async (req: Request, res: Response) => {
  const { roomId, playerId, trackId } = req.query as { roomId: string; playerId: string; trackId: string };
  if (!roomId || !playerId || !trackId) {
    res.status(400).send("Paramètres manquants");
    return;
  }

  const room = roomManager.getRoomById(roomId);
  if (!room) {
    res.status(404).send("Salon introuvable");
    return;
  }

  const tracks = room.playerTracks[playerId];
  if (!tracks) {
    res.status(404).send("Joueur introuvable ou pas de morceaux");
    return;
  }

  const track = tracks.find((t) => t.id === trackId);
  if (!track || !track.imageUrl) {
    res.status(404).send("Morceau ou image introuvable");
    return;
  }

  try {
    const response = await axios({
      method: 'get',
      url: track.imageUrl,
      responseType: 'stream',
      validateStatus: () => true
    });

    res.status(response.status);
    if (response.headers['content-type']) {
      res.setHeader('content-type', response.headers['content-type'] as any);
    }
    if (response.headers['content-length']) {
      res.setHeader('content-length', response.headers['content-length'] as any);
    }

    response.data.pipe(res);
  } catch (error: any) {
    console.error("Erreur proxy image Jellyfin:", error.message);
    res.status(500).send("Erreur de chargement de l'image");
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN }
});

const roomManager = new RoomManager();

function broadcastActiveRooms() {
  io.emit('active_rooms', roomManager.getPublicRoomList());
}

function getSocketRoom(socket: Socket) {
  return roomManager.getRoomById(socket.data.roomId);
}

function emitRoomPlayers(room: Room) {
  io.to(room.id).emit('update_players', room.players);
}

io.on('connection', (socket: Socket) => {
  console.log('Connexion socket:', socket.id);

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

    const room = roomManager.createRoom(safeRoomName, socket.id, safePlayerName);
    socket.data.roomId = room.id;
    socket.join(room.id);

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
      const newPlayer = new Player(socket.id, safePlayerName, 0, false);
      room.addPlayer(newPlayer);

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
      broadcastActiveRooms();
    } catch (err: any) {
      socket.emit('room_error', { message: err.message });
    }
  });

  socket.on('update_settings', (settings: any) => {
    const room = getSocketRoom(socket);
    if (!room || room.creatorId !== socket.id) return;

    if (settings && typeof settings === 'object') {
      if (typeof settings.maxRounds === 'number') {
        room.settings.maxRounds = Math.min(50, Math.max(1, Math.floor(settings.maxRounds)));
      }
      if (typeof settings.roundDuration === 'number') {
        room.settings.roundDuration = Math.min(120, Math.max(10, Math.floor(settings.roundDuration)));
      }
    }

    io.to(room.id).emit('room_settings', room.settings);
  });

  socket.on('store_tracks', (tracks: unknown) => {
    const room = getSocketRoom(socket);
    if (!room || !Array.isArray(tracks)) return;
    room.storeTracks(socket.id, tracks);
  });

  socket.on('start_game', async () => {
    const room = getSocketRoom(socket);
    if (!room) return;
    if (room.creatorId !== socket.id) return;
    if (room.players.length < 2) return;
    if (room.status === 'playing') return;

    room.status = 'playing';
    room.resetForRound();
    room.currentRound = 0;
    room.playedTrackIds = new Set<string>();
    broadcastActiveRooms();

    const result = await room.selectNextQuestion();
    if (!result) {
      room.status = 'waiting';
      broadcastActiveRooms();
      io.to(room.id).emit('no_tracks');
      return;
    }

    room.currentQuestion = result.selected;
    io.to(room.id).emit('new_question', result.questionData);
  });

  socket.on('next_round', async () => {
    const room = getSocketRoom(socket);
    if (!room || room.status !== 'playing') return;
    if (room.creatorId !== socket.id) return;

    if (room.currentRound >= room.settings.maxRounds) {
      io.to(room.id).emit('game_over', {
        players: [...room.players].sort((a, b) => b.score - a.score),
      });
      room.status = 'waiting';
      room.currentQuestion = null;
      broadcastActiveRooms();
      return;
    }

    room.resetForRound();
    const result = await room.selectNextQuestion();

    if (!result) {
      io.to(room.id).emit('no_tracks');
      return;
    }

    room.currentQuestion = result.selected;
    io.to(room.id).emit('new_question', result.questionData);
  });

  socket.on('answer', ({ playerId, points }: { playerId: unknown; points: unknown }) => {
    const room = getSocketRoom(socket);
    if (!room || !room.currentQuestion || room.answeredPlayers.has(socket.id)) return;

    try {
      const res = room.submitAnswer(socket.id, playerId as string, Number(points) || 0);
      socket.emit('answer_result', res);
      emitRoomPlayers(room);
    } catch (err) {
      // Ignorer
    }
  });

  socket.on('leave_room', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = roomManager.getRoomById(roomId);
    if (!room) {
      socket.data.roomId = null;
      socket.leave(roomId);
      return;
    }

    room.removePlayer(socket.id);
    socket.leave(roomId);
    socket.data.roomId = null;

    if (room.players.length === 0) {
      roomManager.deleteRoomIfEmpty(roomId);
    } else {
      emitRoomPlayers(room);
      if (room.status === 'waiting') {
        io.to(roomId).emit('room_settings', room.settings);
      }
    }

    broadcastActiveRooms();
    socket.emit('left_room');
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = roomManager.getRoomById(roomId);
    if (!room) return;

    room.removePlayer(socket.id);

    const deleted = roomManager.deleteRoomIfEmpty(roomId);

    if (!deleted) {
      emitRoomPlayers(room);
      if (room.status === 'waiting') {
        broadcastActiveRooms();
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Serveur TuneGuess sur http://127.0.0.1:${PORT}`);
});
