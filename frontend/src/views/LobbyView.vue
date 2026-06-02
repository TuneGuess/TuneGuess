<script setup>
import { ref } from 'vue';
import { useGameStore } from '@/stores/game';
import CreateRoomModal from '@/components/CreateRoomModal.vue';

const game = useGameStore();
const showCreateModal = ref(false);

function onCreate(name) {
  game.createRoom(name);
  showCreateModal.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-10 mt-2 pb-8 max-w-4xl mx-auto px-4">
    <header
        v-motion
        :initial="{ opacity: 0, y: 40 }"
        :enter="{ opacity: 1, y: 0, transition: { duration: 700 } }"
        class="text-center"
    >
      <h1 class="text-5xl md:text-6xl font-black mb-3 text-[var(--color-beige)]">
        Bienvenue !
      </h1>
      <p class="text-[#8A8585] text-base md:text-lg max-w-md mx-auto">
        Créez une partie ou rejoignez un salon
      </p>
    </header>

    <div
        v-motion
        :initial="{ opacity: 0, y: 30, scale: 0.96 }"
        :enter="{ opacity: 1, y: 0, scale: 1, transition: { delay: 150, duration: 600 } }"
        class="max-w-md mx-auto w-full flex flex-col gap-6"
    >
      <div class="flex flex-col gap-2 text-center">
        <label class="text-xs uppercase tracking-widest text-[#8A8585] font-bold">Pseudo</label>
        <input
            type="text"
            placeholder="Votre pseudo..."
            :value="game.name"
            :maxlength="game.MAX_NAME_LENGTH"
            class="input-flat p-4 text-center outline-none text-xl bg-transparent text-[var(--color-beige)] placeholder-[#555]"
            @input="game.setName($event.target.value)"
        />
      </div>

      <Transition name="page">
        <div
            v-if="game.pendingInviteCode"
            v-motion
            :initial="{ opacity: 0, scale: 0.95 }"
            :enter="{ opacity: 1, scale: 1 }"
            class="p-4 rounded-2xl border-2 border-[var(--color-blue-main)] bg-[var(--color-dark)] text-sm"
        >
          <p class="mb-3 text-[#8A8585] text-center">
            Invitation au salon
            <span class="room-badge ml-1">{{ game.pendingInviteCode }}</span>
          </p>
          <button
              type="button"
              class="w-full btn-primary py-3 rounded-full font-black cursor-pointer text-sm"
              @click="game.joinFromInvite()"
          >
            Rejoindre ce salon
          </button>
        </div>
      </Transition>

      <div class="flex gap-3 items-center">
        <input
            v-model="game.joinCodeInput"
            type="text"
            placeholder="CODE SALON..."
            maxlength="10"
            class="flex-1 bg-transparent border-b-2 border-[#333] focus:border-[var(--color-blue-main)] py-3 text-center outline-none font-mono tracking-widest uppercase text-sm text-[var(--color-beige)] placeholder-[#555] transition-colors"
            @input="game.joinCodeInput = $event.target.value.toUpperCase().slice(0, 10)"
        />
        <button
            type="button"
            class="btn-secondary px-6 py-2.5 text-sm font-bold shrink-0 cursor-pointer"
            @click="game.joinRoom()"
        >
          Rejoindre
        </button>
      </div>

      <p v-if="game.roomError" class="text-[var(--accent-pink)] text-sm text-center animate-pulse font-medium">
        {{ game.roomError }}
      </p>

      <div class="relative flex items-center gap-3 py-1">
        <div class="flex-1 h-px bg-[#333]" />
        <span class="text-xs text-[#555] uppercase tracking-wider">ou</span>
        <div class="flex-1 h-px bg-[#333]" />
      </div>

      <button
          type="button"
          class="btn-primary p-4 rounded-full font-black cursor-pointer w-full text-lg"
          @click="showCreateModal = true"
      >
        ✦ Créer une partie
      </button>
    </div>

    <section class="mt-12">
      <h2
          v-motion
          :initial="{ opacity: 0 }"
          :enter="{ opacity: 1, transition: { delay: 300 } }"
          class="text-center text-xs uppercase tracking-widest text-[#8A8585] font-bold mb-8"
      >
        Salons en attente
      </h2>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <p
            v-if="game.activeRooms.length === 0"
            v-motion
            :initial="{ opacity: 0 }"
            :enter="{ opacity: 1, transition: { delay: 400 } }"
            class="col-span-full text-center text-[#8A8585] py-12 border-2 border-dashed border-[#333] rounded-2xl"
        >
          <span class="text-3xl block mb-2 opacity-40">♪</span>
          Aucun salon en attente — soyez le premier !
        </p>

        <button
            v-for="(room, i) in game.activeRooms"
            :key="room.id"
            v-motion
            :initial="{ opacity: 0, y: 20 }"
            :visible="{ opacity: 1, y: 0, transition: { delay: 350 + i * 80, duration: 450 } }"
            type="button"
            class="flex flex-col items-start p-6 border-2 border-[var(--color-beige)] rounded-2xl bg-[var(--color-dark)] text-left cursor-pointer group transition-all duration-200 hover:-translate-y-1 hover:border-[var(--color-blue-main)]"
            @click="game.joinRoom(room.code)"
        >
          <span class="bg-[var(--color-blue-main)] text-white text-xs font-bold px-3 py-1 rounded-full mb-4 tracking-wider uppercase">
            {{ room.code }}
          </span>

          <h3 class="font-black text-xl truncate text-[var(--color-beige)] w-full transition-colors">
            {{ room.name }}
          </h3>

          <div class="flex items-center gap-2 mt-4">
            <div class="flex -space-x-1">
              <span
                  v-for="n in Math.min(room.playerCount, 4)"
                  :key="n"
                  class="w-2 h-2 rounded-full bg-[var(--color-blue-main)]"
              />
            </div>
            <p class="text-sm text-[#8A8585]">
              {{ room.playerCount }} / {{ room.maxPlayers }} joueurs
            </p>
          </div>
        </button>
      </div>
    </section>

    <CreateRoomModal
        :open="showCreateModal"
        @close="showCreateModal = false"
        @create="onCreate"
    />
  </div>
</template>