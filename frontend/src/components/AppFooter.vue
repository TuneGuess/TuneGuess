<script setup>
</script>

<template>
  <footer
    v-motion
    :initial="{ opacity: 0, y: 16 }"
    :visible="{ opacity: 1, y: 0, transition: { delay: 400, duration: 500 } }"
    class="w-full max-w-5xl px-6 py-10 mt-auto relative z-10"
  >
    <div class="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 text-sm">
      <RouterLink to="/credits" class="footer-link">Crédits</RouterLink>
      <span class="hidden sm:inline opacity-20">·</span>
      <RouterLink to="/legal" class="footer-link">Mentions légales</RouterLink>
      <span class="hidden sm:inline opacity-20">·</span>
      <RouterLink to="/legal#confidentialite" class="footer-link">Règles de confidentialité</RouterLink>
    </div>
    <p class="text-center text-xs opacity-30 mt-4">
      TuneGuess — devinez qui écoute quoi
    </p>
  </footer>
</template>
