<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAccountStore } from '@/stores/account';
import { api } from '@/services/account';
import { formatDate } from '@/utils/fournisseurs';

const account = useAccountStore();
const router = useRouter();
const sessions = ref([]);
const passkeys = ref([]);
const error = ref('');
const confirm = ref('');
const passkeyName = ref('');

async function load() {
  try {
    [sessions.value, passkeys.value] = await Promise.all([api('/api/compte/sessions'), api('/api/compte/passkeys')]);
  } catch (err) {
    error.value = err.message;
  }
}
async function act(fn) {
  error.value = '';
  try {
    await fn();
    await load();
  } catch (err) {
    if (err?.name !== 'NotAllowedError') error.value = err.message;
  }
}
const revoke = (id) => act(() => api(`/api/compte/sessions/${id}`, { method: 'DELETE' }));
const removePasskey = (id) => act(() => api(`/api/compte/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }));
const addPasskey = () => act(async () => {
  await account.registerPasskey(passkeyName.value || 'Passkey');
  passkeyName.value = '';
});
async function deleteAccount() {
  error.value = '';
  try {
    await api('/api/compte', { method: 'DELETE', body: { confirm: confirm.value.trim().replace(/^@/, '').toLowerCase() } });
    account.setUser(null);
    router.replace('/');
  } catch (err) {
    error.value = err.message;
  }
}
onMounted(load);
</script>

<template>
  <div class="grid gap-6">
    <p v-if="error" role="alert" class="text-sm text-rose-300">{{ error }}</p>

    <section aria-labelledby="sessions-titre">
      <h2 id="sessions-titre" class="text-lg font-bold mb-3">Sessions actives</h2>
      <ul class="grid gap-2">
        <li v-for="s in sessions" :key="s.id" class="flat-card-sm px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <span class="min-w-0">
            <span class="block truncate text-sm">{{ s.userAgent || 'Navigateur inconnu' }}</span>
            <span class="text-xs opacity-60">{{ s.ip || 'IP inconnue' }} · vue le {{ formatDate(s.lastSeenAt) }}</span>
          </span>
          <span v-if="s.current" class="text-xs font-semibold">Cette session</span>
          <button v-else class="btn-secondary px-3 py-1.5 rounded-lg text-sm" @click="revoke(s.id)">Révoquer</button>
        </li>
      </ul>
    </section>

    <section aria-labelledby="passkeys-titre">
      <h2 id="passkeys-titre" class="text-lg font-bold mb-1">Passkeys</h2>
      <p class="text-sm opacity-70 mb-3">Une passkey permet de te connecter sans Google, avec ton empreinte, ton visage ou le code de ton appareil.</p>
      <ul class="grid gap-2 mb-3">
        <li v-for="p in passkeys" :key="p.id" class="flat-card-sm px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <span>{{ p.name }} <span class="text-xs opacity-60">· ajoutée le {{ formatDate(p.createdAt) }}</span></span>
          <button class="btn-secondary px-3 py-1.5 rounded-lg text-sm" @click="removePasskey(p.id)">Supprimer</button>
        </li>
      </ul>
      <form class="flex flex-wrap items-end gap-2" @submit.prevent="addPasskey">
        <label class="text-sm">Nom de l'appareil
          <input v-model="passkeyName" maxlength="40" placeholder="Mon téléphone" class="input-flat mt-1 block px-3 py-2 rounded-lg" />
        </label>
        <button class="btn-secondary px-4 py-2 rounded-lg">Ajouter une passkey</button>
      </form>
    </section>

    <section aria-labelledby="suppression-titre" class="flat-card-sm p-5 border-rose-400">
      <h2 id="suppression-titre" class="text-lg font-bold">Supprimer mon compte</h2>
      <p class="mt-1 text-sm opacity-80">Ton compte, tes sources et tes sessions sont supprimés. Ton nom reste dans le classement des parties passées des autres joueurs, sans lien vers toi.</p>
      <form class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="deleteAccount">
        <label class="text-sm">Saisis <strong>{{ account.handle }}</strong> pour confirmer
          <input v-model="confirm" autocapitalize="none" spellcheck="false" class="input-flat mt-1 block px-3 py-2 rounded-lg" required />
        </label>
        <button class="rounded-lg bg-rose-500 px-4 py-2 font-semibold text-white disabled:opacity-50"
          :disabled="confirm.trim().replace(/^@/, '').toLowerCase() !== account.user.username">Supprimer définitivement</button>
      </form>
    </section>
  </div>
</template>
