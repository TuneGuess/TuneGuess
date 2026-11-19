<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useAccountStore } from '@/stores/account';
import { api, OAUTH_ERRORS, oauthUrl } from '@/services/account';
import { formatDate, PROVIDER_LABELS } from '@/utils/fournisseurs';

const account = useAccountStore();
const route = useRoute();
const connections = ref({ providers: [] });
const message = ref(route.query.erreur ? OAUTH_ERRORS[route.query.erreur] || 'La liaison a échoué.' : '');
const notice = ref(route.query.ok ? `${PROVIDER_LABELS[route.query.ok] || 'Source'} reliée.` : '');
const busy = ref('');
const guide = ref(null);
const lastfmName = ref('');
const jellyfinUrl = ref('');
const qc = ref(null);
let pollTimer = null;

const byProvider = computed(() => Object.fromEntries(connections.value.providers.map((p) => [p.provider, p])));

async function run(key, fn) {
  busy.value = key;
  message.value = '';
  notice.value = '';
  try {
    await fn();
  } catch (err) {
    message.value = err.message;
  } finally {
    busy.value = '';
  }
}

const load = () => run('load', async () => { connections.value = await api('/api/compte/connexions'); });
const refresh = (p) => run(`refresh-${p}`, async () => {
  connections.value = await api(`/api/compte/connexions/${p}/rafraichir`, { method: 'POST', body: {} });
  notice.value = `${PROVIDER_LABELS[p]} rafraîchi.`;
});
const unlink = (p) => run(`unlink-${p}`, async () => {
  connections.value = await api(`/api/compte/connexions/${p}`, { method: 'DELETE' });
  notice.value = `${PROVIDER_LABELS[p]} déconnecté.`;
});
const linkLastfmByName = () => run('lastfm-name', async () => {
  connections.value = await api('/api/compte/lastfm/pseudo', { method: 'POST', body: { username: lastfmName.value } });
  notice.value = 'Last.fm relié.';
});

// QuickConnect : le serveur garde le secret, on n'affiche que le code puis on interroge l'état.
const startJellyfin = () => run('jellyfin', async () => {
  stopPolling();
  qc.value = await api('/api/compte/jellyfin/initiate', { method: 'POST', body: { serverUrl: jellyfinUrl.value } });
  pollTimer = setInterval(pollJellyfin, 3000);
});
async function pollJellyfin() {
  if (!qc.value) return;
  try {
    const r = await api('/api/compte/jellyfin/poll', { method: 'POST', body: { pendingId: qc.value.pendingId } });
    if (r.status === 'ok') {
      stopPolling();
      qc.value = null;
      connections.value = r.connections;
      notice.value = 'Jellyfin relié.';
    }
  } catch (err) {
    stopPolling();
    qc.value = null;
    message.value = err.message;
  }
}
function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

onMounted(async () => {
  load();
  guide.value = await fetch('/content/lastfm-guide.json').then((r) => r.json()).catch(() => null);
});
onBeforeUnmount(stopPolling);
</script>

