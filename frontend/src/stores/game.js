import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { socket } from '@/services/socket';
import { sanitizeInput, MAX_NAME_LENGTH } from '@/utils/sanitize';
import { API_BASE } from '@/config';

let listenersBound = false;
let oauthHandled = false;

export const useGameStore = defineStore('game', () => {
  const name = ref(localStorage.getItem('player_name') || '');
  const players = ref([]);
  const activeRooms = ref([]);

  const roomId = ref(null);
  const roomCode = ref('');
  const roomName = ref('');
  const isHost = ref(false);
  const settings = ref({ maxRounds: 10, roundDuration: 30, pointsMax: 1000, delaiGrace: 1, pointsMin: 100, bonusPremier: true });
  // Réglages choisis dans la fenêtre de création, envoyés dès que le salon existe.
  let pendingSettings = null;

  const joinCodeInput = ref('');
  const pendingInviteCode = ref(null);
  const roomError = ref('');
  const youtubeLinked = ref(false);
  const jellyfinLinked = ref(false);
  const lastfmLinked = ref(false);
  // Sources du compte connecté, lues par le serveur (store_account_tracks).
  const accountLinked = ref(false);
  const accountTracksCount = ref(0);
  const accountLoading = ref(false);
  const lastfmUsername = ref(localStorage.getItem('lastfm_username') || '');
  const jellyfinServerUrl = ref(localStorage.getItem('jellyfin_server_url') || '');
  const jellyfinCode = ref(null);
  const jellyfinSecret = ref(null);
  const jellyfinConnecting = ref(false);
  let jellyfinPollInterval = null;
  const copySuccess = ref(false);

  const currentTrack = ref(null);
  const gamePlayers = ref([]);
  const answerResult = ref(null);
  const ownTrack = ref(false);
  const startTime = ref(null);
  const gameOver = ref(null);
  const roundState = ref(null);

  const inviteLink = computed(() =>
    roomCode.value
      ? `${window.location.origin}/room/${roomCode.value}`
      : ''
  );

  // Prêt = a envoyé des pistes dans ce salon (indiqué par le serveur).
  const readyCount = computed(() => players.value.filter((p) => p.ready).length);
  const canLaunch = computed(() => isHost.value && readyCount.value >= 2);

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

  async function fetchTracks(endpoint, token) {
    const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.error || "Impossible de récupérer les morceaux.");
      err.code = data.code;
      throw err;
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error("Format de réponse de l'API invalide.");
    }
    return data;
  }

  // Le serveur n'accepte que ces champs ; il retrouve lui-même les extraits et ne garde que les images d'hôtes connus.
  function emitTracks(tracks, jellyfin) {
    const payload = tracks.map(({ id, provider, name, artists, albumName, imageUrl, deezerId }) => ({ id, provider, name, artists, albumName, imageUrl, deezerId }));
    socket.emit('store_tracks', { tracks: payload, jellyfin });
  }

  async function loadYouTubeTracks(youtubeToken) {
    roomError.value = '';
    try {
      const recentTracks = await fetchTracks(`${API_BASE}/api/tracks/recent?provider=youtube`, youtubeToken);
      const topTracks = await fetchTracks(`${API_BASE}/api/tracks/top?provider=youtube`, youtubeToken);

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

      emitTracks(uniqueTracks);
      youtubeLinked.value = true;
    } catch (err) {
      console.error("Erreur YouTube tracks loading:", err);
      roomError.value = {
        message: err.message,
        code: err.code || 'API_ERROR',
        provider: 'youtube'
      };
      youtubeLinked.value = false;
    }
  }

  async function loadLastfmTracks(username) {
    roomError.value = '';
    try {
      const recentTracks = await fetchTracks(`${API_BASE}/api/tracks/recent?provider=lastfm`, username);
      const topTracks = await fetchTracks(`${API_BASE}/api/tracks/top?provider=lastfm`, username);

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
        throw new Error("Aucun morceau trouvé pour cet utilisateur Last.fm.");
      }

      emitTracks(uniqueTracks);
      lastfmLinked.value = true;
      lastfmUsername.value = username;
      localStorage.setItem('lastfm_username', username);
    } catch (err) {
      console.error("Erreur Last.fm tracks loading:", err);
      roomError.value = {
        message: err.message,
        code: err.code || 'API_ERROR',
        provider: 'lastfm'
      };
      lastfmLinked.value = false;
    }
  }

  function connectLastfm(username) {
    roomError.value = '';
    const safeUser = sanitizeInput((username || '').toString().trim());
    if (!safeUser) {
      alert('Veuillez saisir un nom d’utilisateur Last.fm.');
      return;
    }
    if (roomCode.value) {
      localStorage.setItem('active_room_code', roomCode.value);
    }
    loadLastfmTracks(safeUser);
  }

  function bindSocketListeners(router) {
    if (listenersBound) return;
    listenersBound = true;

    window.addEventListener('message', async (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'youtube_token') {
        await loadYouTubeTracks(event.data.token);
      }
    });

    window.addEventListener('storage', async (event) => {
      if (event.key === 'oauth_token_received' && event.newValue) {
        const [provider, token] = event.newValue.split('|');
        if (provider === 'youtube') {
          await loadYouTubeTracks(token);
        }
        localStorage.removeItem('oauth_token_received');
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
      // Les pistes sont gardées par salon côté serveur : un nouveau salon repart sans source.
      youtubeLinked.value = false;
      jellyfinLinked.value = false;
      lastfmLinked.value = false;
      accountLinked.value = false;
      accountTracksCount.value = 0;
      roomId.value = data.roomId;
      roomCode.value = data.code;
      roomName.value = data.name;
      settings.value = data.settings;
      isHost.value = data.isHost;
      roomError.value = '';
      localStorage.setItem('active_room_code', data.code);
      if (data.isHost && pendingSettings) {
        updateSettings(pendingSettings);
        pendingSettings = null;
      }
      router.push({ name: 'waiting', params: { code: data.code } });
    });

    socket.on('account_tracks', (res) => {
      accountLoading.value = false;
      accountLinked.value = !!res.ok;
      accountTracksCount.value = res.count || 0;
      if (!res.ok) {
        roomError.value = res.error || (res.errors?.length
          ? `Sources du compte en erreur (${res.errors.join(', ')}) : reconnectez-les dans Mon compte.`
          : 'Aucune piste sur les sources de votre compte : liez Last.fm, YouTube ou Jellyfin dans Mon compte.');
      }
    });

    socket.on('room_settings', (s) => {
      settings.value = s;
    });

    // Refus du serveur à la connexion (limite par adresse) : socket.io ne retente pas, on l'affiche.
    socket.on('connect_error', (err) => {
      roomError.value = err?.message || 'Connexion au serveur impossible.';
    });

    socket.on('room_error', ({ message }) => {
      roomError.value = message || 'Erreur salon.';
    });

    socket.on('new_question', (data) => {
      currentTrack.value = data.track;
      gamePlayers.value = data.players;
      answerResult.value = null;
      ownTrack.value = false;
      startTime.value = Date.now();
      gameOver.value = null;
      roundState.value = null;
      router.push({ name: 'game' });
    });

    // Sa propre piste : on ne répond pas, les autres devinent.
    socket.on('own_track', () => {
      ownTrack.value = true;
    });

    socket.on('answer_result', (result) => {
      answerResult.value = result;
    });

    socket.on('round_state', (state) => {
      roundState.value = state;
    });

    socket.on('no_tracks', () => {
      alert('Impossible de lancer : aucun morceau inédit trouvé. Ajoutez une source (Last.fm, YouTube ou Jellyfin).');
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
    setInterval(refreshActiveRooms, 8000);
  }

  function initFromRoute(router) {
    bindSocketListeners(router);
    // Reliquat d'une ancienne version qui laissait le jeton OAuth dans le localStorage.
    localStorage.removeItem('oauth_token_received');

    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get('room');
    if (inviteCode) {
      const code = inviteCode.toUpperCase();
      pendingInviteCode.value = code;
      joinCodeInput.value = code;
      router.replace({ name: 'lobby', query: { room: code } });
    }

    handleOAuthReturn();
  }

  function handleOAuthReturn() {
    // Le serveur renvoie le jeton dans le fragment (#), qui n'est jamais transmis au serveur.
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const token = hashParams.get('token');
    const provider = hashParams.get('provider');
    if (!token || !provider || oauthHandled) return;
    oauthHandled = true;
    history.replaceState(null, '', window.location.pathname + window.location.search);

    // 1. Fallback pour la fenêtre parente si l'opener est perdu : l'événement storage suffit,
    //    le jeton est retiré aussitôt et ne reste jamais stocké.
    localStorage.setItem('oauth_token_received', `${provider}|${token}`);
    localStorage.removeItem('oauth_token_received');

    // 2. Notification via postMessage si l'opener existe
    if (window.opener) {
      try {
        window.opener.postMessage({ type: `${provider}_token`, token: token }, window.location.origin);
      } catch (err) {
        console.error("Échec postMessage:", err);
      }
    }

    // 3. Fermeture de la fenêtre (puisque c'est forcément un flux OAuth de popup)
    // On remplace le contenu de la page par un message propre si elle ne se ferme pas tout de suite
    if (document && document.body) {
      document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #121214; color: #E4E4E7; font-family: sans-serif; text-align: center; padding: 20px;">
          <h1 style="color: #1DB954; font-size: 24px; margin-bottom: 10px;">Connexion réussie !</h1>
          <p style="color: #8A8585; font-size: 16px;">Cette fenêtre va se fermer automatiquement.</p>
          <p style="color: #555; font-size: 14px; margin-top: 20px;">Si elle ne se ferme pas, vous pouvez la fermer manuellement.</p>
        </div>
      `;
    }

    setTimeout(() => {
      window.close();
    }, 1000);
  }

  function createRoom(roomLabel, initialSettings = null) {
    const safeName = requireName();
    if (!safeName) return;
    pendingSettings = initialSettings;
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
      'YouTubeLogin',
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,resizable=yes`
    );
  }

  function useAccountTracks() {
    roomError.value = '';
    accountLoading.value = true;
    socket.emit('store_account_tracks');
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

  // Les points sont calculés par le serveur à partir de l'heure de réception.
  function submitGuess(playerId) {
    if (!startTime.value || ownTrack.value) return;
    socket.emit('answer', { playerId });
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
    } catch {
      // Ignorer
    }
  }

  async function loadJellyfinTracks(token, serverUrl, userId) {
    roomError.value = '';
    try {
      const recentTracks = await fetchTracks(`${API_BASE}/api/tracks/recent?provider=jellyfin&serverUrl=${encodeURIComponent(serverUrl)}&userId=${encodeURIComponent(userId)}`, token);
      const topTracks = await fetchTracks(`${API_BASE}/api/tracks/top?provider=jellyfin&serverUrl=${encodeURIComponent(serverUrl)}&userId=${encodeURIComponent(userId)}`, token);

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

      emitTracks(uniqueTracks, { serverUrl, token });
      jellyfinLinked.value = true;
    } catch (err) {
      console.error("Erreur Jellyfin tracks loading:", err);
      roomError.value = {
        message: err.message,
        code: err.code || 'API_ERROR',
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
    if (youtubeLinked.value) return 'youtube';
    if (jellyfinLinked.value) return 'jellyfin';
    if (lastfmLinked.value) return 'lastfm';
    if (accountLinked.value) return 'compte';
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
    copySuccess,
    currentTrack,
    gamePlayers,
    answerResult,
    ownTrack,
    startTime,
    gameOver,
    roundState,
    inviteLink,
    canLaunch,
    readyCount,
    accountLinked,
    accountTracksCount,
    accountLoading,
    useAccountTracks,
    sortedPlayers,
    canHostProceed,
    MAX_NAME_LENGTH,
    setName,
    requireName,
    initFromRoute,
    createRoom,
    joinRoom,
    joinFromInvite,
    updateSettings,
    copyInviteLink,
    leaveRoom,
    startGame,
    submitGuess,
    nextRound,
    jellyfinLinked,
    lastfmLinked,
    lastfmUsername,
    jellyfinServerUrl,
    jellyfinCode,
    jellyfinConnecting,
    initiateJellyfin,
    cancelJellyfin,
    youtubeLinked,
    youtubeLogin,
    linkedProvider,
    connectLastfm,
    clearRoomError,
  };
});
