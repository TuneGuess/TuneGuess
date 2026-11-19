<script setup>
import { onMounted, ref } from 'vue';
import { useAccountStore } from '@/stores/account';
import { api } from '@/services/account';
import { formatDate } from '@/utils/fournisseurs';

const account = useAccountStore();
const data = ref(null);
const error = ref('');
const passkeyName = ref('');

async function load() {
  data.value = await api('/api/admin/securite');
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
const validateTailscale = () => act(() => api('/api/admin/tailscale/valider', { method: 'POST', body: {} }));
const resetTailscale = () => act(() => api('/api/admin/tailscale', { method: 'DELETE' }));
const addPasskey = () => act(() => account.registerPasskey(passkeyName.value || 'Passkey de secours'));
const removePasskey = (id) => act(() => api(`/api/compte/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }));
onMounted(() => load().catch((err) => { error.value = err.message; }));
</script>

<template>
  <div v-if="data" class="grid gap-6">
    <p v-if="error" role="alert" class="text-sm text-rose-400">{{ error }}</p>

    <section class="rounded-3xl border border-slate-700 bg-slate-900/80 p-6">
      <h2 class="text-lg font-semibold">Accès Tailscale</h2>
      <p class="mt-2 text-sm text-slate-400">
        Une fois validé, ta session admin depuis une adresse Tailscale (100.64.0.0/10) donne accès directement, sans passkey.
        Hors Tailscale, une confirmation par passkey reste demandée (valable 12 h, perdue si tu quittes Tailscale).
      </p>
      <p class="mt-3 text-sm">
        Adresse vue par le serveur : <code>{{ data.tailscale.ip || 'inconnue' }}</code>
        <span :class="data.tailscale.onTailscale ? 'text-emerald-400' : 'text-amber-300'">
          ({{ data.tailscale.onTailscale ? 'Tailscale' : 'hors Tailscale' }})
        </span>
      </p>
      <p class="mt-1 text-sm">État : {{ data.tailscale.validatedAt ? `validé le ${formatDate(data.tailscale.validatedAt)}` : 'non validé' }}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button class="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50" :disabled="!data.tailscale.onTailscale" @click="validateTailscale">
          Valider mon accès Tailscale
        </button>
        <button v-if="data.tailscale.validatedAt" class="rounded-2xl border border-slate-600 px-4 py-2 text-sm" @click="resetTailscale">Retirer la validation</button>
      </div>
      <p v-if="!data.tailscale.onTailscale" class="mt-2 text-xs text-slate-500">
        Derrière un proxy (Docker/nginx), le serveur ne voit l'adresse réelle que si <code>TRUST_PROXY</code> est défini.
      </p>
    </section>

    <section class="rounded-3xl border border-slate-700 bg-slate-900/80 p-6">
      <h2 class="text-lg font-semibold">Mes passkeys</h2>
      <p class="mt-1 text-sm text-slate-400">Ajoute une passkey de secours. La dernière ne peut pas être révoquée tant que Tailscale n'est pas validé.</p>
      <ul class="mt-3 grid gap-2">
        <li v-for="p in data.passkeys" :key="p.id" class="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 px-4 py-2 text-sm">
          <span>{{ p.name }} <span class="text-slate-500">· utilisée {{ p.lastUsedAt ? formatDate(p.lastUsedAt) : 'jamais' }}</span></span>
          <button class="text-rose-300 underline" @click="removePasskey(p.id)">Révoquer</button>
        </li>
      </ul>
      <form class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="addPasskey">
        <label class="grid gap-1 text-sm text-slate-300">Nom
          <input v-model="passkeyName" maxlength="40" placeholder="Clé de secours" class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2" />
        </label>
        <button class="rounded-2xl border border-slate-600 px-4 py-2 text-sm">Ajouter une passkey</button>
      </form>
    </section>

    <section class="rounded-3xl border border-slate-700 bg-slate-900/80 p-6">
      <h2 class="text-lg font-semibold">Administrateurs</h2>
      <ul class="mt-3 grid gap-1 text-sm">
        <li v-for="a in data.admins" :key="a.id">
          {{ a.displayName }} <span class="text-slate-400">{{ a.username ? '@' + a.username : '' }}</span>
          <span v-if="a.disabled" class="text-rose-300">(désactivé)</span>
        </li>
      </ul>
      <p class="mt-2 text-xs text-slate-500">Promotion et rétrogradation depuis l'onglet Utilisateurs. Le dernier admin ne peut pas être rétrogradé.</p>
    </section>
  </div>
</template>
