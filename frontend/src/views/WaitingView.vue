<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useGameStore } from '@/stores/game';

const props = defineProps({
  code: { type: String, default: '' },
});

const router = useRouter();
const game = useGameStore();

onMounted(() => {
  if (!game.roomCode && props.code) {
    router.replace({ name: 'lobby', query: { room: props.code } });
  }
});
</script>

<template>
  <div v-if="game.roomCode" class="flex flex-col items-center gap-8 mt-4">
    <div class="text-center">
      <span class="room-badge">{{ game.roomCode }}</span>
      <h2 class="text-3xl font-black mt-4 italic">{{ game.roomName }}</h2>
      <p class="opacity-50 text-sm mt-1">Salon d'attente</p>
    </div>

    <div class="glass-card p-8 w-full max-w-2xl">
      <h3 class="text-lg font-bold mb-3 opacity-80">Lien d'invitation</h3>
      <div class="flex gap-2 flex-wrap">
        <input
          readonly
          :value="game.inviteLink"
          class="input-premium flex-1 min-w-0 p-3 rounded-xl text-sm font-mono opacity-80"
        />
        <button
          type="button"
          class="px-6 py-3 rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 transition cursor-pointer font-bold shrink-0"
          @click="game.copyInviteLink()"
        >
          {{ game.copySuccess ? 'Copié !' : 'Copier' }}
        </button>
      </div>
    </div>

    <div class="glass-card p-8 w-full max-w-2xl">
      <h3 class="text-lg font-bold mb-4">
        Paramètres {{ game.isHost ? '' : '(lecture seule)' }}
      </h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="flex flex-col gap-2 text-sm opacity-80">
          Manches max
          <input
            type="number"
            min="1"
            max="50"
            :disabled="!game.isHost"
            :value="game.settings.maxRounds"
            class="input-premium p-3 rounded-xl disabled:opacity-50"
            @change="game.updateSettings({ maxRounds: Number($event.target.value) })"
          />
        </label>
        <label class="flex flex-col gap-2 text-sm opacity-80">
          Durée manche (s)
          <input
            type="number"
            min="10"
            max="120"
            :disabled="!game.isHost"
            :value="game.settings.roundDuration"
            class="input-premium p-3 rounded-xl disabled:opacity-50"
            @change="game.updateSettings({ roundDuration: Number($event.target.value) })"
          />
        </label>
      </div>
    </div>

    <div class="glass-card p-8 w-full max-w-2xl text-center">
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <template v-if="game.players.length > 0">
          <div
            v-for="p in game.players"
            :key="p.id"
            class="p-4 bg-white/5 rounded-2xl border border-white/10 font-bold italic flex items-center justify-center gap-2"
          >
            <span>{{ p.name }}</span>
            <span v-if="p.isHost" class="host-crown" title="Hôte">👑</span>
          </div>
        </template>
        <p v-else class="col-span-full opacity-50">Connexion...</p>
      </div>

      <button
        v-if="!game.spotifyLinked"
        type="button"
        class="mb-6 w-full sm:w-auto bg-[#1DB954] text-black px-8 py-3 rounded-full font-black hover:scale-105 transition cursor-pointer"
        @click="game.spotifyLogin()"
      >
        Connecter Spotify
      </button>
      <p v-else class="mb-6 text-green-400 text-sm font-bold">Spotify connecté</p>

      <div
        v-if="game.gameOver"
        class="mb-6 p-4 rounded-2xl bg-white/5 border border-white/10"
      >
        <p class="font-black mb-2">Partie terminée</p>
        <ol class="text-sm space-y-1">
          <li v-for="(p, i) in game.gameOver" :key="p.id">
            {{ i + 1 }}. {{ p.name }} — {{ p.score }} pts
          </li>
        </ol>
      </div>

      <button
        type="button"
        :disabled="!game.canLaunch"
        class="btn-launch px-10 py-4 rounded-full font-black text-xl transition cursor-pointer disabled:opacity-60"
        :title="!game.canLaunch ? 'Il faut au moins 2 joueurs' : ''"
        @click="game.startGame()"
      >
        Lancer la party
      </button>
      <p v-if="!game.canLaunch && game.isHost" class="text-xs opacity-50 mt-3">
        Minimum 2 joueurs pour lancer
      </p>

      <button
        type="button"
        class="mt-6 text-sm opacity-40 hover:opacity-70 underline cursor-pointer"
        @click="game.leaveRoom()"
      >
        Quitter le salon
      </button>
    </div>
  </div>
</template>
