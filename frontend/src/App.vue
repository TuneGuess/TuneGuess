<script setup>
import { onMounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useGameStore } from '@/stores/game';
import AppHeader from '@/components/AppHeader.vue';
import AppFooter from '@/components/AppFooter.vue';
import AnimatedBackground from '@/components/AnimatedBackground.vue';

const router = useRouter();
const route = useRoute();
const game = useGameStore();

onMounted(() => {
  game.initFromRoute(router);
});

// Gérer de manière réactive les invitations depuis l'URL
watch(
  () => route.query.room,
  (newRoom) => {
    if (newRoom) {
      const code = newRoom.toUpperCase();
      game.pendingInviteCode = code;
      game.joinCodeInput = code;

      // Normaliser en majuscule dans l'URL si besoin
      if (newRoom !== code) {
        router.replace({ name: 'lobby', query: { room: code } });
      }
    }
  },
  { immediate: true }
);
</script>

<template>
  <div class="min-h-screen text-white flex flex-col items-center font-[Unageo] relative">
    <div class="app-bg" aria-hidden="true" />
    <AnimatedBackground />
    <AppHeader />
    <main class="w-full max-w-5xl px-4 sm:px-6 relative z-10 flex-1 flex flex-col">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" :key="route.path" />
        </Transition>
      </RouterView>
    </main>
    <AppFooter />
  </div>
</template>
