<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '@/services/account';
import { formatDate } from '@/utils/fournisseurs';

const page = ref(1);
const data = ref({ items: [], total: 0, pageSize: 10 });
const detail = ref(null);
const error = ref('');
const pages = computed(() => Math.max(1, Math.ceil(data.value.total / data.value.pageSize)));

async function load(p = page.value) {
  try {
    data.value = await api(`/api/compte/historique?page=${p}`);
    page.value = data.value.page;
  } catch (err) {
    error.value = err.message;
  }
}
async function open(id) {
  try {
    detail.value = await api(`/api/compte/historique/${id}`);
  } catch (err) {
    error.value = err.message;
  }
}
onMounted(load);
</script>

<template>
  <div>
    <p v-if="error" role="alert" class="mb-3 text-sm text-rose-300">{{ error }}</p>

    <section v-if="detail" class="flat-card-sm p-5" aria-labelledby="detail-titre">
      <button class="btn-secondary px-3 py-1.5 rounded-lg text-sm mb-4" @click="detail = null">← Retour à l'historique</button>
      <h2 id="detail-titre" class="text-lg font-bold">{{ detail.game.roomName }}</h2>
      <p class="text-sm opacity-70">{{ formatDate(detail.game.endedAt) }} · {{ detail.game.rounds }} manches</p>
      <h3 class="mt-4 font-semibold">Classement</h3>
      <ol class="mt-2 grid gap-1">
        <li v-for="p in detail.players" :key="p.name + p.rank" class="flex justify-between gap-2" :class="{ 'font-bold': p.me }">
          <span>{{ p.rank }}. {{ p.name }} <span v-if="p.username" class="opacity-60">@{{ p.username }}</span></span>
          <span>{{ p.score }} pts</span>
        </li>
      </ol>
      <h3 class="mt-4 font-semibold">Manches</h3>
      <div class="overflow-x-auto">
        <table class="mt-2 w-full text-sm">
          <thead class="text-left opacity-70">
            <tr><th scope="col" class="py-1 pr-3">#</th><th scope="col" class="pr-3">Morceau</th><th scope="col" class="pr-3">De</th><th scope="col" class="pr-3">Ta réponse</th><th scope="col" class="pr-3">Temps</th><th scope="col">Points</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in detail.rounds" :key="r.no" class="border-t border-[var(--color-blue-main)]/40">
              <td class="py-1 pr-3">{{ r.no }}</td>
              <td class="pr-3">{{ r.trackName }} <span class="opacity-60">– {{ r.artists }}</span></td>
              <td class="pr-3">{{ r.ownerName }}</td>
              <td class="pr-3" :class="r.correct ? 'text-emerald-300' : 'text-rose-300'">
                {{ r.answerName ?? 'Pas de réponse' }}<span class="sr-only">{{ r.correct ? ' (juste)' : ' (faux)' }}</span>
              </td>
              <td class="pr-3">{{ r.timeMs == null ? '–' : `${(r.timeMs / 1000).toFixed(1)} s` }}</td>
              <td>{{ r.points ?? 0 }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <template v-else>
      <p v-if="!data.items.length" class="opacity-70">Aucune partie enregistrée pour l'instant.</p>
      <ul class="grid gap-2">
        <li v-for="g in data.items" :key="g.id">
          <button class="flat-card-sm w-full px-4 py-3 flex flex-wrap justify-between gap-2 text-left" @click="open(g.id)">
            <span><strong>{{ g.roomName }}</strong> <span class="opacity-60">· {{ formatDate(g.endedAt) }}</span></span>
            <span>{{ g.rank }}<sup>{{ g.rank === 1 ? 'er' : 'e' }}</sup> / {{ g.playerCount }} · {{ g.score }} pts</span>
          </button>
        </li>
      </ul>
      <nav v-if="pages > 1" aria-label="Pages de l'historique" class="mt-4 flex items-center gap-3">
        <button class="btn-secondary px-3 py-1.5 rounded-lg text-sm" :disabled="page <= 1" @click="load(page - 1)">Précédent</button>
        <span class="text-sm">Page {{ page }} / {{ pages }}</span>
        <button class="btn-secondary px-3 py-1.5 rounded-lg text-sm" :disabled="page >= pages" @click="load(page + 1)">Suivant</button>
      </nav>
    </template>
  </div>
</template>
