import { createRouter, createWebHistory } from 'vue-router';
import { useGameStore } from '@/stores/game';
import LobbyView from '@/views/LobbyView.vue';
import WaitingView from '@/views/WaitingView.vue';
import GameView from '@/views/GameView.vue';
import CreditsView from '@/views/CreditsView.vue';
import LegalView from '@/views/LegalView.vue';
import NotFoundView from '@/views/NotFoundView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'lobby',
      component: LobbyView,
    },
    {
      path: '/room/:code',
      name: 'waiting',
      component: WaitingView,
      props: true,
    },
    {
      path: '/game',
      name: 'game',
      component: GameView,
    },
    {
      path: '/credits',
      name: 'credits',
      component: CreditsView,
    },
    {
      path: '/legal',
      name: 'legal',
      component: LegalView,
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: NotFoundView,
    },
  ],
  scrollBehavior(to) {
    if (to.hash) return { el: to.hash, behavior: 'smooth' };
    return { top: 0, behavior: 'smooth' };
  },
});

router.beforeEach((to) => {
  const game = useGameStore();

  if (to.name === 'waiting' && !game.roomCode) {
    return { name: 'lobby', query: to.params.code ? { room: to.params.code } : {} };
  }

  if (to.name === 'game' && !game.currentTrack) {
    return game.roomCode
      ? { name: 'waiting', params: { code: game.roomCode } }
      : { name: 'lobby' };
  }

  return true;
});

export default router;
