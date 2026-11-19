<script setup>
import { computed } from 'vue';
import { scoringPreview } from '@/utils/bareme';

const props = defineProps({ scoring: { type: Object, required: true }, duration: { type: Number, required: true } });
const marks = computed(() => scoringPreview(props.scoring, props.duration));
</script>

<template>
  <div class="text-xs opacity-80" aria-live="polite">
    <p class="font-semibold mb-1">Aperçu des points (bonne réponse)</p>
    <ul class="flex flex-wrap gap-x-4 gap-y-1">
      <li v-for="m in marks" :key="m.seconds">à {{ m.seconds }} s : <strong>{{ m.points }}</strong></li>
    </ul>
    <p v-if="scoring.bonusPremier" class="mt-1">+20 % pour le premier à trouver. Mauvaise réponse : 0.</p>
    <p v-else class="mt-1">Mauvaise réponse : 0.</p>
  </div>
</template>