<template>
  <div class="grid gap-4">
    <p v-if="message" role="alert" class="rounded-lg border-2 border-rose-400 px-3 py-2 text-sm text-rose-300">{{ message }}</p>
    <p v-if="notice" role="status" class="rounded-lg border-2 border-emerald-400 px-3 py-2 text-sm text-emerald-300">{{ notice }}</p>

    <!-- Google : c'est le compte lui-même -->
    <section class="flat-card-sm p-5" aria-labelledby="carte-google">
      <h2 id="carte-google" class="text-lg font-bold">Google <span class="text-xs opacity-60 font-normal">· connexion au compte</span></h2>
      <template v-if="byProvider.google">
        <p class="mt-1 text-sm">{{ byProvider.google.label }}</p>
        <p v-if="byProvider.google.email" class="text-sm opacity-70">E-mail (fourni par Google) : {{ byProvider.google.email }}</p>
        <p class="mt-2 text-xs opacity-60">Cette liaison est ton compte : elle ne se retire pas. Tu peux supprimer ton compte dans Sécurité.</p>
      </template>
      <p v-else class="mt-1 text-sm opacity-70">Aucun compte Google lié.
        <a v-if="account.providers.google" :href="oauthUrl('google', 'link')" class="underline">Lier Google</a>
      </p>
    </section>

    <!-- Last.fm : source principale -->
    <section class="flat-card-sm p-5 border-[var(--color-beige)]" aria-labelledby="carte-lastfm">
      <h2 id="carte-lastfm" class="text-lg font-bold">Last.fm <span class="text-xs opacity-60 font-normal">· source recommandée</span></h2>
      <p v-if="!account.providers.lastfm" class="mt-1 text-sm opacity-70">Last.fm n'est pas configuré sur ce serveur.</p>
      <template v-else-if="byProvider.lastfm">
        <p class="mt-1 text-sm">Relié à <strong>{{ byProvider.lastfm.label }}</strong> · {{ byProvider.lastfm.trackCount ?? '?' }} pistes</p>
        <p v-if="byProvider.lastfm.status === 'invalid'" class="text-sm text-rose-300">Profil illisible : vérifie le pseudo ou reconnecte.</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button class="btn-secondary px-3 py-1.5 rounded-lg text-sm" :disabled="!!busy" @click="refresh('lastfm')">Rafraîchir</button>
          <button class="btn-secondary px-3 py-1.5 rounded-lg text-sm" :disabled="!!busy" @click="unlink('lastfm')">Déconnecter</button>
        </div>
      </template>
      <template v-else>
        <div class="mt-3 flex flex-wrap items-end gap-3">
          <a v-if="account.providers.lastfmAuth" :href="oauthUrl('lastfm', 'link')" class="btn-primary px-4 py-2 rounded-lg font-semibold">Se connecter à Last.fm</a>
          <form class="flex flex-wrap items-end gap-2" @submit.prevent="linkLastfmByName">
            <label class="text-sm">{{ account.providers.lastfmAuth ? 'ou ton pseudo Last.fm' : 'Ton pseudo Last.fm' }}
              <input v-model="lastfmName" maxlength="15" autocapitalize="none" spellcheck="false" class="input-flat mt-1 block px-3 py-2 rounded-lg" required />
            </label>
            <button class="btn-secondary px-4 py-2 rounded-lg" :disabled="busy === 'lastfm-name'">Relier</button>
          </form>
        </div>
      </template>

      <details v-if="guide" class="mt-4">
        <summary class="cursor-pointer font-semibold">{{ guide.title }}</summary>
        <p class="mt-2 text-sm opacity-80">{{ guide.intro }}</p>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <div v-for="p in guide.platforms" :key="p.name" class="rounded-lg border border-[var(--color-blue-main)] p-3">
            <h3 class="font-semibold">{{ p.name }}</h3>
            <ol class="mt-1 list-decimal pl-5 text-sm opacity-90">
              <li v-for="(s, i) in p.steps" :key="i">{{ s }}</li>
            </ol>
            <a v-if="p.link" :href="p.link.url" target="_blank" rel="noopener noreferrer" class="mt-2 inline-block text-sm underline">{{ p.link.label }}</a>
          </div>
        </div>
        <p class="mt-3 text-sm font-semibold">{{ guide.note }}</p>
      </details>
    </section>

    <!-- Jellyfin -->
    <section class="flat-card-sm p-5" aria-labelledby="carte-jellyfin">
      <h2 id="carte-jellyfin" class="text-lg font-bold">Jellyfin</h2>
      <p v-if="!account.providers.jellyfin" class="mt-1 text-sm opacity-70">Jellyfin est désactivé sur ce serveur.</p>
      <template v-else-if="byProvider.jellyfin">
        <p class="mt-1 text-sm">{{ byProvider.jellyfin.label }} · {{ byProvider.jellyfin.trackCount ?? '?' }} pistes</p>
        <p v-if="byProvider.jellyfin.status === 'invalid'" class="text-sm text-rose-300">Jeton refusé : déconnecte puis relance QuickConnect.</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button class="btn-secondary px-3 py-1.5 rounded-lg text-sm" :disabled="!!busy" @click="refresh('jellyfin')">Rafraîchir</button>
          <button class="btn-secondary px-3 py-1.5 rounded-lg text-sm" :disabled="!!busy" @click="unlink('jellyfin')">Déconnecter</button>
        </div>
      </template>
      <template v-else>
        <form v-if="!qc" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="startJellyfin">
          <label class="text-sm flex-1 min-w-56">Adresse de ton serveur
            <input v-model="jellyfinUrl" type="url" placeholder="https://jellyfin.example.com" class="input-flat mt-1 block w-full px-3 py-2 rounded-lg" required />
          </label>
          <button class="btn-primary px-4 py-2 rounded-lg" :disabled="busy === 'jellyfin'">QuickConnect</button>
        </form>
        <div v-else class="mt-3" role="status" aria-live="polite">
          <p class="text-sm">Dans Jellyfin, ouvre ton profil → QuickConnect et saisis ce code :</p>
          <p class="mt-2 text-3xl font-bold tracking-widest">{{ qc.code }}</p>
          <p class="mt-1 text-xs opacity-60">En attente de ton autorisation… (le code expire après 5 minutes)</p>
          <button class="btn-secondary mt-2 px-3 py-1.5 rounded-lg text-sm" @click="stopPolling(); qc = null">Annuler</button>
        </div>
      </template>
    </section>

    <!-- YouTube : source optionnelle, scope demandé seulement ici -->
    <section v-if="account.providers.youtube" class="flat-card-sm p-5" aria-labelledby="carte-youtube">
      <h2 id="carte-youtube" class="text-lg font-bold">YouTube <span class="text-xs opacity-60 font-normal">· optionnel</span></h2>
      <template v-if="byProvider.youtube">
        <p class="mt-1 text-sm">{{ byProvider.youtube.label }} · {{ byProvider.youtube.trackCount ?? '?' }} pistes</p>
        <p class="text-xs opacity-60">Jeton valable jusqu'au {{ formatDate(byProvider.youtube.expiresAt) }} (renouvelé automatiquement).</p>
        <p v-if="byProvider.youtube.status === 'invalid'" class="text-sm text-rose-300">Accès expiré : reconnecte YouTube.</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button class="btn-secondary px-3 py-1.5 rounded-lg text-sm" :disabled="!!busy" @click="refresh('youtube')">Rafraîchir</button>
          <a v-if="byProvider.youtube.status === 'invalid'" :href="oauthUrl('youtube', 'link')" class="btn-secondary px-3 py-1.5 rounded-lg text-sm">Reconnecter</a>
          <button class="btn-secondary px-3 py-1.5 rounded-lg text-sm" :disabled="!!busy" @click="unlink('youtube')">Déconnecter</button>
        </div>
      </template>
      <template v-else>
        <p class="mt-1 text-sm opacity-70">Utilise tes vidéos musicales aimées. Google te demandera l'accès en lecture à YouTube.</p>
        <a :href="oauthUrl('youtube', 'link')" class="btn-secondary mt-3 inline-block px-4 py-2 rounded-lg">Connecter YouTube</a>
      </template>
    </section>
  </div>
</template>
