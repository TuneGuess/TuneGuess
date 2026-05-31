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
  () => game.currentTrack,
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
  <div v-if="game.currentTrack">
    <div
      class="fixed inset-0 z-[-1] transition-all duration-1000"
      :style="{
        backgroundImage: `url(${game.currentTrack.image})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: 'blur(40px) brightness(0.35)',
        transform: 'scale(1.1)',
      }"
    />

    <div class="flex flex-col items-center gap-8 mt-4">
      <span class="room-badge">{{ game.roomCode }}</span>

      <div class="glass-card p-8 w-full max-w-2xl text-center">
        <h2 class="text-4xl font-black mb-6 italic">Qui a écouté ça ?</h2>

        <div class="mb-8">
          <img
            :src="game.currentTrack.image"
            alt=""
            class="w-48 h-48 mx-auto rounded-2xl mb-4 shadow-2xl"
          />
          <h3 class="text-2xl font-bold">{{ game.currentTrack.name }}</h3>
          <p class="text-lg opacity-75">{{ game.currentTrack.artists }}</p>
          <p class="text-sm opacity-50">{{ game.currentTrack.album }}</p>

          <div
            v-if="game.currentTrack.preview_url"
            class="mt-6 flex flex-col items-center w-full max-w-md mx-auto glass-card-sm p-4 gap-3"
          >
            <audio
              ref="audioRef"
              :src="game.currentTrack.preview_url"
              @timeupdate="currentTime = $event.target.currentTime"
              @loadedmetadata="duration = $event.target.duration"
              @ended="isPlaying = false"
            />
            <div class="flex items-center justify-between w-full px-2 gap-4">
              <button
                type="button"
                class="w-12 h-12 flex items-center justify-center rounded-full bg-white text-black hover:scale-105 transition shadow-lg cursor-pointer"
                @click="togglePlay"
              >
                <svg v-if="isPlaying" class="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
                <svg v-else class="w-5 h-5 fill-current translate-x-0.5" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
              <div class="flex items-end gap-1 h-8">
                <span
                  v-for="i in 12"
                  :key="i"
                  class="w-1 bg-green-400 rounded-full"
                  :class="{ 'animate-soundwave': isPlaying }"
                  :style="{
                    animationDelay: `${(i - 1) * 0.12}s`,
                    height: isPlaying ? undefined : '6px',
                  }"
                />
              </div>
            </div>
            <div class="w-full flex items-center gap-3">
              <span class="text-xs opacity-50 font-mono">
                0:{{ Math.floor(currentTime).toString().padStart(2, '0') }}
              </span>
              <div
                class="flex-1 h-2 bg-white/10 rounded-full overflow-hidden cursor-pointer"
                @click="seek"
              >
                <div
                  class="h-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full"
                  :style="{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }"
                />
              </div>
              <span class="text-xs opacity-50 font-mono">
                0:{{ Math.floor(duration || 30).toString().padStart(2, '0') }}
              </span>
            </div>
            <div class="flex items-center gap-3 w-full px-2 pt-2 border-t border-white/5">
              <button type="button" class="text-white/70 hover:text-white cursor-pointer" @click="toggleMute">
                {{ volume === 0 ? '🔇' : '🔊' }}
              </button>
              <input
                v-model.number="volume"
                type="range"
                min="0"
                max="1"
                step="0.01"
                class="flex-1 volume-slider"
              />
            </div>
          </div>
        </div>

        <div v-if="!game.answerResult" class="grid grid-cols-2 md:grid-cols-3 gap-4">
          <button
            v-for="player in game.gamePlayers"
            :key="player.id"
            type="button"
            class="guess-btn bg-white/10 border border-white/20 p-4 rounded-2xl font-bold cursor-pointer"
            @click="game.submitGuess(player.id)"
          >
            {{ player.name }}
          </button>
        </div>
        <div v-else class="text-center">
          <p
            class="text-2xl font-black"
            :class="game.answerResult.correct ? 'text-green-400' : 'text-red-400'"
          >
            {{ game.answerResult.correct ? 'Bonne réponse !' : 'Mauvaise réponse !' }}
          </p>
          <p class="mt-4 opacity-75">C'était {{ correctPlayerName() }}</p>
          <button
            v-if="game.isHost"
            type="button"
            class="mt-6 bg-blue-500 text-white px-6 py-3 rounded-full font-bold hover:scale-105 transition cursor-pointer"
            @click="game.nextRound()"
          >
            Prochaine question
          </button>
        </div>
      </div>

      <div class="glass-card p-6 w-full max-w-2xl">
        <h3 class="text-xl font-bold mb-4">Scores</h3>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div
            v-for="p in game.sortedPlayers"
            :key="p.id"
            class="score-card p-4 bg-white/5 rounded-2xl border border-white/10 text-center"
          >
            <p class="font-bold flex items-center justify-center gap-1">
              {{ p.name }}
              <span v-if="p.isHost" class="host-crown text-sm">👑</span>
            </p>
            <p class="text-2xl text-green-400 font-black">{{ p.score }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
