<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 px-4 py-8">
    <div class="mx-auto max-w-6xl">
      <div class="mb-8 flex flex-col gap-3 rounded-3xl border border-slate-700 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/20">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 class="text-3xl font-semibold">Panneau Admin</h1>
            <p class="text-slate-400">Authentification locale et modération des parties en direct.</p>
          </div>
          <button v-if="authenticated" @click="logout" class="rounded-full border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700">
            Se déconnecter
          </button>
        </div>
      </div>

      <div v-if="!authenticated" class="rounded-3xl border border-slate-700 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/20">
        <h2 class="mb-4 text-xl font-semibold">Connexion admin</h2>
        <p class="mb-6 text-slate-400">Cette page est protégée par un mot de passe local. Il n'y a pas de lien public vers cette interface.</p>
        <form @submit.prevent="login" class="grid gap-4">
          <label class="grid gap-2 text-sm text-slate-300">
            Mot de passe admin
            <input
              v-model="password"
              type="password"
              class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500"
              placeholder="Entrez le mot de passe"
            />
          </label>
          <button type="submit" class="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400">
            Se connecter
          </button>
          <p v-if="error" class="text-sm text-rose-400">{{ error }}</p>
        </form>
      </div>

      <div v-else>
        <div class="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <section class="rounded-3xl border border-slate-700 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/20">
            <h2 class="mb-4 text-xl font-semibold">Statistiques globales</h2>
            <div class="grid gap-4 sm:grid-cols-3">
              <div class="rounded-3xl border border-slate-700 bg-slate-950/80 p-4">
                <p class="text-sm text-slate-400">Rooms actives</p>
                <p class="mt-2 text-3xl font-semibold text-white">{{ stats.roomCount }}</p>
              </div>
              <div class="rounded-3xl border border-slate-700 bg-slate-950/80 p-4">
                <p class="text-sm text-slate-400">Joueurs connectés</p>
                <p class="mt-2 text-3xl font-semibold text-white">{{ stats.playerCount }}</p>
              </div>
              <div class="rounded-3xl border border-slate-700 bg-slate-950/80 p-4">
                <p class="text-sm text-slate-400">Parties en cours</p>
                <p class="mt-2 text-3xl font-semibold text-white">{{ stats.playingCount }}</p>
              </div>
            </div>
          </section>

          <section class="rounded-3xl border border-slate-700 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/20">
            <h2 class="mb-4 text-xl font-semibold">Actions rapides</h2>
            <div class="grid gap-3">
              <button @click="loadRooms" class="rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-left text-sm text-slate-100 transition hover:border-cyan-500">
                Actualiser la liste des rooms
              </button>
              <p class="text-sm text-slate-400">Utilise les boutons ci-dessous pour gérer les parties et les joueurs.</p>
            </div>
          </section>
        </div>

        <section class="mt-6 rounded-3xl border border-slate-700 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/20">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 class="text-xl font-semibold">Rooms actives</h2>
              <p class="text-slate-400">Clique sur une room pour afficher les détails et modérer.</p>
            </div>
            <button @click="loadRooms" class="rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 transition hover:border-cyan-500">
              Rafraîchir
            </button>
          </div>

          <div v-if="!rooms.length" class="mt-6 rounded-3xl border border-dashed border-slate-700 bg-slate-950/80 p-6 text-slate-400">
            Aucune room active pour le moment.
          </div>

          <div v-else class="mt-6 space-y-4">
            <div
              v-for="room in rooms"
              :key="room.id"
              @click="selectRoom(room.id)"
              class="cursor-pointer rounded-3xl border border-slate-700 bg-slate-950/80 p-5 transition hover:border-cyan-500"
            >
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p class="text-sm text-slate-400">{{ room.code }}</p>
                  <h3 class="text-lg font-semibold text-white">{{ room.name }}</h3>
                </div>
                <div class="space-y-1 text-right text-sm text-slate-400">
                  <p>Joueurs : {{ room.playerCount }}</p>
                  <p>Statut : <span class="text-white">{{ room.status }}</span></p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section v-if="selectedRoom" class="mt-6 rounded-3xl border border-slate-700 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/20">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p class="text-sm text-slate-400">Détails de la room</p>
              <h2 class="text-2xl font-semibold text-white">{{ selectedRoom.name }}</h2>
              <p class="mt-1 text-sm text-slate-400">Code : {{ selectedRoom.code }} | Statut : {{ selectedRoom.status }}</p>
            </div>
            <button @click="deleteRoom(selectedRoom.id)" class="rounded-2xl bg-rose-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-400">
              Supprimer la room
            </button>
          </div>

          <div class="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div class="rounded-3xl border border-slate-700 bg-slate-950/80 p-5">
              <h3 class="mb-4 text-lg font-semibold">Informations</h3>
              <div class="grid gap-3 text-sm text-slate-400">
                <div class="flex items-center justify-between border-b border-slate-800 pb-3">
                  <span>Room ID</span><span class="text-white">{{ selectedRoom.id }}</span>
                </div>
                <div class="flex items-center justify-between border-b border-slate-800 pb-3">
                  <span>Créateur</span><span class="text-white">{{ selectedRoom.creatorId }}</span>
                </div>
                <div class="flex items-center justify-between border-b border-slate-800 pb-3">
                  <span>Tour actuel</span><span class="text-white">{{ selectedRoom.currentRound }}</span>
                </div>
                <div class="flex items-center justify-between pb-3">
                  <span>Max rounds</span><span class="text-white">{{ selectedRoom.settings.maxRounds }}</span>
                </div>
              </div>
            </div>

            <div class="rounded-3xl border border-slate-700 bg-slate-950/80 p-5">
              <h3 class="mb-4 text-lg font-semibold">Joueurs</h3>
              <div class="space-y-3 text-sm">
                <div
                  v-for="player in selectedRoom.players"
                  :key="player.id"
                  class="rounded-3xl border border-slate-800 bg-slate-900/80 p-4"
                >
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p class="font-semibold text-white">{{ player.name }}</p>
                      <p class="text-slate-400">Score : {{ player.score }} • Host : {{ player.isHost ? 'oui' : 'non' }}</p>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <button @click="promptRenamePlayer(player.id)" class="rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 transition hover:border-cyan-500">Renommer</button>
                      <button @click="kickPlayer(player.id)" class="rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs text-rose-300 transition hover:border-rose-400">Expulser</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <p v-if="error" class="mt-6 rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{{ error }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { fetchAdminRooms, fetchAdminRoom, renameAdminPlayer, kickAdminPlayer, deleteAdminRoom, isAdminAuthenticated, setAdminPassword, logoutAdmin } from '@/services/admin';

