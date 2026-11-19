<script setup>
import { onMounted, ref, watch } from 'vue';
import { api } from '@/services/account';
import { formatDate } from '@/utils/fournisseurs';

const users = ref([]);
const search = ref('');
const error = ref('');
let timer = null;

async function load() {
  try {
    users.value = await api(`/api/admin/users?q=${encodeURIComponent(search.value)}`);
  } catch (err) {
    error.value = err.message;
  }
}
// Code d'enrôlement : affiché une seule fois, le serveur n'en garde que l'empreinte.
const enrollment = ref(null);
async function update(user, patch) {
  error.value = '';
  try {
    const res = await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: patch });
    if (res.enrollment) enrollment.value = { ...res.enrollment, name: user.username ? '@' + user.username : user.displayName };
    await load();
  } catch (err) {
    error.value = err.message;
  }
}
watch(search, () => {
  clearTimeout(timer);
  timer = setTimeout(load, 250);
});
onMounted(load);
</script>

<template>
  <section class="rounded-3xl border border-slate-700 bg-slate-900/80 p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold">Utilisateurs</h2>
      <label class="text-sm text-slate-300">
        <span class="sr-only">Rechercher</span>
        <input v-model="search" type="search" placeholder="@identifiant ou pseudo" class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2" />
      </label>
    </div>
    <p v-if="error" role="alert" class="mt-3 text-sm text-rose-400">{{ error }}</p>
    <div v-if="enrollment" role="status" class="mt-3 rounded-2xl border border-cyan-600 bg-slate-950 p-4 text-sm">
      <p>Code d'enrôlement de <strong>{{ enrollment.name }}</strong>, valable jusqu'à {{ new Date(enrollment.expiresAt).toLocaleTimeString() }}, une seule fois :</p>
      <p class="mt-2 select-all break-all font-mono text-base text-cyan-300">{{ enrollment.code }}</p>
      <p class="mt-2 text-slate-400">
        Transmets-le par un autre canal (pas par le compte lui-même). La personne le saisit sur <code>/admin/enrolement</code> et crée sa passkey :
        le rôle admin ne s'active qu'à ce moment. Ce code ne sera plus affiché.
      </p>
      <button class="mt-2 rounded-full border border-slate-600 px-3 py-1" @click="enrollment = null">Masquer</button>
    </div>
    <div class="mt-4 overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-slate-400">
          <tr><th scope="col" class="py-2 pr-3">Compte</th><th scope="col" class="pr-3">Sources</th><th scope="col" class="pr-3">Créé le</th><th scope="col" class="pr-3">Rôle</th><th scope="col">État</th></tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id" class="border-t border-slate-800">
            <td class="py-2 pr-3">{{ u.displayName }} <span class="text-slate-400">{{ u.username ? '@' + u.username : '(identifiant à choisir)' }}</span></td>
            <td class="pr-3 text-slate-400">{{ u.providers || '–' }}<span v-if="u.passkeys"> · {{ u.passkeys }} passkey(s)</span></td>
            <td class="pr-3 text-slate-400">{{ formatDate(u.createdAt) }}</td>
            <td class="pr-3">
              <button class="rounded-full border border-slate-600 px-3 py-1" @click="update(u, { role: u.role === 'admin' ? 'user' : 'admin' })">
                {{ u.role === 'admin' ? 'Admin → retirer' : u.enrollPending ? 'Enrôlement en attente → nouveau code' : 'Joueur → promouvoir' }}
              </button>
              <button v-if="u.role !== 'admin' && u.enrollPending" class="ml-1 rounded-full border border-slate-600 px-3 py-1" @click="update(u, { role: 'user' })">Annuler</button>
            </td>
            <td>
              <button class="rounded-full border px-3 py-1" :class="u.disabled ? 'border-rose-500 text-rose-300' : 'border-slate-600'" @click="update(u, { disabled: !u.disabled })">
                {{ u.disabled ? 'Désactivé → réactiver' : 'Actif → désactiver' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
