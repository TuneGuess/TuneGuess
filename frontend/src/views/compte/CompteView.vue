<script setup>
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAccountStore } from '@/stores/account';
import CompteAccueil from '@/components/compte/CompteAccueil.vue';
import CompteConnexions from '@/components/compte/CompteConnexions.vue';
import CompteHistorique from '@/components/compte/CompteHistorique.vue';
import CompteSecurite from '@/components/compte/CompteSecurite.vue';

const TABS = [
  { id: 'accueil', label: 'Accueil', component: CompteAccueil },
  { id: 'connexions', label: 'Connexions', component: CompteConnexions },
  { id: 'historique', label: 'Historique', component: CompteHistorique },
  { id: 'securite', label: 'Sécurité', component: CompteSecurite },
];

const account = useAccountStore();
const route = useRoute();
const router = useRouter();
const current = computed(() => TABS.find((t) => t.id === route.params.onglet) || TABS[0]);

onMounted(async () => {
  await account.ensureLoaded();
  if (!account.isLoggedIn) return router.replace('/connexion');
  if (account.user.bootstrap) return router.replace('/admin/amorcage');
  if (account.user.needsUsername) return router.replace('/compte/bienvenue');
});
</script>

<template>
  <main v-if="account.user && !account.user.needsUsername" class="mx-auto w-full max-w-4xl px-4 py-6">
    <h1 class="sr-only">Mon compte</h1>
    <nav aria-label="Sections du compte" class="mb-6 flex flex-wrap gap-2">
      <RouterLink
        v-for="tab in TABS" :key="tab.id" :to="`/compte/${tab.id}`"
        class="tab-pill px-4 py-2 rounded-full text-sm" :class="{ 'tab-pill-active': current.id === tab.id }"
        :aria-current="current.id === tab.id ? 'page' : undefined"
      >
        {{ tab.label }}
      </RouterLink>
    </nav>
    <component :is="current.component" />
  </main>
</template>
