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
    <Transition name="modal-backdrop">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
        @click.self="emit('close')"
      >
        <Transition name="modal-panel" appear>
          <div
            v-if="open"
            v-motion
            :initial="{ opacity: 0, scale: 0.85, y: 30 }"
            :enter="{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 280, damping: 22 } }"
            class="glass-card glass-card-glow p-8 max-w-md w-full flex flex-col gap-5 relative"
            @click.stop
          >
            <div class="absolute -top-px left-1/2 -translate-x-1/2 w-24 h-1 rounded-full bg-gradient-to-r from-transparent via-green-400 to-transparent opacity-60" />

            <h2 class="text-2xl font-black italic text-center text-gradient">
              Nouvelle partie
            </h2>
            <p class="text-center text-sm opacity-50 -mt-2">Choisissez un nom pour votre salon</p>

            <input
              v-model="roomName"
              type="text"
              placeholder="Nom du salon..."
              :maxlength="MAX_NAME_LENGTH"
              class="input-premium p-4 rounded-2xl text-center outline-none text-lg"
              @keyup.enter="submit"
            />

            <div class="flex gap-3">
              <button
                type="button"
                class="flex-1 py-3 rounded-xl btn-secondary cursor-pointer"
                @click="emit('close')"
              >
                Annuler
              </button>
              <button
                type="button"
                class="flex-1 py-3 rounded-xl btn-primary font-black cursor-pointer"
                @click="submit"
              >
                Créer
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
