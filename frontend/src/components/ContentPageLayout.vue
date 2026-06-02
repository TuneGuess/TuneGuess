<script setup>
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: null },
});
</script>

<template>
  <div class="flex flex-col gap-8 mt-2 pb-8">
    <header
      v-motion
      :initial="{ opacity: 0, y: 30 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 600 } }"
      class="text-center"
    >
      <RouterLink
        to="/"
        class="inline-flex items-center gap-2 text-sm opacity-50 hover:opacity-90 transition mb-6 group"
      >
        <span class="transition-transform group-hover:-translate-x-1">←</span>
        Retour à l'accueil
      </RouterLink>
      <h1 class="text-4xl md:text-5xl font-black italic text-gradient mb-3">
        {{ title }}
      </h1>
      <p v-if="subtitle" class="opacity-60 text-sm md:text-base max-w-xl mx-auto">
        {{ subtitle }}
      </p>
    </header>

    <div v-if="loading" class="glass-card p-10 max-w-2xl mx-auto w-full space-y-4">
      <div class="skeleton h-6 w-1/3" />
      <div class="skeleton h-4 w-full" />
      <div class="skeleton h-4 w-5/6" />
      <div class="skeleton h-4 w-4/6" />
    </div>

    <div
      v-else-if="error"
      class="glass-card p-8 max-w-2xl mx-auto w-full text-center text-red-400"
    >
      {{ error }}
    </div>

    <div v-else class="max-w-2xl mx-auto w-full">
      <slot />
    </div>
  </div>
</template>
