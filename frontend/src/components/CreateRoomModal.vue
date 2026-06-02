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
  if (!roomName.value.trim()) return;
  emit('create', roomName.value);
  roomName.value = '';
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-backdrop">
      <div
          v-if="open"
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          @click.self="emit('close')"
      >
        <Transition name="modal-panel" appear>
          <div
              v-if="open"
              v-motion
              :initial="{ opacity: 0, scale: 0.85, y: 30 }"
              :enter="{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 280, damping: 22 } }"
              class="border-2 border-[var(--color-beige)] rounded-2xl bg-[var(--color-dark)] p-8 max-w-md w-full flex flex-col gap-5 relative"
              @click.stop
          >
            <h2 class="text-2xl font-black text-center text-[var(--color-beige)]">
              Nouvelle partie
            </h2>
            <p class="text-center text-sm text-[#8A8585] -mt-2">
              Choisissez un nom pour votre salon
            </p>

            <input
                v-model="roomName"
                type="text"
                placeholder="Nom du salon..."
                :maxlength="MAX_NAME_LENGTH"
                class="bg-transparent border-2 border-[#333] focus:border-[var(--color-blue-main)] p-4 rounded-xl text-center outline-none text-lg text-[var(--color-beige)] placeholder-[#555] transition-colors"
                @keyup.enter="submit"
            />

            <div class="flex gap-3 mt-2">
              <button
                  type="button"
                  class="flex-1 py-3 rounded-full btn-secondary font-bold text-sm cursor-pointer"
                  @click="emit('close')"
              >
                Annuler
              </button>
              <button
                  type="button"
                  class="flex-1 py-3 rounded-full btn-primary font-black text-sm cursor-pointer"
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