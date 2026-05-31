<script setup>
import logo from '@/assets/Logo.png';
</script>

<template>
  <header class="p-10 flex justify-center relative z-10">
    <RouterLink to="/">
      <img :src="logo" alt="Logo TuneGuess" class="h-12 w-auto" />
    </RouterLink>
  </header>
</template>
