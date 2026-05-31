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
  const copySuccess = ref(false);

  const currentTrack = ref(null);
  const gamePlayers = ref([]);
  const answerResult = ref(null);
  const startTime = ref(null);
  const gameOver = ref(null);

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

  async function loadSpotifyTracks(spotifyToken) {
    const fetchRecent = fetch(`${API_BASE}/user-recent-tracks?token=${spotifyToken}`)
      .then((res) => res.json())
      .catch(() => []);

    const fetchTop = fetch(`${API_BASE}/user-top-tracks?token=${spotifyToken}`)
      .then((res) => res.json())
      .catch(() => []);

    const [recentItems, topItems] = await Promise.all([fetchRecent, fetchTop]);
    const formattedTopItems = (topItems || []).map((track) => ({ track }));
    const allItems = [...(recentItems || []), ...formattedTopItems];

    const seenIds = new Set();
    const uniqueItems = [];
    for (const item of allItems) {
      if (item?.track?.id && !seenIds.has(item.track.id)) {
        seenIds.add(item.track.id);
        uniqueItems.push(item);
      }
    }

    socket.emit('store_tracks', uniqueItems);
    spotifyLinked.value = true;
  }

  function bindSocketListeners(router) {
    if (listenersBound) return;
    listenersBound = true;

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
      router.push({ name: 'game' });
    });

    socket.on('answer_result', (result) => {
      answerResult.value = result;
    });

    socket.on('no_tracks', () => {
      alert('Impossible de lancer : aucune musique enregistrée. Connectez Spotify avec des titres récents.');
    });

    socket.on('game_over', (data) => {
      gameOver.value = data.players;
      router.push({ name: 'waiting', params: { code: roomCode.value } });
    });

    socket.on('left_room', () => {
      roomId.value = null;
      roomCode.value = '';
      roomName.value = '';
      players.value = [];
      isHost.value = false;
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
    const spotifyToken = urlParams.get('token');
    if (!spotifyToken || oauthHandled) return;
    oauthHandled = true;

    const savedName = sanitizeInput(localStorage.getItem('player_name') || 'Anonyme');
    const codeToJoin = localStorage.getItem('active_room_code') || pendingInviteCode.value;

    const finishOAuth = async () => {
      await loadSpotifyTracks(spotifyToken);
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
    const safeName = requireName();
    if (!safeName) return;
    if (roomCode.value) {
      localStorage.setItem('active_room_code', roomCode.value);
    }
    window.location.href = `${API_BASE}/login`;
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
    inviteLink,
    canLaunch,
    sortedPlayers,
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
  };
});
