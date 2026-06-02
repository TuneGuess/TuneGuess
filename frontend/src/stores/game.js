import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { socket } from '@/services/socket';
import { sanitizeInput, MAX_NAME_LENGTH } from '@/utils/sanitize';
import { API_BASE } from '@/config';

let listenersBound = false;
let roomsInterval = null;
let oauthHandled = false;

export const useGameStore = defineStore('game', () => {
  const name = ref(localStorage.getItem('player_name') || '');
  const players = ref([]);
  const activeRooms = ref([]);

  const roomId = ref(null);
  const roomCode = ref('');
  const roomName = ref('');
  const isHost = ref(false);
  const settings = ref({ maxRounds: 10, roundDuration: 30 });

  const joinCodeInput = ref('');
  const pendingInviteCode = ref(null);
  const roomError = ref('');
  const spotifyLinked = ref(false);
  const youtubeLinked = ref(false);
  const jellyfinLinked = ref(false);
  const jellyfinServerUrl = ref(localStorage.getItem('jellyfin_server_url') || '');
  const jellyfinCode = ref(null);
  const jellyfinSecret = ref(null);
  const jellyfinConnecting = ref(false);
  let jellyfinPollInterval = null;
  const copySuccess = ref(false);

  const currentTrack = ref(null);
  const gamePlayers = ref([]);
  const answerResult = ref(null);
  const startTime = ref(null);
  const gameOver = ref(null);
  const roundState = ref(null);
  const spotifyProfileName = ref(localStorage.getItem('spotify_profile_name') || '');

  const inviteLink = computed(() =>
    roomCode.value
      ? `${window.location.origin}/room/${roomCode.value}`
      : ''
  );

  const canLaunch = computed(() => isHost.value && players.value.length >= 2);

  const sortedPlayers = computed(() =>
    [...players.value].sort((a, b) => b.score - a.score)
  );

  function setName(value) {
    name.value = value.slice(0, MAX_NAME_LENGTH);
  }

  function requireName() {
    const safe = sanitizeInput(name.value);
    if (!safe) {
      alert('Choisis un pseudo (max 20 caractères).');
      return null;
    }
    localStorage.setItem('player_name', safe);
    name.value = safe;
    return safe;
  }

  function refreshActiveRooms() {
    socket.emit('list_active_rooms');
  }

  async function fetchTracks(endpoint) {
    const res = await fetch(endpoint);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.error || "Impossible de récupérer les morceaux.");
      err.code = data.code;
      err.details = data.details;
      throw err;
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error("Format de réponse de l'API invalide.");
    }
    return data;
  }

  async function loadSpotifyTracks(spotifyToken) {
    roomError.value = '';
    try {
      // Récupérer le nom de profil Spotify (pour l'affichage dans la waiting)
      try {
        const meRes = await fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${spotifyToken}` },
        });
        if (meRes.ok) {
          const me = await meRes.json();
          const display = me?.display_name || me?.id || '';
          if (display) {
            spotifyProfileName.value = display;
            localStorage.setItem('spotify_profile_name', display);
          }
        }
      } catch {
        // Non bloquant
      }

      const recentTracks = await fetchTracks(`${API_BASE}/api/tracks/recent?token=${spotifyToken}&provider=spotify`);
      const topTracks = await fetchTracks(`${API_BASE}/api/tracks/top?token=${spotifyToken}&provider=spotify`);

      const allTracks = [...recentTracks, ...topTracks];
      const seenIds = new Set();
      const uniqueTracks = [];
      for (const track of allTracks) {
        if (track?.id && !seenIds.has(track.id)) {
          seenIds.add(track.id);
          uniqueTracks.push(track);
        }
      }

      if (uniqueTracks.length === 0) {
        throw new Error("Aucun morceau trouvé dans votre bibliothèque Spotify.");
      }

      socket.emit('store_tracks', uniqueTracks);
      spotifyLinked.value = true;
    } catch (err) {
      console.error("Erreur Spotify tracks loading:", err);
      roomError.value = {
        message: err.message,
        code: err.code || 'API_ERROR',
        details: err.details || '',
        provider: 'spotify'
      };
      spotifyLinked.value = false;
    }
  }

  async function loadYouTubeTracks(youtubeToken) {
    roomError.value = '';
    try {
      const recentTracks = await fetchTracks(`${API_BASE}/api/tracks/recent?token=${youtubeToken}&provider=youtube`);
      const topTracks = await fetchTracks(`${API_BASE}/api/tracks/top?token=${youtubeToken}&provider=youtube`);

      const allTracks = [...recentTracks, ...topTracks];
      const seenIds = new Set();
      const uniqueTracks = [];
      for (const track of allTracks) {
        if (track?.id && !seenIds.has(track.id)) {
          seenIds.add(track.id);
          uniqueTracks.push(track);
        }
      }

      if (uniqueTracks.length === 0) {
        throw new Error("Aucun morceau trouvé dans votre bibliothèque YouTube.");
      }

      socket.emit('store_tracks', uniqueTracks);
      youtubeLinked.value = true;
    } catch (err) {
      console.error("Erreur YouTube tracks loading:", err);
      roomError.value = {
        message: err.message,
        code: err.code || 'API_ERROR',
        details: err.details || '',
        provider: 'youtube'
      };
      youtubeLinked.value = false;
    }
  }

  function bindSocketListeners(router) {
    if (listenersBound) return;
    listenersBound = true;

    window.addEventListener('message', async (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'spotify_token') {
        await loadSpotifyTracks(event.data.token);
      } else if (event.data?.type === 'youtube_token') {
        await loadYouTubeTracks(event.data.token);
      }
    });

    socket.on('active_rooms', (rooms) => {
      activeRooms.value = rooms;
    });

    socket.on('update_players', (serverPlayers) => {
      players.value = serverPlayers;
      const me = serverPlayers.find((p) => p.id === socket.id);
      if (me) isHost.value = !!me.isHost;
    });

    socket.on('room_joined', (data) => {
      roomId.value = data.roomId;
      roomCode.value = data.code;
      roomName.value = data.name;
      settings.value = data.settings;
      isHost.value = data.isHost;
      roomError.value = '';
      localStorage.setItem('active_room_code', data.code);
      router.push({ name: 'waiting', params: { code: data.code } });
    });

    socket.on('room_settings', (s) => {
      settings.value = s;
    });

    socket.on('room_error', ({ message }) => {
      roomError.value = message || 'Erreur salon.';
    });

    socket.on('new_question', (data) => {
      currentTrack.value = data.track;
      gamePlayers.value = data.players;
      answerResult.value = null;
      startTime.value = Date.now();
      gameOver.value = null;
      roundState.value = null;
      router.push({ name: 'game' });
    });

    socket.on('answer_result', (result) => {
      answerResult.value = result;
    });

    socket.on('round_state', (state) => {
      roundState.value = state;
    });

    socket.on('no_tracks', () => {
      alert('Impossible de lancer : aucune musique enregistrée. Connectez Spotify avec des titres récents.');
    });

    socket.on('game_over', (data) => {
      gameOver.value = data.players;
      roundState.value = null;
      router.push({ name: 'waiting', params: { code: roomCode.value } });
    });

    socket.on('left_room', () => {
      roomId.value = null;
      roomCode.value = '';
      roomName.value = '';
      players.value = [];
      isHost.value = false;
      roundState.value = null;
      localStorage.removeItem('active_room_code');
      router.push({ name: 'lobby' });
      refreshActiveRooms();
    });

    refreshActiveRooms();
    roomsInterval = setInterval(refreshActiveRooms, 8000);
  }

  function initFromRoute(router) {
    bindSocketListeners(router);

    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get('room');
    if (inviteCode) {
      const code = inviteCode.toUpperCase();
      pendingInviteCode.value = code;
      joinCodeInput.value = code;
      router.replace({ name: 'lobby', query: { room: code } });
    }

    handleOAuthReturn(router);
  }

  function handleOAuthReturn(router) {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const provider = urlParams.get('provider') || 'spotify';
    if (!token || oauthHandled) return;
    oauthHandled = true;

    if (window.opener) {
      window.opener.postMessage({ type: `${provider}_token`, token: token }, window.location.origin);
      window.close();
      return;
    }

    const savedName = sanitizeInput(localStorage.getItem('player_name') || 'Anonyme');
    const codeToJoin = localStorage.getItem('active_room_code') || pendingInviteCode.value;

    const finishOAuth = async () => {
      if (provider === 'youtube') {
        await loadYouTubeTracks(token);
      } else {
        await loadSpotifyTracks(token);
      }
      const keepRoom = codeToJoin ? `/room/${codeToJoin}` : '/';
      window.history.replaceState({}, '', keepRoom);
      if (codeToJoin) {
        router.replace({ name: 'waiting', params: { code: codeToJoin } });
      }
    };

    if (codeToJoin && !roomId.value) {
      socket.once('room_joined', finishOAuth);
      socket.emit('join_room', { roomCode: codeToJoin, playerName: savedName });
    } else {
      finishOAuth();
    }
  }

  function createRoom(roomLabel) {
    const safeName = requireName();
    if (!safeName) return;
    socket.emit('create_room', {
      roomName: sanitizeInput(roomLabel),
      playerName: safeName,
    });
  }

  function joinRoom(code) {
    const safeName = requireName();
    if (!safeName) return;
    const roomCodeToUse = sanitizeInput(code || joinCodeInput.value, 10).toUpperCase();
    if (!roomCodeToUse) {
      roomError.value = 'Code salon invalide.';
      return;
    }
    socket.emit('join_room', { roomCode: roomCodeToUse, playerName: safeName });
  }

  function joinFromInvite() {
    if (pendingInviteCode.value) {
      joinRoom(pendingInviteCode.value);
    }
  }

  function spotifyLogin() {
    roomError.value = '';
    const safeName = requireName();
    if (!safeName) return;
    if (roomCode.value) {
      localStorage.setItem('active_room_code', roomCode.value);
    }
    const width = 600, height = 800;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;
    window.open(
      `${API_BASE}/auth/spotify/login`,
      'Spotify Login',
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,resizable=yes`
    );
  }

  function youtubeLogin() {
    roomError.value = '';
    const safeName = requireName();
    if (!safeName) return;
    if (roomCode.value) {
      localStorage.setItem('active_room_code', roomCode.value);
    }
    const width = 600, height = 800;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;
    window.open(
      `${API_BASE}/auth/youtube/login`,
      'YouTube Login',
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,resizable=yes`
    );
  }

  function updateSettings(partial) {
    if (!isHost.value) return;
    settings.value = { ...settings.value, ...partial };
    socket.emit('update_settings', settings.value);
  }

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(inviteLink.value);
      copySuccess.value = true;
      setTimeout(() => { copySuccess.value = false; }, 2000);
    } catch {
      alert('Copie impossible — copiez le lien manuellement.');
    }
  }

  function leaveRoom() {
    socket.emit('leave_room');
  }

  function startGame() {
    if (!canLaunch.value) return;
    socket.emit('start_game');
  }

  function submitGuess(playerId) {
    if (!startTime.value) return;
    const elapsed = Date.now() - startTime.value;
    const points = Math.max(1000 - elapsed, 100);
    socket.emit('answer', { playerId, points });
  }

  function nextRound() {
    socket.emit('next_round');
  }

  async function initiateJellyfin(serverUrl) {
    roomError.value = '';
    const cleanUrl = serverUrl.trim().replace(/\/$/, '');
    if (!cleanUrl) {
      alert('Veuillez saisir une URL de serveur Jellyfin.');
      return;
    }
    localStorage.setItem('jellyfin_server_url', cleanUrl);
    jellyfinServerUrl.value = cleanUrl;
    jellyfinConnecting.value = true;
    jellyfinCode.value = null;
    jellyfinSecret.value = null;

    try {
      const res = await fetch(`${API_BASE}/auth/jellyfin/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl: cleanUrl }),
      });
      if (!res.ok) throw new Error("Erreur d'initialisation");
      const data = await res.json();
      jellyfinCode.value = data.code;
      jellyfinSecret.value = data.secret;

      if (jellyfinPollInterval) clearInterval(jellyfinPollInterval);
      jellyfinPollInterval = setInterval(() => pollJellyfin(cleanUrl, data.secret), 3000);
    } catch (err) {
      console.error(err);
      alert("Impossible de contacter le serveur Jellyfin via le backend. Vérifiez l'URL.");
      jellyfinConnecting.value = false;
    }
  }

  async function pollJellyfin(serverUrl, secret) {
    try {
      const res = await fetch(`${API_BASE}/auth/jellyfin/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl, secret }),
      });
      if (!res.ok) return;
      const data = await res.json();
      
      if (data && data.token) {
        clearInterval(jellyfinPollInterval);
        jellyfinPollInterval = null;
        jellyfinCode.value = null;
        jellyfinSecret.value = null;
        jellyfinConnecting.value = false;

        await loadJellyfinTracks(data.token, serverUrl, data.userId);
      }
    } catch (err) {
      // Ignorer
    }
  }

  async function loadJellyfinTracks(token, serverUrl, userId) {
    roomError.value = '';
    try {
      const recentTracks = await fetchTracks(`${API_BASE}/api/tracks/recent?token=${token}&provider=jellyfin&serverUrl=${encodeURIComponent(serverUrl)}&userId=${userId}`);
      const topTracks = await fetchTracks(`${API_BASE}/api/tracks/top?token=${token}&provider=jellyfin&serverUrl=${encodeURIComponent(serverUrl)}&userId=${userId}`);

      const allTracks = [...recentTracks, ...topTracks];
      const seenIds = new Set();
      const uniqueTracks = [];
      for (const track of allTracks) {
        if (track?.id && !seenIds.has(track.id)) {
          seenIds.add(track.id);
          uniqueTracks.push(track);
        }
      }

      if (uniqueTracks.length === 0) {
        throw new Error("Aucun morceau trouvé sur votre serveur Jellyfin.");
      }

      socket.emit('store_tracks', uniqueTracks);
      jellyfinLinked.value = true;
    } catch (err) {
      console.error("Erreur Jellyfin tracks loading:", err);
      roomError.value = {
        message: err.message,
        code: err.code || 'API_ERROR',
        details: err.details || '',
        provider: 'jellyfin'
      };
      jellyfinLinked.value = false;
    }
  }

  function clearRoomError() {
    roomError.value = '';
  }

  function cancelJellyfin() {
    if (jellyfinPollInterval) {
      clearInterval(jellyfinPollInterval);
      jellyfinPollInterval = null;
    }
    jellyfinCode.value = null;
    jellyfinSecret.value = null;
    jellyfinConnecting.value = false;
  }

  const linkedProvider = computed(() => {
    if (spotifyLinked.value) return 'spotify';
    if (youtubeLinked.value) return 'youtube';
    if (jellyfinLinked.value) return 'jellyfin';
    return null;
  });

  const canHostProceed = computed(() => {
    if (!isHost.value) return false;
    if (!roundState.value) return false;
    return !!roundState.value.canProceed;
  });

  return {
    name,
    players,
    activeRooms,
    roomId,
    roomCode,
    roomName,
    isHost,
    settings,
    joinCodeInput,
    pendingInviteCode,
    roomError,
    spotifyLinked,
    copySuccess,
    currentTrack,
    gamePlayers,
    answerResult,
    startTime,
    gameOver,
    roundState,
    spotifyProfileName,
    inviteLink,
    canLaunch,
    sortedPlayers,
    canHostProceed,
    MAX_NAME_LENGTH,
    setName,
    requireName,
    initFromRoute,
    createRoom,
    joinRoom,
    joinFromInvite,
    spotifyLogin,
    updateSettings,
    copyInviteLink,
    leaveRoom,
    startGame,
    submitGuess,
    nextRound,
    jellyfinLinked,
    jellyfinServerUrl,
    jellyfinCode,
    jellyfinConnecting,
    initiateJellyfin,
    cancelJellyfin,
    youtubeLinked,
    youtubeLogin,
    linkedProvider,
    clearRoomError,
  };
});
