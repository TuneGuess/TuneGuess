require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const querystring = require('querystring');
const http = require('http');
const { Server } = require('socket.io');

const app = express();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const CORS_ORIGIN = process.env.CORS_ORIGIN || FRONTEND_URL;
const PORT = Number(process.env.PORT) || 5000;

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const MAX_NAME_LENGTH = 20;
const MAX_ROOM_PLAYERS = 10;
const ROOM_CODE_LENGTH = 5;

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeInput(text, maxLen = MAX_NAME_LENGTH) {
  if (typeof text !== 'string') return '';
  return escapeHtml(text.trim().slice(0, maxLen));
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getRoomCodeFromId(roomId) {
  if (!roomId || typeof roomId !== 'string') return '';
  return roomId.startsWith('room-') ? roomId.slice(5).toUpperCase() : roomId.toUpperCase();
}

function findRoomByCode(code) {
  if (!code || typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  const roomId = `room-${normalized}`;
  return rooms[roomId] || null;
}

app.get('/login', (req, res) => {
  const scope = 'user-read-recently-played user-top-read';
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: CLIENT_ID,
      scope: scope,
      redirect_uri: REDIRECT_URI,
    }));
});

app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  try {
    const response = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      data: querystring.stringify({
        code: code,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      }),
      headers: {
        'Authorization': 'Basic ' + (Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')),
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const access_token = response.data.access_token;
    res.redirect(`${FRONTEND_URL}?token=${access_token}`);
  } catch (error) {
    console.error("Erreur Callback Spotify:", error.response?.data || error.message);
    res.status(500).send("Erreur d'authentification");
  }
});

