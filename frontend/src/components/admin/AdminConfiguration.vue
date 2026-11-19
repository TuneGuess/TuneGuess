<script setup>
import { onMounted, ref } from 'vue';
import { api } from '@/services/account';
import BaremeApercu from '@/components/BaremeApercu.vue';

const config = ref(null);
const form = ref({});
const game = ref(null);
const error = ref('');
const notice = ref('');

// Champs par carte ; les secrets ne sont jamais renvoyés : vide = inchangé.
const CARDS = [
  { title: 'Général', fields: [{ key: 'publicUrl', label: 'URL publique du site' }] },
  {
    title: 'Google (connexion des joueurs)', callbacks: ['google'],
    help: 'Scopes demandés : openid, email, profile (non sensibles, aucune vérification Google requise).',
    fields: [{ key: 'googleClientId', label: 'Client ID' }, { key: 'googleClientSecret', label: 'Client secret', secret: true }],
  },
  {
    title: 'YouTube (source optionnelle)', callbacks: ['youtube'], toggle: 'youtubeEnabled',
    help: 'Utilise le client Google ci-dessus. Le scope youtube.readonly est « sensible » : tant que l\'application n\'est pas vérifiée par Google, seuls 100 utilisateurs de test (déclarés dans la console Google Cloud) peuvent connecter YouTube. Désactive la source si tu ne passes pas la vérification.',
    fields: [],
  },
  {
    title: 'Last.fm (source principale)', callbacks: ['lastfm'],
    help: 'La clé seule permet la liaison par pseudo ; la clé + le secret activent la connexion Last.fm (web auth signée).',
    fields: [{ key: 'lastfmApiKey', label: 'API key' }, { key: 'lastfmApiSecret', label: 'Shared secret', secret: true }],
  },
];

async function load() {
  config.value = await api('/api/admin/config');
  form.value = Object.fromEntries(Object.entries(config.value.values).map(([k, v]) => [k, typeof v === 'object' && v !== null ? '' : v]));
  game.value = { ...config.value.gameDefaults };
}
onMounted(() => load().catch((err) => { error.value = err.message; }));

async function save(body) {
  error.value = '';
  notice.value = '';
  try {
    await api('/api/admin/config', { method: 'PUT', body });
    notice.value = 'Enregistré.';
    await load();
  } catch (err) {
    error.value = err.message;
  }
}
const saveCard = (card) => save(Object.fromEntries(card.fields.map((f) => [f.key, form.value[f.key] ?? ''])));
const clearSecret = (key) => save({ [key]: null });
const toggle = (key) => save({ [key]: form.value[key] === 'false' });
</script>

<template>
  <div v-if="config" class="grid gap-6">
    <p v-if="error" role="alert" class="text-sm text-rose-400">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm text-emerald-400">{{ notice }}</p>

    <section v-for="card in CARDS" :key="card.title" class="rounded-3xl border border-slate-700 bg-slate-900/80 p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-lg font-semibold">{{ card.title }}</h2>
        <button v-if="card.toggle" class="rounded-full border border-slate-600 px-4 py-1.5 text-sm" role="switch"
          :aria-checked="form[card.toggle] !== 'false'" @click="toggle(card.toggle)">
          {{ form[card.toggle] !== 'false' ? 'Activée' : 'Désactivée' }}
        </button>
      </div>
      <p v-if="card.help" class="mt-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">{{ card.help }}</p>
      <p v-for="cb in card.callbacks || []" :key="cb" class="mt-2 text-xs text-slate-400">
        URI de redirection à déclarer : <code class="select-all text-slate-200">{{ config.callbacks[cb] }}</code>
      </p>
      <form v-if="card.fields.length" class="mt-4 grid gap-3 sm:grid-cols-2" @submit.prevent="saveCard(card)">
        <label v-for="f in card.fields" :key="f.key" class="grid gap-1 text-sm text-slate-300">
          {{ f.label }}
          <input v-model="form[f.key]" :type="f.secret ? 'password' : 'text'" autocomplete="off"
            :placeholder="f.secret ? (config.values[f.key].set ? '•••••••• (inchangé)' : 'non défini') : ''"
            class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2 outline-none focus:border-cyan-500" />
          <button v-if="f.secret && config.values[f.key].set" type="button" class="justify-self-start text-xs text-rose-300 underline" @click="clearSecret(f.key)">Effacer</button>
        </label>
        <button class="sm:col-span-2 justify-self-start rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">Enregistrer</button>
      </form>
      <p v-if="card.callbacks && !config.providers[card.callbacks[0]]" class="mt-3 text-sm text-slate-400">
        Non configuré : le bouton correspondant est masqué pour les joueurs.
      </p>
    </section>

    <section class="rounded-3xl border border-slate-700 bg-slate-900/80 p-6">
      <h2 class="text-lg font-semibold">Réglages de partie par défaut</h2>
      <form class="mt-4 grid gap-3 sm:grid-cols-3" @submit.prevent="save({ gameDefaults: game })">
        <label class="grid gap-1 text-sm text-slate-300">Manches
          <input v-model.number="game.maxRounds" type="number" min="1" max="50" class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2" />
        </label>
        <label class="grid gap-1 text-sm text-slate-300">Durée d'une manche (s)
          <input v-model.number="game.roundDuration" type="number" min="10" max="120" class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2" />
        </label>
        <label class="grid gap-1 text-sm text-slate-300">Délai de grâce (s)
          <input v-model.number="game.delaiGrace" type="number" min="0" max="30" step="0.1" class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2" />
        </label>
        <label class="grid gap-1 text-sm text-slate-300">Points max
          <input v-model.number="game.pointsMax" type="number" min="10" max="10000" class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2" />
        </label>
        <label class="grid gap-1 text-sm text-slate-300">Points min
          <input v-model.number="game.pointsMin" type="number" min="0" :max="game.pointsMax" class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2" />
        </label>
        <label class="flex items-center gap-2 text-sm text-slate-300">
          <input v-model="game.bonusPremier" type="checkbox" /> Bonus premier (+20 %)
        </label>
        <BaremeApercu class="sm:col-span-3" :scoring="game" :duration="game.roundDuration" />
        <button class="justify-self-start rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">Enregistrer</button>
      </form>
    </section>
  </div>
</template>
