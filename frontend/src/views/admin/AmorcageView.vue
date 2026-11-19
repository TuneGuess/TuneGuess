<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAccountStore } from '@/stores/account';
import { api } from '@/services/account';

const account = useAccountStore();
const router = useRouter();
const code = ref('');
const passkeyName = ref('');
const error = ref('');
const busy = ref(false);

onMounted(() => account.ensureLoaded());

async function step(fn) {
  busy.value = true;
  error.value = '';
  try {
    await fn();
  } catch (err) {
    if (err?.name !== 'NotAllowedError') error.value = err.code === 'RATE_LIMITED' ? 'Trop d\'essais : patiente 15 minutes.' : err.message;
  } finally {
    busy.value = false;
  }
}
const submitCode = () => step(async () => {
  const { user } = await api('/api/admin/amorcage', { method: 'POST', body: { code: code.value.trim() } });
  account.setUser(user);
  code.value = '';
});
const registerPasskey = () => step(async () => {
  await account.registerPasskey(passkeyName.value || 'Passkey admin');
  router.replace('/compte/bienvenue');
});
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 px-4 py-8">
    <main class="mx-auto max-w-lg rounded-3xl border border-slate-700 bg-slate-900/80 p-6">
      <h1 class="text-2xl font-semibold">Amorçage de l'administration</h1>

      <form v-if="!account.user?.bootstrap" class="mt-4 grid gap-4" @submit.prevent="submitCode">
        <p class="text-sm text-slate-400">
          Au premier démarrage, le serveur affiche dans ses logs un code d'accès à usage unique. Saisis-le ici pour créer le compte administrateur.
          Pour en générer un nouveau : redémarre le backend avec <code>ADMIN_BOOTSTRAP_RESET=1</code>.
        </p>
        <label class="grid gap-2 text-sm text-slate-300">Code d'amorçage
          <input v-model="code" autocomplete="one-time-code" spellcheck="false" required
            class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono outline-none focus:border-cyan-500" />
        </label>
        <button class="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50" :disabled="busy">Valider le code</button>
      </form>

      <form v-else class="mt-4 grid gap-4" @submit.prevent="registerPasskey">
        <p class="text-sm text-slate-400">
          Code accepté. Cette session ne permet qu'une chose : enregistrer la passkey qui protégera l'administration.
          Tu pourras ensuite valider ton accès Tailscale et lier Google.
        </p>
        <label class="grid gap-2 text-sm text-slate-300">Nom de l'appareil
          <input v-model="passkeyName" maxlength="40" placeholder="PC de bureau"
            class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-cyan-500" />
        </label>
        <button class="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50" :disabled="busy">Enregistrer ma passkey</button>
      </form>

      <p v-if="error" role="alert" class="mt-4 text-sm text-rose-400">{{ error }}</p>
    </main>
  </div>
</template>