app.get('/user-top-tracks', async (req, res) => {
  const token = req.query.token;
  try {
    const response = await axios({
      method: 'get',
      url: 'https://api.spotify.com/v1/me/top/tracks?limit=20',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    res.json(response.data.items);
  } catch (error) {
    console.error("Erreur top tracks:", error.message);
    res.status(500).json({ error: "Impossible de récupérer les tops morceaux" });
  }
});

app.get('/user-recent-tracks', async (req, res) => {
  const token = req.query.token;
  try {
    const response = await axios({
      method: 'get',
      url: 'https://api.spotify.com/v1/me/player/recently-played?limit=50',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    res.json(response.data.items);
  } catch (error) {
    console.error("Erreur morceaux récents:", error.message);
    res.status(500).json({ error: "Impossible de récupérer les morceaux récents" });
  }
});

const fetchDeezerPreview = async (trackName, artistName) => {
  try {
    const cleanTrack = trackName.split(/[(\[-]/)[0].trim();
    const cleanArtist = artistName.split(/[(\[-]/)[0].trim();
    const query = `${cleanArtist} ${cleanTrack}`;

    const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}`;
    const response = await axios.get(url);

    if (response.data?.data?.length > 0) {
      return response.data.data[0].preview;
    }
  } catch (error) {
    console.error(`Erreur recherche Deezer pour "${artistName} - ${trackName}":`, error.message);
  }
  return null;
};


const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN }
});

/** @type {Record<string, object>} */
let rooms = {};

function getPublicRoomList() {
  return Object.values(rooms)
    .filter((r) => r.status === 'waiting' && r.players.length < MAX_ROOM_PLAYERS)
    .map((r) => ({
      id: r.id,
      code: getRoomCodeFromId(r.id),
      name: r.name,
      playerCount: r.players.length,
      maxPlayers: MAX_ROOM_PLAYERS,
      settings: r.settings,
    }));
}

function broadcastActiveRooms() {
  io.emit('active_rooms', getPublicRoomList());
}

function getSocketRoom(socket) {
  const roomId = socket.data.roomId;
  return roomId ? rooms[roomId] : null;
}

function assignHostIfNeeded(room) {
  if (room.players.length === 0) return;
  const hasHost = room.players.some((p) => p.isHost);
  if (!hasHost) {
    room.players[0].isHost = true;
    room.creatorId = room.players[0].id;
  }
}

function emitRoomPlayers(room) {
  io.to(room.id).emit('update_players', room.players);
}

function deleteRoomIfEmpty(roomId) {
  const room = rooms[roomId];
  if (room && room.players.length === 0) {
    delete rooms[roomId];
    broadcastActiveRooms();
  }
}

const selectNextQuestion = async (room) => {
  let allTracks = [];

  for (const [playerId, tracks] of Object.entries(room.playerTracks)) {
    (tracks || []).forEach((track) => {
      if (track?.track?.preview_url) {
        allTracks.push({ track, playerId });
      }
    });
  }

  if (allTracks.length === 0) {
    for (const [playerId, tracks] of Object.entries(room.playerTracks)) {
      (tracks || []).forEach((track) => {
        if (track?.track) {
          allTracks.push({ track, playerId });
        }
      });
    }
  }

  if (room.playedTrackIds.size > 0) {
    allTracks = allTracks.filter((item) => {
      const id = item.track?.track?.id;
      return id && !room.playedTrackIds.has(id);
    });
  }

  if (allTracks.length === 0) {
    return null;
  }

  const selected = allTracks[Math.floor(Math.random() * allTracks.length)];
  const track = selected.track.track;
  const trackId = track.id;
  if (trackId) room.playedTrackIds.add(trackId);

  const name = track.name;
  const artists = track.artists.map((a) => a.name).join(', ');
  let previewUrl = track.preview_url;

  if (!previewUrl) {
    previewUrl = await fetchDeezerPreview(name, artists);
  }

  room.currentRound += 1;

  return {
    selected,
    questionData: {
      track: {
        name,
        artists,
        album: track.album.name,
        image: track.album.images[0]?.url,
        preview_url: previewUrl
      },
      players: room.players.map((p) => ({ id: p.id, name: p.name })),
      round: room.currentRound,
      maxRounds: room.settings.maxRounds,
    }
  };
};

io.on('connection', (socket) => {
  console.log('Connexion socket:', socket.id);

  socket.on('list_active_rooms', () => {
    socket.emit('active_rooms', getPublicRoomList());
  });

  socket.on('create_room', ({ roomName, playerName }) => {
    const safePlayerName = sanitizeInput(playerName);
    const safeRoomName = sanitizeInput(roomName) || 'Partie sans nom';

    if (!safePlayerName) {
      socket.emit('room_error', { message: 'Pseudo invalide.' });
      return;
    }

    let code;
    let roomId;
    do {
      code = generateRoomCode();
      roomId = `room-${code}`;
    } while (rooms[roomId]);

    const room = {
      id: roomId,
      name: safeRoomName,
      creatorId: socket.id,
      players: [{
        id: socket.id,
        name: safePlayerName,
        score: 0,
        isHost: true,
      }],
      playerTracks: {},
      currentQuestion: null,
      answeredPlayers: new Set(),
      status: 'waiting',
      settings: { maxRounds: 10, roundDuration: 30 },
      currentRound: 0,
      playedTrackIds: new Set(),
    };

    rooms[roomId] = room;
    socket.data.roomId = roomId;
    socket.join(roomId);

    socket.emit('room_joined', {
      roomId,
      code,
      name: safeRoomName,
      settings: room.settings,
      isHost: true,
    });
    emitRoomPlayers(room);
    broadcastActiveRooms();
  });

  socket.on('join_room', ({ roomCode, playerName }) => {
    const safePlayerName = sanitizeInput(playerName);
    if (!safePlayerName) {
      socket.emit('room_error', { message: 'Pseudo invalide.' });
      return;
    }

    const room = findRoomByCode(roomCode);
    if (!room) {
      socket.emit('room_error', { message: 'Salon introuvable.' });
      return;
    }
    if (room.status !== 'waiting') {
      socket.emit('room_error', { message: 'La partie est déjà en cours.' });
      return;
    }
    if (room.players.length >= MAX_ROOM_PLAYERS) {
      socket.emit('room_error', { message: 'Le salon est complet.' });
      return;
    }
    if (room.players.some((p) => p.id === socket.id)) {
      socket.emit('room_error', { message: 'Vous êtes déjà dans ce salon.' });
      return;
    }

    const newPlayer = {
      id: socket.id,
      name: safePlayerName,
      score: 0,
      isHost: false,
    };
    room.players.push(newPlayer);

    socket.data.roomId = room.id;
    socket.join(room.id);

    socket.emit('room_joined', {
      roomId: room.id,
      code: getRoomCodeFromId(room.id),
      name: room.name,
      settings: room.settings,
      isHost: false,
    });
    io.to(room.id).emit('room_settings', room.settings);
    emitRoomPlayers(room);
    broadcastActiveRooms();
  });

  socket.on('update_settings', (settings) => {
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

  socket.on('store_tracks', (tracks) => {
    const room = getSocketRoom(socket);
    if (!room || !Array.isArray(tracks)) return;
    room.playerTracks[socket.id] = tracks;
  });

  socket.on('start_game', async () => {
    const room = getSocketRoom(socket);
    if (!room) return;
    if (room.creatorId !== socket.id) return;
    if (room.players.length < 2) return;
    if (room.status === 'playing') return;

    room.status = 'playing';
    room.answeredPlayers = new Set();
    room.currentRound = 0;
    room.playedTrackIds = new Set();
    broadcastActiveRooms();

    const result = await selectNextQuestion(room);
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

    room.answeredPlayers = new Set();
    const result = await selectNextQuestion(room);

    if (!result) {
      io.to(room.id).emit('no_tracks');
      return;
    }

    room.currentQuestion = result.selected;
    io.to(room.id).emit('new_question', result.questionData);
  });

  socket.on('answer', ({ playerId, points }) => {
    const room = getSocketRoom(socket);
    if (!room || !room.currentQuestion || room.answeredPlayers.has(socket.id)) return;

    room.answeredPlayers.add(socket.id);

    const isCorrect = playerId === room.currentQuestion.playerId;
    const player = room.players.find((p) => p.id === socket.id);

    if (isCorrect && player) {
      const safePoints = Math.min(10000, Math.max(0, Number(points) || 0));
      player.score += safePoints;
    }

    socket.emit('answer_result', {
      correct: isCorrect,
      correctPlayerId: room.currentQuestion.playerId,
    });

    emitRoomPlayers(room);
  });

  socket.on('leave_room', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms[roomId];
    if (!room) {
      socket.data.roomId = null;
      socket.leave(roomId);
      return;
    }

    room.players = room.players.filter((p) => p.id !== socket.id);
    delete room.playerTracks[socket.id];

    if (room.creatorId === socket.id) {
      assignHostIfNeeded(room);
      if (room.players.length > 0) {
        room.creatorId = room.players.find((p) => p.isHost)?.id || room.players[0].id;
      }
    }

    socket.leave(roomId);
    socket.data.roomId = null;

    if (room.players.length === 0) {
      delete rooms[roomId];
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

    const room = rooms[roomId];
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== socket.id);
    delete room.playerTracks[socket.id];

    if (room.creatorId === socket.id) {
      assignHostIfNeeded(room);
      if (room.players.length > 0) {
        const host = room.players.find((p) => p.isHost);
        room.creatorId = host ? host.id : room.players[0].id;
      }
    }

    deleteRoomIfEmpty(roomId);

    if (rooms[roomId]) {
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
