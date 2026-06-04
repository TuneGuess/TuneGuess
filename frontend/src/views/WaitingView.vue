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
const lastfmUsernameInput = ref(game.lastfmUsername || '');
const showTechnicalDetails = ref(false);

onMounted(() => {
  if (!game.roomCode && props.code) {
    router.replace({ name: 'lobby', query: { room: props.code } });
  }
});
</script>

<template>
  <div v-if="game.roomCode" class="flex flex-col items-center gap-8 mt-2 pb-8 max-w-2xl mx-auto px-4">
    <header
        v-motion
        :initial="{ opacity: 0, y: 30 }"
        :enter="{ opacity: 1, y: 0, transition: { duration: 600 } }"
        class="text-center flex flex-col items-center"
    >
      <span class="bg-[var(--color-blue-main)] text-white text-xs font-bold px-4 py-1.5 rounded-full tracking-widest uppercase mb-4">
        {{ game.roomCode }}
      </span>
      <h2 class="text-4xl md:text-5xl font-black mb-2 text-[var(--color-beige)]">
        {{ game.roomName }}
      </h2>
      <p class="text-[#8A8585] text-base flex items-center justify-center gap-2 font-medium">
        <span class="w-2.5 h-2.5 rounded-full bg-[var(--color-blue-main)] animate-pulse" />
        Salon d'attente
      </p>
    </header>

    <div
        v-motion
        :initial="{ opacity: 0, y: 24 }"
        :enter="{ opacity: 1, y: 0, transition: { delay: 100, duration: 500 } }"
        class="border-2 border-[#333] rounded-2xl bg-[var(--color-dark)] p-6 md:p-8 w-full"
    >
      <h3 class="text-xs uppercase tracking-widest text-[#8A8585] font-bold mb-4 flex items-center gap-2">
        <span>⎘</span> Lien d'invitation
      </h3>
      <div class="flex gap-3 flex-wrap sm:flex-nowrap">
        <input
            readonly
            :value="game.inviteLink"
            class="w-full bg-transparent border-2 border-[#333] p-3 rounded-xl text-sm font-mono text-[var(--color-beige)] outline-none select-all"
        />
        <button
            type="button"
            class="w-full sm:w-auto px-6 py-3 rounded-full font-bold shrink-0 transition-colors text-sm cursor-pointer"
            :class="game.copySuccess
            ? 'bg-green-600 text-white border-2 border-green-600'
            : 'btn-secondary'"
            @click="game.copyInviteLink()"
        >
          {{ game.copySuccess ? '✓ Copié !' : 'Copier' }}
        </button>
      </div>
    </div>

    <div
        v-motion
        :initial="{ opacity: 0, y: 24 }"
        :enter="{ opacity: 1, y: 0, transition: { delay: 180, duration: 500 } }"
        class="border-2 border-[#333] rounded-2xl bg-[var(--color-dark)] p-6 md:p-8 w-full"
    >
      <h3 class="text-xs uppercase tracking-widest text-[#8A8585] font-bold mb-5">
        Paramètres {{ game.isHost ? '' : '(lecture seule)' }}
      </h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <label class="flex flex-col gap-2 text-xs uppercase tracking-wider text-[#8A8585] font-bold">
          Manches max
          <input
              type="number"
              min="1"
              max="50"
              :disabled="!game.isHost"
              :value="game.settings.maxRounds"
              class="bg-transparent border-2 border-[#333] focus:border-[var(--color-blue-main)] p-3 rounded-xl outline-none text-base font-bold text-[var(--color-beige)] text-center transition-colors disabled:opacity-40"
              @change="game.updateSettings({ maxRounds: Number($event.target.value) })"
          />
        </label>
        <label class="flex flex-col gap-2 text-xs uppercase tracking-wider text-[#8A8585] font-bold">
          Durée manche (s)
          <input
              type="number"
              min="10"
              max="120"
              :disabled="!game.isHost"
              :value="game.settings.roundDuration"
              class="bg-transparent border-2 border-[#333] focus:border-[var(--color-blue-main)] p-3 rounded-xl outline-none text-base font-bold text-[var(--color-beige)] text-center transition-colors disabled:opacity-40"
              @change="game.updateSettings({ roundDuration: Number($event.target.value) })"
          />
        </label>
      </div>
    </div>

    <div
        v-motion
        :initial="{ opacity: 0, y: 24 }"
        :enter="{ opacity: 1, y: 0, transition: { delay: 260, duration: 500 } }"
        class="border-2 border-[#333] rounded-2xl bg-[var(--color-dark)] p-6 md:p-8 w-full text-center"
    >
      <h3 class="text-xs uppercase tracking-widest text-[#8A8585] font-bold mb-6">Joueurs</h3>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <template v-if="game.players.length > 0">
          <div
              v-for="(p, i) in game.players"
              :key="p.id"
              v-motion
              :initial="{ opacity: 0, scale: 0.8 }"
              :visible="{ opacity: 1, scale: 1, transition: { delay: i * 60, type: 'spring' } }"
              class="p-4 border-2 border-[#333] rounded-xl font-bold text-center flex items-center justify-center gap-2 hover:border-[var(--color-blue-main)] transition-colors h-16 text-[var(--color-beige)] bg-black/20"
          >
            <span class="truncate">{{ p.name }}</span>
            <span v-if="p.isHost" class="text-sm" title="Hôte">👑</span>
          </div>
        </template>
        <p v-else class="col-span-full text-[#8A8585] text-sm flex items-center justify-center gap-3 py-4">
          <span class="inline-block w-4 h-4 border-2 border-[#333] border-t-[var(--color-blue-main)] rounded-full animate-spin" />
          Connexion...
        </p>
      </div>

      <div
          v-if="game.roomError"
          v-motion
          :initial="{ opacity: 0, x: -10 }"
          :enter="{ opacity: 1, x: 0 }"
          class="mb-8 p-5 rounded-2xl border-2 border-[var(--accent-pink)] bg-black/20 text-left flex flex-col gap-4 relative overflow-hidden"
      >
        <div class="flex items-start gap-4">
          <div class="p-2 rounded-xl bg-[var(--accent-pink)]/10 text-[var(--accent-pink)] shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>

          <div class="flex-1 min-w-0">
            <h4 class="text-[var(--accent-pink)] font-bold text-sm leading-tight">
              {{ typeof game.roomError === 'object' ? game.roomError.message : game.roomError }}
            </h4>

            <div v-if="typeof game.roomError === 'object'" class="mt-2 text-xs text-[#8A8585] space-y-2 leading-relaxed">
              <p v-if="game.roomError.code === 'SPOTIFY_WHITELIST_ERROR'">
                <strong>Compte non autorisé (mode développement) :</strong> L'application TuneGuess utilise l'API Spotify en mode de développement restreint. L'administrateur doit ajouter votre e-mail de compte Spotify dans son dashboard développeur. Vous pouvez également basculer sur Jellyfin ou Last.fm.
              </p>
              <p v-else-if="game.roomError.code === 'SPOTIFY_UNAUTHORIZED'">
                <strong>Session expirée :</strong> Votre session de connexion Spotify n'est plus valide. Essayez de vous reconnecter.
              </p>
              <p v-else-if="game.roomError.code === 'JELLYFIN_UNAUTHORIZED'">
                <strong>Connexion rejetée :</strong> L'authentification a échoué sur Jellyfin. Vérifiez vos identifiants ou relancez la connexion.
              </p>
              <p v-else-if="game.roomError.code === 'JELLYFIN_CONNECTION_ERROR'">
                <strong>Serveur injoignable :</strong> Impossible de joindre le serveur Jellyfin. Vérifiez l'URL et assurez-vous qu'il est accessible en externe.
              </p>
              <p v-else-if="game.roomError.code === 'LASTFM_ERROR'">
                <strong>Utilisateur introuvable :</strong> Impossible de charger les données pour ce pseudonyme Last.fm. Vérifiez l'orthographe.
              </p>
              <p v-else-if="game.roomError.code === 'YOUTUBE_UNAUTHORIZED'">
                <strong>Connexion Google expirée :</strong> Votre session de connexion Google/YouTube a expiré ou a été révoquée. Veuillez vous reconnecter.
              </p>
              <p v-else>
                Une erreur est survenue lors de la communication avec le fournisseur de musique.
              </p>
            </div>
          </div>

          <button
              type="button"
              class="text-[#555] hover:text-[var(--color-beige)] transition p-1 rounded-lg cursor-pointer shrink-0"
              title="Masquer l'erreur"
              @click="game.clearRoomError()"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div v-if="typeof game.roomError === 'object' && game.roomError.details" class="border-t border-[#333] pt-3 mt-1">
          <button
              type="button"
              class="text-xs text-[#8A8585] hover:text-[var(--color-beige)] transition flex items-center gap-1 font-semibold cursor-pointer"
              @click="showTechnicalDetails = !showTechnicalDetails"
          >
            <span>{{ showTechnicalDetails ? 'Masquer' : 'Afficher' }} les détails techniques</span>
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="2"
                stroke="currentColor"
                class="w-3.5 h-3.5 transition-transform duration-200"
                :class="{ 'rotate-180': showTechnicalDetails }"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          <div
              v-show="showTechnicalDetails"
              class="mt-2 p-3 bg-black/40 rounded-xl font-mono text-[11px] leading-relaxed text-[#8A8585] overflow-x-auto max-h-32 border border-[#333]"
          >
            {{ game.roomError.details }}
          </div>
        </div>
      </div>

      <div v-if="!game.linkedProvider" class="flex flex-col items-center gap-4 mb-6 w-full">
        <div class="flex bg-black/40 p-1 rounded-full border-2 border-[#333] w-full max-w-md relative">
          <button
              type="button"
              class="flex-1 py-2 rounded-full font-bold text-sm cursor-pointer z-10 transition-all"
              :class="activeProviderTab === 'spotify' ? 'bg-[var(--color-blue-main)] text-white' : 'text-[#8A8585] hover:text-[var(--color-beige)]'"
              @click="activeProviderTab = 'spotify'"
          >
            Spotify
          </button>
          <button
              type="button"
              class="flex-1 py-2 rounded-full font-bold text-sm cursor-pointer z-10 transition-all"
              :class="activeProviderTab === 'youtube' ? 'bg-[var(--color-blue-main)] text-white' : 'text-[#8A8585] hover:text-[var(--color-beige)]'"
              @click="activeProviderTab = 'youtube'"
          >
            YouTube
          </button>
          <button
              type="button"
              class="flex-1 py-2 rounded-full font-bold text-sm cursor-pointer z-10 transition-all"
              :class="activeProviderTab === 'jellyfin' ? 'bg-[var(--color-blue-main)] text-white' : 'text-[#8A8585] hover:text-[var(--color-beige)]'"
              @click="activeProviderTab = 'jellyfin'"
          >
            Jellyfin
          </button>
          <button
              type="button"
              class="flex-1 py-2 rounded-full font-bold text-sm cursor-pointer z-10 transition-all"
              :class="activeProviderTab === 'lastfm' ? 'bg-[var(--color-blue-main)] text-white' : 'text-[#8A8585] hover:text-[var(--color-beige)]'"
              @click="activeProviderTab = 'lastfm'"
          >
            Last.fm
          </button>
        </div>
      </div>

      <div v-if="!game.linkedProvider" class="flex flex-col items-center gap-4 mb-6 w-full">
        <template v-if="activeProviderTab === 'spotify'">
          <button
              type="button"
              disabled
              class="w-full sm:w-auto bg-[#1DB954] text-black px-8 py-3 rounded-full font-black hover:brightness-110 transition cursor-pointer text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              @click="game.spotifyLogin()"
          >
            Connecter Spotify
          </button>
        </template>

        <template v-else-if="activeProviderTab === 'youtube'">
          <button
              type="button"
              class="w-full sm:w-auto bg-[#FF0000] text-white px-8 py-3 rounded-full font-black hover:brightness-110 transition cursor-pointer text-sm"
              @click="game.youtubeLogin()"
          >
            Connecter YouTube
          </button>
        </template>

        <template v-else-if="activeProviderTab === 'jellyfin'">
          <div v-if="!game.jellyfinCode && !game.jellyfinConnecting" class="flex gap-2 w-full max-w-md">
            <input
                v-model="jellyfinUrlInput"
                type="text"
                placeholder="URL du serveur (ex: https://jf.server.com)"
                class="w-full bg-transparent border-2 border-[#333] focus:border-[var(--color-blue-main)] p-3 rounded-xl text-sm text-[var(--color-beige)] outline-none transition-colors"
            />
            <button
                type="button"
                class="px-5 py-3 rounded-full btn-primary cursor-pointer font-bold text-sm shrink-0"
                @click="game.initiateJellyfin(jellyfinUrlInput)"
            >
              Associer
            </button>
          </div>

          <div
              v-else-if="game.jellyfinCode"
              v-motion
              :initial="{ opacity: 0, scale: 0.9 }"
              :enter="{ opacity: 1, scale: 1 }"
              class="flex flex-col items-center gap-3 p-5 border-2 border-[#333] rounded-2xl w-full max-w-md bg-black/20"
          >
            <p class="text-xs font-semibold text-[#8A8585]">Saisissez ce code dans votre application Jellyfin :</p>
            <span
                v-motion
                :initial="{ scale: 0.8 }"
                :enter="{ scale: 1, transition: { type: 'spring', stiffness: 300 } }"
                class="text-3xl font-black tracking-widest text-[var(--color-blue-main)] uppercase py-3 px-8 bg-black/40 rounded-xl border-2 border-[#333]"
            >
              {{ game.jellyfinCode }}
            </span>
            <p class="text-xs text-[#8A8585] flex items-center gap-2 font-medium">
              <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-blue-main)] animate-pulse" />
              En attente de validation...
            </p>
            <button
                type="button"
                class="mt-2 text-xs text-[#555] hover:text-[var(--color-beige)] underline cursor-pointer"
                @click="game.cancelJellyfin()"
            >
              Annuler
            </button>
          </div>

          <div v-else class="text-xs text-[#8A8585] py-3 flex items-center gap-2 font-medium">
            <span class="w-4 h-4 border-2 border-[#333] border-t-[var(--color-blue-main)] rounded-full animate-spin" />
            Initialisation de la connexion...
          </div>
        </template>

        <template v-else-if="activeProviderTab === 'lastfm'">
          <div class="flex gap-2 w-full max-w-md" v-motion :initial="{ opacity: 0, y: 10 }" :enter="{ opacity: 1, y: 0 }">
            <input
                v-model="lastfmUsernameInput"
                type="text"
                placeholder="Nom d'utilisateur Last.fm"
                class="w-full bg-transparent border-2 border-[#333] focus:border-[var(--color-blue-main)] p-3 rounded-xl text-sm text-[var(--color-beige)] outline-none transition-colors font-semibold"
                @keyup.enter="game.connectLastfm(lastfmUsernameInput)"
            />
            <button
                type="button"
                class="px-5 py-3 rounded-full btn-primary cursor-pointer font-bold text-sm shrink-0"
                @click="game.connectLastfm(lastfmUsernameInput)"
            >
              Associer
            </button>
          </div>
        </template>
      </div>

      <div v-else class="mb-6">
        <p
            v-motion
            :initial="{ opacity: 0 }"
            :enter="{ opacity: 1 }"
            class="inline-flex items-center gap-2 text-green-500 text-xs font-bold px-4 py-2 rounded-full border-2 border-green-900/40 bg-green-950/20"
        >
          <span class="w-2 h-2 rounded-full bg-green-500" />
          <span>
            <template v-if="game.linkedProvider === 'spotify' && game.spotifyProfileName">
              Connecté sur Spotify en tant que {{ game.spotifyProfileName }}
            </template>
            <template v-else-if="game.linkedProvider === 'lastfm'">
              Last.fm connecté ({{ game.lastfmUsername }})
            </template>
            <template v-else>
              {{ game.linkedProvider === 'spotify' ? 'Spotify' : game.linkedProvider === 'youtube' ? 'YouTube' : game.linkedProvider === 'jellyfin' ? 'Jellyfin' : 'Last.fm' }} connecté
            </template>
          </span>
        </p>
      </div>

      <div
          v-if="game.gameOver"
          v-motion
          :initial="{ opacity: 0, y: 10 }"
          :enter="{ opacity: 1, y: 0 }"
          class="mb-8 p-5 border-2 border-[#333] rounded-2xl bg-black/10"
      >
        <p class="font-black mb-3 text-sm uppercase tracking-wider text-[#8A8585]">Partie terminée</p>
        <ol class="text-sm space-y-2">
          <li
              v-for="(p, i) in game.gameOver"
              :key="p.id"
              class="flex justify-between items-center p-3 rounded-xl border border-transparent"
              :class="i === 0 ? 'border-yellow-600/50 bg-yellow-950/20 text-yellow-500 font-bold' : 'text-[var(--color-beige)]'"
          >
            <span>{{ i + 1 }}. {{ p.name }}</span>
            <span :class="i === 0 ? 'text-yellow-500' : 'text-[var(--color-blue-main)]'" class="font-black">
              {{ p.score }} pts
            </span>
          </li>
        </ol>
      </div>

      <div class="flex flex-col items-center w-full">
        <button
            type="button"
            :disabled="!game.canLaunch"
            class="btn-primary px-12 py-4 rounded-full font-black text-xl cursor-pointer w-full sm:w-auto disabled:opacity-40"
            :title="!game.canLaunch ? 'Il faut au moins 2 joueurs' : ''"
            @click="game.startGame()"
        >
          ▶ Lancer la party
        </button>

        <p v-if="!game.canLaunch && game.isHost" class="text-xs text-[#8A8585] font-semibold mt-3">
          Minimum 2 joueurs pour lancer
        </p>

        <button
            type="button"
            class="mt-8 text-xs font-bold uppercase tracking-widest text-[#555] hover:text-[var(--color-beige)] transition cursor-pointer"
            @click="game.leaveRoom()"
        >
          Quitter le salon
        </button>
      </div>
    </div>
  </div>
</template>