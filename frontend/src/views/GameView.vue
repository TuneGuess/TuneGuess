<script setup>
import { ref, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useGameStore } from '@/stores/game';

const game = useGameStore();
const router = useRouter();

const audioRef = ref(null);
const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const volume = ref(
    localStorage.getItem('game_volume') !== null
        ? parseFloat(localStorage.getItem('game_volume'))
        : 0.5
);
const prevVolume = ref(0.5);

onMounted(() => {
  if (!game.currentTrack) {
    router.replace({ name: 'lobby' });
  }
});

watch(volume, (v) => {
  if (audioRef.value) audioRef.value.volume = v;
  localStorage.setItem('game_volume', v);
});

watch(
    (() => game.currentTrack),
    (track) => {
      if (track?.preview_url) {
        setTimeout(() => {
          if (audioRef.value) {
            audioRef.value.load();
            audioRef.value.volume = volume.value;
            audioRef.value.play()
                .then(() => { isPlaying.value = true; })
                .catch(() => { isPlaying.value = false; });
          }
        }, 100);
      } else {
        isPlaying.value = false;
        currentTime.value = 0;
      }
    },
    { immediate: true }
);

function togglePlay() {
  if (!audioRef.value) return;
  if (isPlaying.value) {
    audioRef.value.pause();
    isPlaying.value = false;
  } else {
    audioRef.value.play()
        .then(() => { isPlaying.value = true; })
        .catch(() => {});
  }
}

function toggleMute() {
  if (volume.value > 0) {
    prevVolume.value = volume.value;
    volume.value = 0;
  } else {
    volume.value = prevVolume.value > 0 ? prevVolume.value : 0.5;
  }
}

function seek(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const pos = (e.clientX - rect.left) / rect.width;
  if (audioRef.value && duration.value) {
    audioRef.value.currentTime = pos * duration.value;
  }
}

function correctPlayerName() {
  return game.gamePlayers.find((p) => p.id === game.answerResult?.correctPlayerId)?.name;
}
</script>

