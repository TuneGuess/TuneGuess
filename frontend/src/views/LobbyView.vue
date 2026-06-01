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
  <div class="flex flex-col gap-10 mt-2 pb-8">
    <header
      v-motion
      :initial="{ opacity: 0, y: 40 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 700 } }"
      class="text-center"
    >
      <h1 class="text-4xl md:text-6xl font-black italic text-gradient mb-3">
        Bienvenue !
      </h1>
      <p class="opacity-55 text-sm md:text-base max-w-md mx-auto">
        Créez une partie ou rejoignez un salon
      </p>
    </header>

    <div
      v-motion
      :initial="{ opacity: 0, y: 30, scale: 0.96 }"
      :enter="{ opacity: 1, y: 0, scale: 1, transition: { delay: 150, duration: 600 } }"
      class="glass-card glass-card-glow p-6 md:p-8 max-w-md mx-auto w-full flex flex-col gap-4"
    >
      <label class="text-xs uppercase tracking-widest opacity-40 text-center font-bold">Pseudo</label>
      <input
        type="text"
        placeholder="Votre pseudo..."
        :value="game.name"
        :maxlength="game.MAX_NAME_LENGTH"
        class="input-premium p-4 rounded-2xl text-center outline-none text-lg"
        @input="game.setName($event.target.value)"
      />

      <Transition name="page">
        <div
          v-if="game.pendingInviteCode"
          v-motion
          :initial="{ opacity: 0, scale: 0.95 }"
          :enter="{ opacity: 1, scale: 1 }"
          class="p-4 rounded-2xl bg-green-500/10 border border-green-500/30 text-sm"
        >
          <p class="mb-3 opacity-90 text-center">
            Invitation au salon
            <span class="room-badge ml-1">{{ game.pendingInviteCode }}</span>
          </p>
          <button
            type="button"
            class="w-full btn-primary py-3 rounded-xl font-black cursor-pointer"
            @click="game.joinFromInvite()"
          >
            Rejoindre ce salon
          </button>
        </div>
      </Transition>

      <div class="flex gap-2">
        <input
          v-model="game.joinCodeInput"
          type="text"
          placeholder="Code salon..."
          maxlength="10"
          class="input-premium flex-1 p-3 rounded-xl text-center outline-none font-mono tracking-widest uppercase"
          @input="game.joinCodeInput = $event.target.value.toUpperCase().slice(0, 10)"
        />
        <button
          type="button"
          class="px-5 py-3 rounded-xl btn-secondary cursor-pointer font-bold shrink-0"
          @click="game.joinRoom()"
        >
          Rejoindre
        </button>
      </div>

      <p v-if="game.roomError" class="text-red-400 text-sm text-center animate-pulse">
        {{ game.roomError }}
      </p>

      <div class="relative flex items-center gap-3 py-1">
        <div class="flex-1 h-px bg-white/10" />
        <span class="text-xs opacity-30 uppercase">ou</span>
        <div class="flex-1 h-px bg-white/10" />
      </div>

      <button
        type="button"
        class="btn-primary p-4 rounded-2xl font-black cursor-pointer w-full"
        @click="showCreateModal = true"
      >
        ✦ Créer une partie
      </button>
    </div>

    <section class="mt-2">
      <h2
        v-motion
        :initial="{ opacity: 0 }"
        :enter="{ opacity: 1, transition: { delay: 300 } }"
        class="text-center text-sm uppercase tracking-widest opacity-40 font-bold mb-6"
      >
        En attente
      </h2>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <p
          v-if="game.activeRooms.length === 0"
          v-motion
          :initial="{ opacity: 0 }"
          :enter="{ opacity: 1, transition: { delay: 400 } }"
          class="col-span-full text-center opacity-35 py-16 glass-card-sm"
        >
          <span class="text-4xl block mb-3 opacity-50">♪</span>
          Aucun salon en attente — soyez le premier !
        </p>
        <button
          v-for="(room, i) in game.activeRooms"
          :key="room.id"
          v-motion
          :initial="{ opacity: 0, y: 20 }"
          :visible="{ opacity: 1, y: 0, transition: { delay: 350 + i * 80, duration: 450 } }"
          type="button"
          class="glass-card-sm glass-card-glow p-6 text-left cursor-pointer group"
          @click="game.joinRoom(room.code)"
        >
          <span class="room-badge mb-3 group-hover:shadow-[0_0_24px_rgba(74,222,128,0.2)] transition-shadow">
            {{ room.code }}
          </span>
          <h3 class="font-black text-lg truncate group-hover:text-green-400 transition-colors">
            {{ room.name }}
          </h3>
          <div class="flex items-center gap-2 mt-3">
            <div class="flex -space-x-1">
              <span
                v-for="n in Math.min(room.playerCount, 4)"
                :key="n"
                class="w-2 h-2 rounded-full bg-green-400/80"
              />
            </div>
            <p class="text-sm opacity-50">
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
