<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAccountStore } from '@/stores/account';
import { OAUTH_ERRORS, oauthUrl } from '@/services/account';

const account = useAccountStore();
const route = useRoute();
const router = useRouter();
const busy = ref(false);
const error = ref('');

const oauthError = computed(() => {
  const code = route.query.erreur;
  return code ? OAUTH_ERRORS[code] || 'La connexion a échoué.' : '';
});

onMounted(async () => {
  await account.ensureLoaded();
  if (account.isLoggedIn) router.replace(account.user.needsUsername ? '/compte/bienvenue' : '/compte');
});

async function passkey() {
  busy.value = true;
  error.value = '';
  try {
    await account.loginWithPasskey();
    router.push(account.user?.needsUsername ? '/compte/bienvenue' : '/compte');
  } catch (err) {
    // Annulation par l'utilisateur : pas d'erreur à afficher.
    error.value = err?.name === 'NotAllowedError' ? '' : err.message || 'Passkey refusée.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="mx-auto w-full max-w-md px-4 py-10">
    <section class="flat-card-sm p-6 sm:p-8">
      <h1 class="text-2xl font-bold mb-2">Se connecter</h1>
      <p class="opacity-70 text-sm mb-6">
        Un compte garde ton historique de parties et tes sources musicales. Pas besoin de compte pour jouer en invité.
      </p>

      <p v-if="oauthError" role="alert" class="mb-4 rounded-lg border-2 border-rose-400 px-3 py-2 text-sm text-rose-300">{{ oauthError }}</p>

      <div class="grid gap-3">
        <a v-if="account.providers.google" :href="oauthUrl('google')" class="btn-primary text-center py-3 rounded-lg font-semibold">
          Continuer avec Google
        </a>
        <p v-else class="text-sm opacity-70">La connexion Google n'est pas encore configurée sur ce serveur.</p>
        <button type="button" class="btn-secondary py-3 rounded-lg font-semibold" :disabled="busy" @click="passkey">
          {{ busy ? 'Vérification…' : 'Se connecter avec une passkey' }}
        </button>
      </div>
      <p v-if="error" role="alert" class="mt-4 text-sm text-rose-300">{{ error }}</p>

      <p class="mt-6 text-xs opacity-60">
        TuneGuess ne demande à Google que ton nom, ton e-mail et ta photo. Tes sources musicales (Last.fm, Jellyfin, YouTube) se relient ensuite depuis ton compte.
      </p>
    </section>
  </main>
</template>
