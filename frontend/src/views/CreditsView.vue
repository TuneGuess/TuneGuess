<script setup>
import { onMounted } from 'vue';
import { useSiteContent } from '@/composables/useSiteContent';
import ContentPageLayout from '@/components/ContentPageLayout.vue';

const { data, loading, error, load } = useSiteContent('credits');

onMounted(() => load());
</script>

<template>
  <ContentPageLayout
    :title="data?.title ?? 'Crédits'"
    :subtitle="data?.subtitle"
    :loading="loading"
    :error="error"
  >
    <template v-if="data">
      <section
        v-for="(section, si) in data.sections"
        :key="section.title"
        v-motion
        :initial="{ opacity: 0, y: 24 }"
        :visible="{
          opacity: 1,
          y: 0,
          transition: { delay: 80 + si * 100, duration: 500 },
        }"
        class="glass-card glass-card-glow p-6 md:p-8 mb-5"
      >
        <h2 class="text-lg font-bold mb-4 flex items-center gap-2">
          <span class="w-1.5 h-6 rounded-full bg-gradient-to-b from-green-400 to-violet-400" />
          {{ section.title }}
        </h2>
        <ul class="space-y-3">
          <li
            v-for="(item, ii) in section.items"
            :key="`${section.title}-${ii}`"
            class="stagger-item flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/12 transition-colors"
            :style="{ animationDelay: `${ii * 60}ms` }"
          >
            <div>
              <component
                :is="item.link ? 'a' : 'span'"
                :href="item.link ?? undefined"
                target="_blank"
                rel="noopener noreferrer"
                class="font-bold"
                :class="item.link ? 'text-green-400 hover:underline' : ''"
              >
                {{ item.name }}
              </component>
              <p class="text-sm opacity-55 mt-0.5">{{ item.role }}</p>
            </div>
            <span
              v-if="item.link"
              class="text-xs opacity-40 shrink-0"
            >
              ↗
            </span>
          </li>
        </ul>
      </section>

      <p
        v-if="data.footer"
        v-motion
        :initial="{ opacity: 0 }"
        :visible="{ opacity: 1, transition: { delay: 400 } }"
        class="text-center text-xs opacity-40 mt-6 px-4"
      >
        {{ data.footer }}
      </p>
    </template>
  </ContentPageLayout>
</template>
