<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useGameStore } from '@/stores/game';

const props = defineProps({
  code: { type: String, default: '' },
});

const router = useRouter();
const game = useGameStore();

const activeProviderTab = ref('spotify');
const jellyfinUrlInput = ref(game.jellyfinServerUrl || '');
const showTechnicalDetails = ref(false);

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

      <!-- Erreur de chargement ou autre -->
      <div v-if="game.roomError" class="mb-6 p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-left max-w-lg mx-auto flex flex-col gap-4 relative overflow-hidden backdrop-blur-md">
        <!-- Background light effect -->
        <div class="absolute -right-10 -top-10 w-24 h-24 bg-red-500/10 rounded-full blur-xl pointer-events-none"></div>
        
        <div class="flex items-start gap-4">
          <!-- Icon -->
          <div class="p-2 rounded-xl bg-red-500/20 text-red-400 shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          
          <div class="flex-1 min-w-0">
            <h4 class="text-red-400 font-bold text-base leading-tight">
              {{ typeof game.roomError === 'object' ? game.roomError.message : game.roomError }}
            </h4>
            
            <!-- Customized Advice based on error code -->
            <div v-if="typeof game.roomError === 'object'" class="mt-2 text-sm opacity-90 text-white/80 space-y-2">
              <p v-if="game.roomError.code === 'SPOTIFY_WHITELIST_ERROR'">
                <strong>Compte non autorisé (mode développement) :</strong> L'application TuneGuess utilise l'API Spotify en mode de développement restreint. L'administrateur du projet doit ajouter l'adresse e-mail de votre compte Spotify dans la liste des utilisateurs autorisés du dashboard Spotify Developer. Vous pouvez également basculer sur le fournisseur Jellyfin.
              </p>
              <p v-else-if="game.roomError.code === 'SPOTIFY_UNAUTHORIZED'">
                <strong>Session expirée :</strong> Votre session de connexion Spotify n'est plus valide. Essayez de vous reconnecter pour rafraîchir la connexion.
              </p>
              <p v-else-if="game.roomError.code === 'JELLYFIN_UNAUTHORIZED'">
                <strong>Connexion rejetée :</strong> L'authentification a échoué sur Jellyfin. Vérifiez les informations d'identification ou tentez de relancer la connexion QuickConnect.
              </p>
              <p v-else-if="game.roomError.code === 'JELLYFIN_CONNECTION_ERROR'">
                <strong>Serveur injoignable :</strong> Impossible de joindre le serveur Jellyfin depuis le serveur TuneGuess. Vérifiez l'URL de votre serveur et assurez-vous qu'il est bien en ligne et accessible en externe.
              </p>
              <p v-else>
                Une erreur est survenue lors de la communication avec le fournisseur de musique.
              </p>
            </div>
          </div>

          <!-- Close button -->
          <button 
            type="button" 
            class="text-white/40 hover:text-white/80 transition p-1 rounded-lg hover:bg-white/5 cursor-pointer shrink-0"
            @click="game.clearRoomError()"
            title="Masquer l'erreur"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Technical details accordion -->
        <div v-if="typeof game.roomError === 'object' && game.roomError.details" class="border-t border-white/10 pt-3 mt-1">
          <button 
            type="button" 
            class="text-xs text-white/50 hover:text-white/80 transition flex items-center gap-1 font-semibold cursor-pointer"
            @click="showTechnicalDetails = !showTechnicalDetails"
          >
            <span>{{ showTechnicalDetails ? 'Masquer' : 'Afficher' }} les détails techniques</span>
            <svg 
              xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" 
              class="w-3.5 h-3.5 transition-transform duration-200"
              :class="{ 'rotate-180': showTechnicalDetails }"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          
          <div v-show="showTechnicalDetails" class="mt-2 p-3 bg-black/40 rounded-xl font-mono text-[11px] leading-relaxed text-white/70 overflow-x-auto max-h-32 border border-white/5">
            {{ game.roomError.details }}
          </div>
        </div>
      </div>

      <div v-if="!game.linkedProvider" class="flex flex-col items-center gap-4 mb-6">
        <div class="flex bg-white/5 p-1 rounded-full border border-white/10 w-full max-w-xs">
          <button
            type="button"
            class="flex-1 py-2 rounded-full font-bold text-sm cursor-pointer transition"
            :class="activeProviderTab === 'spotify' ? 'bg-white text-black' : 'opacity-60 hover:opacity-100'"
            @click="activeProviderTab = 'spotify'"
          >
            Spotify
          </button>
          <button
            type="button"
            class="flex-1 py-2 rounded-full font-bold text-sm cursor-pointer transition"
            :class="activeProviderTab === 'jellyfin' ? 'bg-white text-black' : 'opacity-60 hover:opacity-100'"
            @click="activeProviderTab = 'jellyfin'"
          >
            Jellyfin
          </button>
        </div>

        <!-- Spotify Login -->
        <template v-if="activeProviderTab === 'spotify'">
          <button
            type="button"
            class="w-full sm:w-auto bg-[#1DB954] text-black px-8 py-3 rounded-full font-black hover:scale-105 transition cursor-pointer"
            @click="game.spotifyLogin()"
          >
            Connecter Spotify
          </button>
        </template>

        <!-- Jellyfin QuickConnect Login -->
        <template v-else-if="activeProviderTab === 'jellyfin'">
          <div v-if="!game.jellyfinCode && !game.jellyfinConnecting" class="flex gap-2 w-full max-w-md">
            <input
              v-model="jellyfinUrlInput"
              type="text"
              placeholder="URL du serveur (ex: https://jf.server.com)"
              class="input-premium flex-1 p-3 rounded-xl text-sm outline-none"
            />
            <button
              type="button"
              class="px-5 py-3 rounded-xl bg-white text-black hover:scale-105 transition cursor-pointer font-bold text-sm"
              @click="game.initiateJellyfin(jellyfinUrlInput)"
            >
              Associer
            </button>
          </div>

          <div v-else-if="game.jellyfinCode" class="flex flex-col items-center gap-3 p-4 bg-white/5 border border-white/10 rounded-2xl w-full max-w-md">
            <p class="text-sm opacity-80">Saisissez ce code dans votre application Jellyfin :</p>
            <span class="text-3xl font-black tracking-widest text-green-400 uppercase py-2 px-6 bg-white/5 rounded-xl border border-white/10">
              {{ game.jellyfinCode }}
            </span>
            <p class="text-xs opacity-50 animate-pulse">En attente de validation...</p>
            <button
              type="button"
              class="mt-2 text-xs opacity-50 hover:opacity-100 underline cursor-pointer"
              @click="game.cancelJellyfin()"
            >
              Annuler
            </button>
          </div>

          <div v-else class="text-sm opacity-50 py-3">
            Initialisation de la connexion...
          </div>
        </template>
      </div>

      <div v-else class="mb-6">
        <p v-if="game.linkedProvider === 'spotify'" class="text-green-400 text-sm font-bold">
          🟢 Spotify connecté (morceaux chargés)
        </p>
        <p v-else-if="game.linkedProvider === 'jellyfin'" class="text-green-400 text-sm font-bold">
          🟢 Jellyfin connecté (morceaux chargés)
        </p>
      </div>

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
