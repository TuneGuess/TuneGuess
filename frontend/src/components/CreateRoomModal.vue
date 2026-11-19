<script setup>
import { ref, watch } from 'vue';
import { MAX_NAME_LENGTH } from '@/utils/sanitize';
import { DEFAULT_SCORING } from '@/utils/bareme';
import { useAccountStore } from '@/stores/account';
import BaremeApercu from '@/components/BaremeApercu.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'create']);

const account = useAccountStore();
const roomName = ref('');
// Valeurs par défaut du serveur (réglées par l'admin), sinon celles du jeu.
const defaults = () => ({ maxRounds: 10, roundDuration: 30, ...DEFAULT_SCORING, ...(account.providers.gameDefaults || {}) });
const settings = ref(defaults());
const showScoring = ref(false);

watch(() => props.open, async (isOpen) => {
  if (!isOpen) {
    roomName.value = '';
    return;
  }
  await account.ensureLoaded();
  settings.value = defaults();
});

function submit() {
  if (!roomName.value.trim()) return;
  emit('create', roomName.value, { ...settings.value });
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

            <button
                type="button"
                class="text-xs text-[#8A8585] hover:text-[var(--color-beige)] underline cursor-pointer self-center"
                :aria-expanded="showScoring"
                @click="showScoring = !showScoring"
            >
              {{ showScoring ? 'Masquer les réglages' : 'Manches, durée et barème' }}
            </button>

            <div v-if="showScoring" class="grid grid-cols-2 gap-3 text-xs uppercase tracking-wider text-[#8A8585] font-bold">
              <label class="flex flex-col gap-1">Manches
                <input v-model.number="settings.maxRounds" type="number" min="1" max="50" class="bg-transparent border-2 border-[#333] focus:border-[var(--color-blue-main)] p-2 rounded-xl text-center outline-none text-sm font-bold text-[var(--color-beige)] transition-colors" />
              </label>
              <label class="flex flex-col gap-1">Durée (s)
                <input v-model.number="settings.roundDuration" type="number" min="10" max="120" class="bg-transparent border-2 border-[#333] focus:border-[var(--color-blue-main)] p-2 rounded-xl text-center outline-none text-sm font-bold text-[var(--color-beige)] transition-colors" />
              </label>
              <label class="flex flex-col gap-1">Points max
                <input v-model.number="settings.pointsMax" type="number" min="10" max="10000" class="bg-transparent border-2 border-[#333] focus:border-[var(--color-blue-main)] p-2 rounded-xl text-center outline-none text-sm font-bold text-[var(--color-beige)] transition-colors" />
              </label>
              <label class="flex flex-col gap-1">Points min
                <input v-model.number="settings.pointsMin" type="number" min="0" max="10000" class="bg-transparent border-2 border-[#333] focus:border-[var(--color-blue-main)] p-2 rounded-xl text-center outline-none text-sm font-bold text-[var(--color-beige)] transition-colors" />
              </label>
              <label class="flex flex-col gap-1">Délai de grâce (s)
                <input v-model.number="settings.delaiGrace" type="number" min="0" max="30" step="0.5" class="bg-transparent border-2 border-[#333] focus:border-[var(--color-blue-main)] p-2 rounded-xl text-center outline-none text-sm font-bold text-[var(--color-beige)] transition-colors" />
              </label>
              <label class="flex items-center gap-2 normal-case">
                <input v-model="settings.bonusPremier" type="checkbox" class="w-4 h-4 accent-[var(--color-blue-main)]" />
                Bonus au premier
              </label>
              <div class="col-span-2 normal-case tracking-normal font-normal text-[var(--color-beige)]">
                <BaremeApercu :scoring="settings" :duration="settings.roundDuration || 30" />
              </div>
            </div>

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