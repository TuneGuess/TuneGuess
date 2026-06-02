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
      class="fixed inset-0 z-[-1] transition-all duration-1000 ease-out"
      :style="{
        backgroundImage: `url(${game.currentTrack.image})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: 'blur(48px) brightness(0.3) saturate(1.2)',
        transform: 'scale(1.15)',
      }"
    />
    <div class="fixed inset-0 z-[-1] bg-black/40" />

    <div class="flex flex-col items-center gap-8 mt-2 pb-8">
      <span
        v-motion
        :initial="{ opacity: 0, y: -10 }"
        :enter="{ opacity: 1, y: 0 }"
        class="room-badge"
      >
        {{ game.roomCode }}
      </span>

      <div
        v-motion
        :initial="{ opacity: 0, y: 40, scale: 0.95 }"
        :enter="{ opacity: 1, y: 0, scale: 1, transition: { duration: 700 } }"
        class="glass-card p-6 md:p-10 w-full max-w-2xl text-center"
      >
        <h2 class="text-3xl md:text-4xl font-black mb-8 italic text-gradient">
          Qui a écouté ça ?
        </h2>

        <div class="mb-8">
          <div class="relative w-52 h-52 mx-auto mb-6">
            <div
              class="absolute inset-0 rounded-full border-2 border-dashed border-white/20 vinyl-ring"
              :class="{ paused: !isPlaying }"
            />
            <img
              :src="game.currentTrack.image"
              alt=""
              class="w-44 h-44 mx-auto rounded-full object-cover shadow-2xl relative z-10 ring-4 ring-white/10 transition-transform duration-500"
              :class="{ 'scale-105': isPlaying }"
            />
          </div>

          <h3
            v-motion
            :initial="{ opacity: 0 }"
            :enter="{ opacity: 1, transition: { delay: 200 } }"
            class="text-2xl font-bold"
          >
            {{ game.currentTrack.name }}
          </h3>
          <p class="text-lg opacity-75 mt-1">{{ game.currentTrack.artists }}</p>
          <p class="text-sm opacity-45">{{ game.currentTrack.album }}</p>

          <div
            v-if="game.currentTrack.preview_url"
            v-motion
            :initial="{ opacity: 0, y: 16 }"
            :enter="{ opacity: 1, y: 0, transition: { delay: 350 } }"
            class="mt-8 flex flex-col items-center w-full max-w-md mx-auto glass-card-sm p-5 gap-4"
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
                class="w-14 h-14 flex items-center justify-center rounded-full btn-primary shadow-lg cursor-pointer"
                @click="togglePlay"
              >
                <svg v-if="isPlaying" class="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
                <svg v-else class="w-5 h-5 fill-current translate-x-0.5" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
              <div class="flex items-end gap-1 h-10">
                <span
                  v-for="i in 16"
                  :key="i"
                  class="w-1 rounded-full transition-colors"
                  :class="isPlaying ? 'bg-green-400 animate-soundwave' : 'bg-white/20'"
                  :style="{
                    animationDelay: `${(i - 1) * 0.08}s`,
                    height: isPlaying ? undefined : '6px',
                  }"
                />
              </div>
            </div>
            <div class="w-full flex items-center gap-3">
              <span class="text-xs opacity-50 font-mono w-10 text-right">
                0:{{ Math.floor(currentTime).toString().padStart(2, '0') }}
              </span>
              <div
                class="flex-1 h-2 bg-white/10 rounded-full overflow-hidden cursor-pointer group"
                @click="seek"
              >
                <div
                  class="h-full bg-gradient-to-r from-green-400 via-emerald-400 to-violet-400 rounded-full transition-all duration-150 group-hover:shadow-[0_0_12px_rgba(74,222,128,0.5)]"
                  :style="{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }"
                />
              </div>
              <span class="text-xs opacity-50 font-mono w-10">
                0:{{ Math.floor(duration || 30).toString().padStart(2, '0') }}
              </span>
            </div>
            <div class="flex items-center gap-3 w-full px-2 pt-2 border-t border-white/5">
              <button type="button" class="text-lg opacity-70 hover:opacity-100 cursor-pointer transition" @click="toggleMute">
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
          <div
            v-else
            v-motion
            :initial="{ opacity: 0, y: 16 }"
            :enter="{ opacity: 1, y: 0, transition: { delay: 350 } }"
            class="mt-8 p-4 rounded-2xl bg-white/5 border border-white/10 text-white/60 text-sm font-semibold max-w-md mx-auto flex items-center justify-center gap-2"
          >
            <span>⚠️</span> Aucun extrait audio disponible pour ce morceau.
          </div>
        </div>

        <Transition name="page" mode="out-in">
          <div v-if="!game.answerResult" key="guess" class="grid grid-cols-2 md:grid-cols-3 gap-3">
            <button
              v-for="(player, i) in game.gamePlayers"
              :key="player.id"
              v-motion
              :initial="{ opacity: 0, scale: 0.85 }"
              :visible="{ opacity: 1, scale: 1, transition: { delay: 400 + i * 70, type: 'spring' } }"
              type="button"
              class="guess-btn bg-white/8 border border-white/15 p-4 rounded-2xl font-bold cursor-pointer"
              @click="game.submitGuess(player.id)"
            >
              {{ player.name }}
            </button>
          </div>
          <div v-else key="result" class="text-center result-pop">
            <p
              class="text-3xl font-black"
              :class="game.answerResult.correct ? 'text-green-400' : 'text-red-400'"
            >
              {{ game.answerResult.correct ? '🎉 Bonne réponse !' : '✗ Mauvaise réponse' }}
            </p>
            <p class="mt-4 opacity-75 text-lg">C'était <strong>{{ correctPlayerName() }}</strong></p>
          </div>
        </Transition>

        <button
          v-if="game.isHost"
          type="button"
          class="mt-8 bg-gradient-to-r from-indigo-500 to-violet-500 text-white px-8 py-3 rounded-full font-bold transition shadow-[0_0_30px_rgba(99,102,241,0.35)] disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:scale-105 cursor-pointer"
          :disabled="!game.canHostProceed"
          :title="!game.canHostProceed ? 'Attendez que tout le monde réponde ou que le temps soit écoulé' : ''"
          @click="game.nextRound()"
        >
          Prochaine question →
        </button>
      </div>

      <div
        v-motion
        :initial="{ opacity: 0, y: 30 }"
        :enter="{ opacity: 1, y: 0, transition: { delay: 500, duration: 600 } }"
        class="glass-card p-6 md:p-8 w-full max-w-2xl"
      >
        <h3 class="text-xl font-bold mb-5 flex items-center gap-2">
          <span class="text-green-400">★</span> Scores
        </h3>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div
            v-for="(p, i) in game.sortedPlayers"
            :key="p.id"
            v-motion
            :initial="{ opacity: 0, y: 12 }"
            :visible="{ opacity: 1, y: 0, transition: { delay: 550 + i * 60 } }"
            class="score-card p-4 bg-white/5 rounded-2xl border border-white/10 text-center"
            :class="{ 'ring-1 ring-green-400/30': i === 0 }"
          >
            <p class="font-bold flex items-center justify-center gap-1 text-sm">
              <span v-if="i === 0" class="text-yellow-400 text-xs">#1</span>
              {{ p.name }}
              <span v-if="p.isHost" class="host-crown text-sm">👑</span>
            </p>
            <p class="text-2xl text-green-400 font-black mt-1">{{ p.score }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
