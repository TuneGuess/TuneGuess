<script setup>
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAccountStore } from '@/stores/account';
import { api } from '@/services/account';
import { USERNAME_RE } from '@/utils/identifiant';

const account = useAccountStore();
const router = useRouter();
const username = ref('');
const status = ref({ state: 'idle', message: '' });
const saving = ref(false);
let timer = null;
let seq = 0;

const REASONS = {
  USERNAME_TAKEN: 'Déjà pris.',
  USERNAME_RESERVED: 'Ce nom est réservé.',
  USERNAME_INVALID: '3 à 20 caractères : lettres minuscules, chiffres, _ et .',
  RATE_LIMITED: 'Trop de vérifications : patiente un instant.',
};

onMounted(async () => {
  await account.ensureLoaded();
  if (!account.isLoggedIn) return router.replace('/connexion');
  if (!account.user.needsUsername) return router.replace('/compte');
  const { username: suggestion } = await api('/api/compte/identifiant/suggestion');
  username.value = suggestion;
});

// Vérification en direct, avec un délai pour ne pas appeler l'API à chaque touche.
watch(username, (value) => {
  clearTimeout(timer);
  const v = value.trim().toLowerCase();
  if (!USERNAME_RE.test(v)) {
    status.value = { state: 'bad', message: REASONS.USERNAME_INVALID };
    return;
  }
  status.value = { state: 'checking', message: 'Vérification…' };
  const mine = ++seq;
  timer = setTimeout(async () => {
    try {
      const r = await api(`/api/compte/identifiant/disponible?u=${encodeURIComponent(v)}`);
      if (mine !== seq) return;
      status.value = r.available ? { state: 'ok', message: 'Disponible.' } : { state: 'bad', message: REASONS[r.reason] || r.message };
    } catch (err) {
      if (mine === seq) status.value = { state: 'bad', message: REASONS[err.code] || err.message };
    }
  }, 350);
});

async function save() {
  saving.value = true;
  try {
    const { user } = await api('/api/compte/identifiant', { method: 'POST', body: { username: username.value } });
    account.setUser(user);
    router.replace('/compte/connexions');
  } catch (err) {
    status.value = { state: 'bad', message: REASONS[err.code] || err.message };
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="mx-auto w-full max-w-md px-4 py-10">
    <form class="flat-card-sm p-6 sm:p-8" @submit.prevent="save">
      <h1 class="text-2xl font-bold mb-2">Choisis ton identifiant</h1>
      <p class="opacity-70 text-sm mb-6">
        Il te représente dans les salons et l'historique des autres joueurs. Tu pourras le changer plus tard.
      </p>
      <label for="identifiant" class="block text-sm font-semibold mb-2">Identifiant</label>
      <div class="flex items-center gap-2">
        <span aria-hidden="true" class="text-xl opacity-70">@</span>
        <input
          id="identifiant" v-model="username" class="input-flat w-full px-3 py-2 rounded-lg" maxlength="20"
          autocomplete="username" autocapitalize="none" spellcheck="false" aria-describedby="identifiant-etat" required
        />
      </div>
      <p id="identifiant-etat" aria-live="polite" class="mt-2 min-h-5 text-sm"
        :class="{ 'text-emerald-300': status.state === 'ok', 'text-rose-300': status.state === 'bad', 'opacity-70': status.state === 'checking' }">
        {{ status.message }}
      </p>
      <button type="submit" class="btn-primary mt-4 w-full py-3 rounded-lg font-semibold" :disabled="saving || status.state !== 'ok'">
        {{ saving ? 'Enregistrement…' : 'Continuer' }}
      </button>
    </form>
  </main>
</template>
