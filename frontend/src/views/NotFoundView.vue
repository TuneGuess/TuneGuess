<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();

const excuses = [
  'Raph a débranché la prise !',
  '"ATTENDS NON !" - ChristianF67 ',
  'Docker qui décide de plus docker apparemment ;-;',
];

const fakePlayers = [
  'Le serveur',
  'Un bot Spotify',
  'Ta connexion Wi-Fi',
  'Personne (c’était évident)',
];

const excuse = ref(excuses[0]);
const clickedGuess = ref(null);
const wobble = ref(false);

const pathDisplay = computed(() => route.path || '/???');

onMounted(() => {
  excuse.value = excuses[Math.floor(Math.random() * excuses.length)];
});

function guess(player) {
  clickedGuess.value = player;
  wobble.value = true;
  setTimeout(() => { wobble.value = false; }, 600);
}
</script>

<template>
  <div class="flex flex-col items-center gap-8 mt-4 pb-12 text-center max-w-xl mx-auto">
    <div
      v-motion
      :initial="{ opacity: 0, scale: 0.5, rotate: -8 }"
      :enter="{ opacity: 1, scale: 1, rotate: 0, transition: { type: 'spring', stiffness: 200, damping: 14 } }"
      class="relative"
    >
      <p
        class="text-[7rem] md:text-[9rem] font-black leading-none italic text-gradient select-none"
        :class="{ 'animate-[wobble_0.5s_ease-in-out]': wobble }"
      >
        404
      </p>
    </div>

    <header
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { delay: 150 } }"
    >
      <h1 class="text-2xl md:text-3xl font-black italic mb-2">
        Page introuvable
      </h1>
      <p class="text-sm opacity-55 font-mono break-all px-4">
        {{ pathDisplay }}
      </p>
      <p class="mt-4 text-sm opacity-75 italic max-w-md mx-auto">
        « {{ excuse }} »
      </p>
    </header>

    <div
      v-motion
      :initial="{ opacity: 0, y: 24 }"
      :enter="{ opacity: 1, y: 0, transition: { delay: 280 } }"
      class="glass-card p-6 md:p-8 w-full"
    >
      <h2 class="text-lg font-bold mb-2 text-gradient">Qui a cassé ce lien ?</h2>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          v-for="(name, i) in fakePlayers"
          :key="name"
          v-motion
          :initial="{ opacity: 0, x: -12 }"
          :visible="{ opacity: 1, x: 0, transition: { delay: 400 + i * 70 } }"
          type="button"
          class="guess-btn p-3 rounded-xl text-sm font-bold cursor-pointer"
          :class="clickedGuess === name ? 'border-red-400/50 bg-red-500/10' : ''"
          @click="guess(name)"
        >
          {{ name }}
        </button>
      </div>

      <Transition name="page">
        <p
          v-if="clickedGuess"
          class="mt-4 text-red-400 font-bold text-sm result-pop"
        >
          ✗ Mauvaise réponse ! C’était… le dev !.
        </p>
      </Transition>

      <div class="flex items-end justify-center gap-1 h-8 mt-6 opacity-40">
        <span
          v-for="i in 12"
          :key="i"
          class="w-1 bg-white/30 rounded-full animate-soundwave"
          :style="{ animationDelay: `${(i - 1) * 0.1}s`, animationDuration: '1.8s' }"
        />
      </div>
      <p class="text-[10px] opacity-30 mt-2">Bruit de silence...</p>
    </div>

    <div
      v-motion
      :initial="{ opacity: 0 }"
      :enter="{ opacity: 1, transition: { delay: 500 } }"
      class="flex flex-col sm:flex-row gap-3"
    >
      <RouterLink
        to="/"
        class="btn-primary px-8 py-3 rounded-full font-black text-sm"
      >
        ♪ Retour à l’accueil
      </RouterLink>
    </div>
    <p class="text-[15px] opacity-30 mt-2">"De toute manière, ça marche sur ma machine"</p>
  </div>
</template>

<style scoped>
@keyframes wobble {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-3deg) scale(1.02); }
  75% { transform: rotate(3deg) scale(0.98); }
}
</style>
