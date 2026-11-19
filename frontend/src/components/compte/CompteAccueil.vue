<script setup>
import { computed, onMounted, ref } from 'vue';
import { useAccountStore } from '@/stores/account';
import { api } from '@/services/account';
import { PROVIDER_LABELS } from '@/utils/fournisseurs';

const account = useAccountStore();
const data = ref(null);
const error = ref('');
const editing = ref(false);
const form = ref({ displayName: '', username: '' });
const saving = ref(false);

async function load() {
  try {
    data.value = await api('/api/compte/accueil');
  } catch (err) {
    error.value = err.message;
  }
}
onMounted(load);

const stats = computed(() => {
  const s = data.value?.stats;
  if (!s) return [];
  return [
    { label: 'Parties jouées', value: s.played },
    { label: 'Victoires', value: s.wins },
    { label: 'Bonnes réponses', value: s.accuracy === null ? '–' : `${Math.round(s.accuracy * 100)} %` },
    { label: 'Temps de réaction moyen', value: s.avgReactionMs === null ? '–' : `${(s.avgReactionMs / 1000).toFixed(1)} s` },
    { label: 'Meilleur score', value: s.bestScore },
  ];
});
const sources = computed(() => (data.value?.connections.providers || []).filter((p) => p.provider !== 'google'));

function startEdit() {
  form.value = { displayName: account.user.displayName, username: account.user.username };
  editing.value = true;
}

async function save() {
  saving.value = true;
  error.value = '';
  try {
    if (form.value.username.trim().toLowerCase() !== account.user.username) {
      account.setUser((await api('/api/compte/identifiant', { method: 'POST', body: { username: form.value.username } })).user);
    }
    account.setUser((await api('/api/compte/profil', { method: 'PATCH', body: { displayName: form.value.displayName } })).user);
    editing.value = false;
  } catch (err) {
    error.value = err.code === 'USERNAME_TAKEN' ? 'Cet identifiant est déjà pris.' : err.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="grid gap-6">
    <section class="flat-card-sm p-5 flex flex-wrap items-center gap-4">
      <img v-if="account.user.avatarUrl" :src="account.user.avatarUrl" alt="" class="h-16 w-16 rounded-full object-cover" referrerpolicy="no-referrer" />
      <div v-else aria-hidden="true" class="h-16 w-16 rounded-full bg-[var(--color-blue-main)] grid place-items-center text-2xl font-bold">
        {{ account.user.displayName.slice(0, 1).toUpperCase() }}
      </div>
      <div v-if="!editing" class="flex-1 min-w-0">
        <p class="text-xl font-bold truncate">{{ account.user.displayName }}</p>
        <p class="opacity-70">{{ account.handle }}</p>
      </div>
      <form v-else class="flex-1 grid gap-2 sm:grid-cols-2" @submit.prevent="save">
        <label class="text-sm">Pseudo
          <input v-model="form.displayName" maxlength="20" class="input-flat mt-1 w-full px-3 py-2 rounded-lg" required />
        </label>
        <label class="text-sm">Identifiant
          <input v-model="form.username" maxlength="20" autocapitalize="none" spellcheck="false" class="input-flat mt-1 w-full px-3 py-2 rounded-lg" required />
        </label>
        <div class="sm:col-span-2 flex gap-2">
          <button class="btn-primary px-4 py-2 rounded-lg" :disabled="saving">Enregistrer</button>
          <button type="button" class="btn-secondary px-4 py-2 rounded-lg" @click="editing = false">Annuler</button>
        </div>
      </form>
      <button v-if="!editing" type="button" class="btn-secondary px-4 py-2 rounded-lg text-sm" @click="startEdit">Modifier</button>
    </section>
    <p v-if="error" role="alert" class="text-sm text-rose-300">{{ error }}</p>

    <section aria-labelledby="stats-titre">
      <h2 id="stats-titre" class="text-lg font-bold mb-3">Statistiques</h2>
      <dl class="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div v-for="s in stats" :key="s.label" class="flat-card-sm p-4">
          <dt class="text-xs opacity-70">{{ s.label }}</dt>
          <dd class="text-2xl font-bold mt-1">{{ s.value }}</dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="sources-titre">
      <h2 id="sources-titre" class="text-lg font-bold mb-3">Sources connectées</h2>
      <p v-if="data && !sources.length" class="opacity-70 text-sm">
        Aucune source pour l'instant.
        <RouterLink to="/compte/connexions" class="underline">Relie Last.fm, Jellyfin ou YouTube</RouterLink>
        pour jouer avec tes morceaux.
      </p>
      <ul class="grid gap-2">
        <li v-for="s in sources" :key="s.provider" class="flat-card-sm px-4 py-3 flex justify-between gap-3">
          <span>{{ PROVIDER_LABELS[s.provider] }} <span class="opacity-60">· {{ s.label }}</span></span>
          <span class="opacity-80">{{ s.trackCount ?? '?' }} pistes</span>
        </li>
      </ul>
    </section>
  </div>
</template>
