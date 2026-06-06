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
        class="border-2 border-[#333] rounded-2xl bg-[var(--color-dark)] p-6 md:p-8 mb-5"
      >
        <h2 class="text-xs uppercase tracking-widest text-[#8A8585] font-bold mb-4 flex items-center gap-2">
          <span class="w-1.5 h-4 rounded-full bg-[var(--color-blue-main)]" />
          {{ section.title }}
        </h2>
        <ul class="space-y-3">
          <li
            v-for="(item, ii) in section.items"
            :key="`${section.title}-${ii}`"
            class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 p-4 rounded-xl border-2 border-[#333] bg-black/20 hover:border-[var(--color-blue-main)] transition-colors"
          >
            <div>
              <component
                :is="item.link ? 'a' : 'span'"
                :href="item.link ?? undefined"
                target="_blank"
                rel="noopener noreferrer"
                class="font-bold text-[var(--color-beige)]"
                :class="item.link ? 'hover:text-[var(--color-blue-main)] transition-colors' : ''"
              >
                {{ item.name }}
              </component>
              <p class="text-sm text-[#8A8585] mt-0.5">{{ item.role }}</p>
            </div>
            <span
              v-if="item.link"
              class="text-[#555] text-xs font-bold shrink-0"
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
        class="text-center text-xs text-[#555] font-semibold mt-6 px-4"
      >
        {{ data.footer }}
      </p>
    </template>
  </ContentPageLayout>
</template>
