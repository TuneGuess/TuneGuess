<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAccountStore } from '@/stores/account';

const account = useAccountStore();
const router = useRouter();
const open = ref(false);

onMounted(() => account.ensureLoaded());

async function logout() {
  open.value = false;
  await account.logout();
  router.push('/');
}
</script>

<template>
  <RouterLink v-if="account.loaded && !account.isLoggedIn" to="/connexion"
    class="px-3 py-1.5 text-xs sm:text-sm rounded-full bg-blue-900/30 text-blue-300 hover:bg-blue-900/50 transition">
    Connexion
  </RouterLink>
  <div v-else-if="account.isLoggedIn" class="relative" @keydown.escape="open = false">
    <button class="flex items-center gap-2 rounded-full px-2 py-1 hover:bg-gray-800 transition" :aria-expanded="open" aria-haspopup="menu" @click="open = !open">
      <img v-if="account.user.avatarUrl" :src="account.user.avatarUrl" alt="" class="h-7 w-7 rounded-full" referrerpolicy="no-referrer" />
      <span v-else class="grid h-7 w-7 place-items-center rounded-full bg-slate-700 text-xs font-semibold">{{ account.user.displayName.slice(0, 1).toUpperCase() }}</span>
      <span class="hidden sm:inline text-sm">{{ account.handle || account.user.displayName }}</span>
    </button>
    <div v-if="open" role="menu" class="absolute right-0 mt-2 w-48 rounded-2xl border border-slate-700 bg-slate-900 p-1 shadow-xl" @click="open = false">
      <RouterLink role="menuitem" to="/compte" class="block rounded-xl px-3 py-2 text-sm hover:bg-slate-800">Mon compte</RouterLink>
      <RouterLink v-if="account.isAdmin" role="menuitem" to="/admin" class="block rounded-xl px-3 py-2 text-sm hover:bg-slate-800">Administration</RouterLink>
      <button role="menuitem" class="block w-full rounded-xl px-3 py-2 text-left text-sm text-rose-300 hover:bg-slate-800" @click="logout">Déconnexion</button>
    </div>
  </div>
</template>
