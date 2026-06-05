<script setup>
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: null },
});
</script>

<template>
  <div class="flex flex-col gap-8 mt-2 pb-8 max-w-2xl mx-auto px-4">
    <header
      v-motion
      :initial="{ opacity: 0, y: 30 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 600 } }"
      class="text-center"
    >
      <RouterLink
        to="/"
        class="inline-flex items-center gap-2 text-xs text-[#555] font-bold uppercase tracking-widest hover:text-[var(--color-beige)] transition mb-6 group"
      >
        <span class="transition-transform group-hover:-translate-x-1">←</span>
        Retour à l'accueil
      </RouterLink>
      <h1 class="text-4xl md:text-5xl font-black text-[var(--color-beige)] mb-3">
        {{ title }}
      </h1>
      <p v-if="subtitle" class="text-[#8A8585] text-sm md:text-base max-w-xl mx-auto">
        {{ subtitle }}
      </p>
    </header>

    <!-- Skeleton chargement -->
    <div v-if="loading" class="border-2 border-[#333] rounded-2xl bg-[var(--color-dark)] p-10 space-y-4">
      <div class="h-4 w-1/3 bg-[#333] rounded-full animate-pulse" />
      <div class="h-3 w-full bg-[#333] rounded-full animate-pulse" />
      <div class="h-3 w-5/6 bg-[#333] rounded-full animate-pulse" />
      <div class="h-3 w-4/6 bg-[#333] rounded-full animate-pulse" />
    </div>

    <!-- Erreur -->
    <div
      v-else-if="error"
      class="border-2 border-[var(--accent-pink)] rounded-2xl bg-black/20 p-8 text-center text-[var(--accent-pink)] text-sm font-semibold"
    >
      {{ error }}
    </div>

    <!-- Contenu -->
    <div v-else>
      <slot />
    </div>
  </div>
</template>
