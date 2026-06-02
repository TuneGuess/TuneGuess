<script setup>
import { useRoute } from 'vue-router';
import logo from '@/assets/Logo.svg';

const route = useRoute();
</script>

<template>
  <header class="p-6 md:p-10 flex justify-between items-center relative z-10 w-full max-w-5xl px-4 sm:px-6">
    <RouterLink
      to="/"
      v-motion
      :initial="{ opacity: 0, scale: 0.9 }"
      :enter="{ opacity: 1, scale: 1, transition: { duration: 500 } }"
      class="group flex items-center gap-3"
    >
      <img
        :src="logo"
        alt="Logo TuneGuess"
        class="h-10 md:h-12 w-auto transition-transform duration-300 group-hover:scale-105"
      />
    </RouterLink>

    <nav
      v-motion
      :initial="{ opacity: 0, x: 20 }"
      :enter="{ opacity: 1, x: 0, transition: { delay: 150, duration: 500 } }"
      class="flex items-center gap-1 sm:gap-2"
    >
      <RouterLink
        to="/credits"
        class="px-3 py-1.5 text-xs sm:text-sm rounded-full transition"
        :class="route.name === 'credits' ? 'bg-blue-900/30 text-blue-400' : 'opacity-60 hover:opacity-100 hover:bg-gray-800'"
      >
        Crédits
      </RouterLink>
      <RouterLink
        to="/legal"
        class="px-3 py-1.5 text-xs sm:text-sm rounded-full transition"
        :class="route.name === 'legal' ? 'bg-blue-900/30 text-blue-400' : 'opacity-60 hover:opacity-100 hover:bg-gray-800'"
      >
        Légal
      </RouterLink>
    </nav>
  </header>
</template>
