import { createRouter, createWebHistory } from 'vue-router';
import { useGameStore } from '@/stores/game';
import LobbyView from '@/views/LobbyView.vue';
import WaitingView from '@/views/WaitingView.vue';
import GameView from '@/views/GameView.vue';
import CreditsView from '@/views/CreditsView.vue';
import LegalView from '@/views/LegalView.vue';
import AdminView from '@/views/admin/AdminView.vue';
import NotFoundView from '@/views/NotFoundView.vue';

function isLocalOrTailscale(hostname) {
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return true;
  }
  if (hostname.endsWith('.ts.net')) {
    return true;
  }
  // Tailscale IP range (100.64.0.0/10)
  const isTailscaleIP = /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(hostname);
  if (isTailscaleIP) {
    return true;
  }
  // Local network IP ranges (192.168.x.x, 10.x.x.x, 172.16.x.x - 172.31.x.x)
  const isLocalIP = /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
                    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
                    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);
  if (isLocalIP) {
    return true;
  }
  // Hostname without dots
  if (!hostname.includes('.')) {
    return true;
  }
  return false;
}

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
      path: '/admin',
      name: 'admin',
      component: AdminView,
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

  if (to.name === 'admin') {
    if (!isLocalOrTailscale(window.location.hostname)) {
      return { name: 'not-found' };
    }
  }

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
