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
  <div class="flex flex-col gap-8 mt-4">
    <div class="text-center">
      <h1 class="text-4xl md:text-5xl font-black italic mb-2">Salons actifs</h1>
      <p class="opacity-60 text-sm">Créez une partie ou rejoignez un salon en attente</p>
    </div>

    <div class="glass-card p-6 max-w-md mx-auto w-full flex flex-col gap-4">
      <input
        type="text"
        placeholder="Votre pseudo..."
        :value="game.name"
        :maxlength="game.MAX_NAME_LENGTH"
        class="input-premium p-4 rounded-2xl text-center outline-none"
        @input="game.setName($event.target.value)"
      />

      <div
        v-if="game.pendingInviteCode"
        class="p-4 rounded-2xl bg-green-500/10 border border-green-500/30 text-sm"
      >
        <p class="mb-3 opacity-90">
          Invitation au salon
          <span class="room-badge">{{ game.pendingInviteCode }}</span>
        </p>
        <button
          type="button"
          class="w-full bg-white text-black py-3 rounded-xl font-black hover:scale-[1.02] transition cursor-pointer"
          @click="game.joinFromInvite()"
        >
          Rejoindre ce salon
        </button>
      </div>

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
          class="px-5 py-3 rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 transition cursor-pointer font-bold"
          @click="game.joinRoom()"
        >
          Rejoindre
        </button>
      </div>

      <p v-if="game.roomError" class="text-red-400 text-sm text-center">{{ game.roomError }}</p>

      <button
        type="button"
        class="bg-white text-black p-4 rounded-2xl font-black hover:scale-[1.02] transition cursor-pointer"
        @click="showCreateModal = true"
      >
        Créer une partie
      </button>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
      <p
        v-if="game.activeRooms.length === 0"
        class="col-span-full text-center opacity-40 py-12"
      >
        Aucun salon en attente — soyez le premier !
      </p>
      <button
        v-for="room in game.activeRooms"
        :key="room.id"
        type="button"
        class="glass-card-sm p-6 text-left cursor-pointer"
        @click="game.joinRoom(room.code)"
      >
        <span class="room-badge mb-3">{{ room.code }}</span>
        <h3 class="font-black text-lg truncate">{{ room.name }}</h3>
        <p class="text-sm opacity-50 mt-2">
          {{ room.playerCount }} / {{ room.maxPlayers }} joueurs
        </p>
      </button>
    </div>

    <CreateRoomModal
      :open="showCreateModal"
      @close="showCreateModal = false"
      @create="onCreate"
    />
  </div>
</template>
