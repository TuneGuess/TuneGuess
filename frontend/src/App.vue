<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useGameStore } from '@/stores/game';
import AppHeader from '@/components/AppHeader.vue';

const router = useRouter();
const game = useGameStore();

onMounted(() => {
  game.initFromRoute(router);
});
</script>

<template>
  <div class="min-h-screen text-white flex flex-col items-center font-[Unageo] relative">
    <div class="app-bg" aria-hidden="true" />
    <AppHeader />
    <main class="w-full max-w-5xl px-6 relative z-10 pb-16">
      <RouterView />
    </main>
  </div>
</template>
