<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAccountStore } from '@/stores/account';

const account = useAccountStore();
const router = useRouter();
const code = ref('');
const passkeyName = ref('');
const error = ref('');
const busy = ref(false);

onMounted(() => account.ensureLoaded());

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    await account.enrollAdmin(code.value.trim(), passkeyName.value || 'Passkey admin');
    router.replace('/admin');
  } catch (err) {
    if (err?.name !== 'NotAllowedError') error.value = err.code === 'RATE_LIMITED' ? 'Trop d\'essais : patiente 15 minutes.' : err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 px-4 py-8">
    <main class="mx-auto max-w-lg rounded-3xl border border-slate-700 bg-slate-900/80 p-6">
      <h1 class="text-2xl font-semibold">Devenir administrateur</h1>

      <p v-if="!account.user" class="mt-4 text-sm text-slate-400">
        Connecte-toi d'abord avec ton compte, puis reviens sur cette page.
        <RouterLink to="/connexion" class="text-cyan-400 underline">Connexion</RouterLink>
      </p>
      <p v-else-if="account.isAdmin" class="mt-4 text-sm text-slate-400">
        Tu es déjà administrateur. <RouterLink to="/admin" class="text-cyan-400 underline">Panneau admin</RouterLink>
      </p>
      <form v-else class="mt-4 grid gap-4" @submit.prevent="submit">
        <p class="text-sm text-slate-400">
          Saisis le code d'enrôlement qu'un administrateur t'a transmis (valable une heure, une seule fois),
          puis crée la passkey qui protégera ton accès admin. Le rôle s'active seulement après.
        </p>
        <label class="grid gap-2 text-sm text-slate-300">Code d'enrôlement
          <input v-model="code" autocomplete="one-time-code" spellcheck="false" required
            class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono outline-none focus:border-cyan-500" />
        </label>
        <label class="grid gap-2 text-sm text-slate-300">Nom de l'appareil
          <input v-model="passkeyName" maxlength="40" placeholder="PC de bureau"
            class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-cyan-500" />
        </label>
        <button class="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50" :disabled="busy">Valider et créer ma passkey</button>
      </form>

      <p v-if="error" role="alert" class="mt-4 text-sm text-rose-400">{{ error }}</p>
    </main>
  </div>
</template>
