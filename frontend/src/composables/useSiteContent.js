import { ref, shallowRef } from 'vue';

const cache = new Map();

/**
 * Charge un fichier JSON depuis /content/{slug}.json (public/).
 */
export function useSiteContent(slug) {
  const data = shallowRef(null);
  const loading = ref(true);
  const error = ref(null);

  async function load() {
    if (cache.has(slug)) {
      data.value = cache.get(slug);
      loading.value = false;
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      const res = await fetch(`/content/${slug}.json`);
      if (!res.ok) throw new Error(`Impossible de charger ${slug}.json`);
      const json = await res.json();
      cache.set(slug, json);
      data.value = json;
    } catch (e) {
      error.value = e.message ?? 'Erreur de chargement';
    } finally {
      loading.value = false;
    }
  }

  return { data, loading, error, load };
}
