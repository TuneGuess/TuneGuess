<script setup>
import { ref, watch } from 'vue';
import { MAX_NAME_LENGTH } from '@/utils/sanitize';

const props = defineProps({
  open: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'create']);

const roomName = ref('');

watch(() => props.open, (isOpen) => {
  if (!isOpen) roomName.value = '';
});

function submit() {
  emit('create', roomName.value);
  roomName.value = '';
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      @click.self="emit('close')"
    >
      <div class="glass-card p-8 max-w-md w-full flex flex-col gap-4">
        <h2 class="text-2xl font-black italic text-center">Nouvelle partie</h2>
        <input
          v-model="roomName"
          type="text"
          placeholder="Nom du salon..."
          :maxlength="MAX_NAME_LENGTH"
          class="input-premium p-4 rounded-2xl text-center outline-none"
        />
        <div class="flex gap-3">
          <button
            type="button"
            class="flex-1 py-3 rounded-xl border border-white/20 hover:bg-white/5 transition cursor-pointer"
            @click="emit('close')"
          >
            Annuler
          </button>
          <button
            type="button"
            class="flex-1 py-3 rounded-xl bg-white text-black font-black hover:scale-[1.02] transition cursor-pointer"
            @click="submit"
          >
            Créer
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