const password = ref('');
const authenticated = ref(isAdminAuthenticated());
const rooms = ref([]);
const selectedRoom = ref(null);
const stats = ref({ roomCount: 0, playerCount: 0, playingCount: 0 });
const error = ref('');
const loading = ref(false);

const summarizeStats = (roomList) => {
  const activeRooms = roomList.length;
  const playerCount = roomList.reduce((sum, room) => sum + (room.players?.length || 0), 0);
  const playingCount = roomList.filter((room) => room.status === 'playing').length;
  stats.value = { roomCount: activeRooms, playerCount, playingCount };
};

const setError = (message) => {
  error.value = message;
  setTimeout(() => {
    if (error.value === message) {
      error.value = '';
    }
  }, 6000);
};

const login = async () => {
  if (!password.value) {
    setError('Mot de passe requis.');
    return;
  }

  loading.value = true;
  try {
    setAdminPassword(password.value);
    const roomList = await fetchAdminRooms();
    authenticated.value = true;
    rooms.value = roomList;
    summarizeStats(roomList);
    selectedRoom.value = null;
  } catch (err) {
    logoutAdmin();
    setError(err.data?.error || 'Mot de passe invalide.');
    authenticated.value = false;
  } finally {
    loading.value = false;
  }
};

const loadRooms = async () => {
  loading.value = true;
  try {
    const roomList = await fetchAdminRooms();
    rooms.value = roomList;
    summarizeStats(roomList);
    if (selectedRoom.value) {
      const updated = await fetchAdminRoom(selectedRoom.value.id);
      selectedRoom.value = updated;
    }
  } catch (err) {
    setError(err.data?.error || 'Impossible de charger les rooms.');
  } finally {
    loading.value = false;
  }
};

const selectRoom = async (roomId) => {
  loading.value = true;
  try {
    selectedRoom.value = await fetchAdminRoom(roomId);
  } catch (err) {
    setError(err.data?.error || 'Impossible de charger la room.');
  } finally {
    loading.value = false;
  }
};

const promptRenamePlayer = async (playerId) => {
  const player = selectedRoom.value?.players.find((p) => p.id === playerId);
  if (!player) return;
  const newName = window.prompt('Nouveau pseudo pour ' + player.name, player.name);
  if (!newName || newName.trim().length === 0) return;
  loading.value = true;
  try {
    await renameAdminPlayer(selectedRoom.value.id, playerId, newName.trim());
    await loadRooms();
    if (selectedRoom.value?.id) {
      selectedRoom.value = await fetchAdminRoom(selectedRoom.value.id);
    }
  } catch (err) {
    setError(err.data?.error || 'Impossible de renommer le joueur.');
  } finally {
    loading.value = false;
  }
};

const kickPlayer = async (playerId) => {
  if (!confirm('Expulser ce joueur ?')) return;
  loading.value = true;
  try {
    await kickAdminPlayer(selectedRoom.value.id, playerId);
    await loadRooms();
    selectedRoom.value = selectedRoom.value ? await fetchAdminRoom(selectedRoom.value.id) : null;
  } catch (err) {
    setError(err.data?.error || 'Impossible d\'expulser le joueur.');
  } finally {
    loading.value = false;
  }
};

const deleteRoom = async (roomId) => {
  if (!confirm('Supprimer définitivement cette room ?')) return;
  loading.value = true;
  try {
    await deleteAdminRoom(roomId);
    selectedRoom.value = null;
    await loadRooms();
  } catch (err) {
    setError(err.data?.error || 'Impossible de supprimer la room.');
  } finally {
    loading.value = false;
  }
};

const logout = () => {
  logoutAdmin();
  authenticated.value = false;
  password.value = '';
  rooms.value = [];
  selectedRoom.value = null;
};

onMounted(() => {
  if (authenticated.value) {
    loadRooms();
  }
});
</script>
