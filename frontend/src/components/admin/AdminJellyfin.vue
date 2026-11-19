<script setup>
import { onMounted, ref } from 'vue';
import { api } from '@/services/account';

const enabled = ref(true);
const error = ref('');

async function load() {
  const { values } = await api('/api/admin/config');
  enabled.value = values.jellyfinEnabled !== 'false';
}
async function toggle() {
  error.value = '';
  try {
    await api('/api/admin/config', { method: 'PUT', body: { jellyfinEnabled: !enabled.value } });
    await load();
  } catch (err) {
    error.value = err.message;
  }
}
onMounted(() => load().catch((err) => { error.value = err.message; }));
</script>

<template>
  <section class="rounded-3xl border border-slate-700 bg-slate-900/80 p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold">Jellyfin</h2>
      <button class="rounded-full border border-slate-600 px-4 py-1.5 text-sm" role="switch" :aria-checked="enabled" @click="toggle">
        {{ enabled ? 'Activé' : 'Désactivé' }}
      </button>
    </div>
    <div class="mt-3 grid gap-2 text-sm text-slate-400">
      <p>Les joueurs relient leur propre serveur Jellyfin par QuickConnect depuis leur compte : ils saisissent l'URL, TuneGuess affiche un code à valider dans Jellyfin. Le jeton reste chiffré sur ce serveur et l'audio passe par le proxy de TuneGuess.</p>
      <p>QuickConnect doit être activé sur le serveur Jellyfin du joueur (Tableau de bord → Général → QuickConnect).</p>
      <p>Par sécurité, les adresses de réseau local (192.168.x.x, 10.x.x.x…) sont refusées. En auto-hébergement, tu peux les autoriser avec la variable <code>JELLYFIN_ALLOW_PRIVATE_NETWORK=true</code>.</p>
    </div>
    <p v-if="error" role="alert" class="mt-3 text-sm text-rose-400">{{ error }}</p>
  </section>
</template>
