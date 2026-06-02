<script setup>
const orbs = [
  { class: 'w-[420px] h-[420px] bg-indigo-500/30 top-[-10%] left-[-5%]', duration: '18s', delay: '0s' },
  { class: 'w-[320px] h-[320px] bg-pink-500/25 top-[20%] right-[-8%]', duration: '22s', delay: '-4s' },
  { class: 'w-[380px] h-[380px] bg-emerald-500/20 bottom-[-15%] left-[25%]', duration: '26s', delay: '-8s' },
  { class: 'w-[260px] h-[260px] bg-violet-500/25 bottom-[10%] right-[15%]', duration: '20s', delay: '-2s' },
];
</script>

<template>
  <div class="bg-orbs" aria-hidden="true">
    <div
      v-for="(orb, i) in orbs"
      :key="i"
      class="bg-orb"
      :class="orb.class"
      :style="{ '--duration': orb.duration, animationDelay: orb.delay }"
    />
  </div>
</template>