<template>
  <div v-if="game.currentTrack" class="flex flex-col gap-8 pb-8 max-w-6xl mx-auto px-4">
    <div class="text-center">
      <span
          v-motion
          :initial="{ opacity: 0, y: -10 }"
          :enter="{ opacity: 1, y: 0 }"
          class="bg-[var(--color-blue-main)] text-white text-xs font-bold px-4 py-1.5 rounded-full tracking-widest uppercase inline-block"
      >
        {{ game.roomCode }}
      </span>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">

      <div class="lg:col-span-1 flex flex-col gap-4 order-2 lg:order-1">
        <h3 class="text-xs uppercase tracking-widest text-[#8A8585] font-bold">Joueurs</h3>
        <div class="grid grid-cols-2 gap-3">
          <button
              v-for="(player, i) in game.gamePlayers"
              :key="player.id"
              v-motion
              :initial="{ opacity: 0, scale: 0.85 }"
              :visible="{ opacity: 1, scale: 1, transition: { delay: 100 + i * 70, type: 'spring' } }"
              type="button"
              class="p-4 border-2 rounded-xl font-bold text-center h-20 flex items-center justify-center transition-all cursor-pointer text-[var(--color-beige)] select-none"
              :class="game.answerResult?.correctPlayerId === player.id
              ? 'border-green-500 bg-green-500/10 text-green-400'
              : 'border-[#333] hover:border-[var(--color-blue-main)] bg-black/20'"
              @click="game.submitGuess(player.id)"
          >
            <span class="truncate">{{ player.name }}</span>
          </button>
        </div>
      </div>

      <div class="lg:col-span-1 order-1 lg:order-2">
        <div
            v-motion
            :initial="{ opacity: 0, y: 40, scale: 0.95 }"
            :enter="{ opacity: 1, y: 0, scale: 1, transition: { duration: 700 } }"
            class="border-2 border-[#333] rounded-2xl bg-[var(--color-dark)] p-6 md:p-8 w-full text-center"
        >
          <div class="mb-6">
            <div class="relative w-full aspect-square rounded-xl overflow-hidden mb-6 border-2 border-[#333] bg-black/20">
              <img
                  :src="game.currentTrack.image"
                  alt=""
                  class="w-full h-full object-cover"
              />
            </div>

            <h3 class="text-2xl font-black mb-2 text-[var(--color-beige)] truncate">
              {{ game.currentTrack.name }}
            </h3>
            <p class="text-[#8A8585] text-base mb-1 font-medium truncate">
              {{ game.currentTrack.artists }}
            </p>
            <p class="text-xs text-[#555] font-semibold uppercase tracking-wider truncate">
              {{ game.currentTrack.album }}
            </p>

            <div
                v-if="game.currentTrack.preview_url"
                v-motion
                :initial="{ opacity: 0, y: 16 }"
                :enter="{ opacity: 1, y: 0, transition: { delay: 350 } }"
                class="mt-6 p-4 border-2 border-[#333] rounded-xl bg-black/20 flex flex-col gap-4"
            >
              <audio
                  ref="audioRef"
                  :src="game.currentTrack.preview_url"
                  @timeupdate="currentTime = $event.target.currentTime"
                  @loadedmetadata="duration = $event.target.duration"
                  @ended="isPlaying = false"
              />

              <div class="flex justify-center">
                <button
                    type="button"
                    class="w-12 h-12 flex items-center justify-center rounded-full bg-[var(--color-blue-main)] text-white border-2 border-[var(--color-blue-main)] hover:brightness-110 transition-all cursor-pointer"
                    @click="togglePlay"
                >
                  <svg v-if="isPlaying" class="w-5 h-5 fill-current" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                  <svg v-else class="w-5 h-5 fill-current translate-x-0.5" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              </div>

              <div class="w-full flex items-center gap-3 text-xs text-[#8A8585] font-mono">
                <span>{{ Math.floor(currentTime).toString().padStart(2, '0') }}s</span>
                <div
                    class="flex-1 h-2 bg-[#333] rounded-full overflow-hidden cursor-pointer relative"
                    @click="seek"
                >
                  <div
                      class="h-full bg-[var(--color-blue-main)] rounded-full transition-all duration-150"
                      :style="{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }"
                  />
                </div>
                <span>{{ Math.floor(duration || 30).toString().padStart(2, '0') }}s</span>
              </div>

              <div class="flex items-center gap-3 native-slider-wrapper">
                <button type="button" class="text-sm cursor-pointer hover:scale-105 transition-transform select-none" @click="toggleMute">
                  {{ volume === 0 ? '🔇' : '🔊' }}
                </button>
                <input
                    v-model.number="volume"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    class="flex-1 h-1 bg-[#333] rounded-lg appearance-none cursor-pointer accent-[var(--color-blue-main)]"
                />
              </div>
            </div>

            <div
                v-else
                v-motion
                :initial="{ opacity: 0, y: 16 }"
                :enter="{ opacity: 1, y: 0, transition: { delay: 350 } }"
                class="mt-6 p-4 rounded-xl border-2 border-[#333] bg-black/20 text-[#8A8585] text-xs font-bold flex items-center justify-center gap-2 uppercase tracking-wide"
            >
              <span>⚠️</span> Aucun extrait audio disponible
            </div>
          </div>

          <button
              v-if="game.isHost"
              type="button"
              class="mt-4 w-full bg-[var(--color-blue-main)] text-white border-2 border-[var(--color-blue-main)] py-3.5 rounded-full font-black text-sm uppercase tracking-wider hover:brightness-110 transition-all disabled:opacity-40 cursor-pointer"
              :disabled="!game.canHostProceed"
              :title="!game.canHostProceed ? 'Attendez que tout le monde réponde' : ''"
              @click="game.nextRound()"
          >
            Prochaine question →
          </button>
        </div>
      </div>

      <div class="lg:col-span-1 flex flex-col gap-4 order-3">
        <h3 class="text-xs uppercase tracking-widest text-[#8A8585] font-bold">Scores</h3>
        <div class="space-y-2">
          <div
              v-for="(p, i) in game.sortedPlayers"
              :key="p.id"
              v-motion
              :initial="{ opacity: 0, x: 20 }"
              :visible="{ opacity: 1, x: 0, transition: { delay: 150 + i * 60 } }"
              class="border-2 border-[#333] bg-black/20 p-4 rounded-xl flex items-center justify-between"
          >
            <p class="font-bold text-sm text-[var(--color-beige)] truncate max-w-[70%]">
              {{ p.name }}
              <span v-if="p.isHost" class="ml-1 text-xs" title="Hôte">👑</span>
            </p>
            <p class="text-base font-black text-[var(--color-blue-main)] font-mono shrink-0">
              {{ p.score }} pts
            </p>
          </div>
        </div>
      </div>
    </div>

    <Transition name="page" mode="out-in">
      <div
          v-if="game.answerResult"
          key="result"
          class="mt-4 p-5 border-2 rounded-2xl bg-black/20 text-center max-w-md w-full mx-auto"
          :class="game.answerResult.correct ? 'border-green-500/30' : 'border-[var(--accent-pink)]/30'"
      >
        <p
            class="text-xl font-black uppercase tracking-wider"
            :class="game.answerResult.correct ? 'text-green-400' : 'text-[var(--accent-pink)]'"
        >
          {{ game.answerResult.correct ? '🎉 Bonne réponse !' : '✗ Mauvaise réponse' }}
        </p>
        <p class="mt-2 text-sm text-[#8A8585]">
          C'était <strong class="text-[var(--color-beige)]">{{ correctPlayerName() }}</strong>
        </p>
      </div>
    </Transition>
  </div>
</template>