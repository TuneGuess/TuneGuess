<script setup>
import { onMounted } from 'vue';
import { useSiteContent } from '@/composables/useSiteContent';
import ContentPageLayout from '@/components/ContentPageLayout.vue';

const { data, loading, error, load } = useSiteContent('legal');

onMounted(() => load());
</script>

<template>
  <ContentPageLayout
    :title="data?.title ?? 'Mentions légales'"
    :subtitle="data?.subtitle"
    :loading="loading"
    :error="error"
  >
    <template v-if="data">
      <p
        v-if="data.lastUpdated"
        v-motion
        :initial="{ opacity: 0 }"
        :enter="{ opacity: 1, transition: { delay: 100 } }"
        class="text-center text-xs opacity-40 mb-6"
      >
        Dernière mise à jour : {{ data.lastUpdated }}
      </p>

      <nav
        v-if="data.sections?.length > 1"
        v-motion
        :initial="{ opacity: 0 }"
        :visible="{ opacity: 1, transition: { delay: 200 } }"
        class="glass-card-sm p-4 mb-6"
      >
        <p class="text-xs uppercase tracking-widest opacity-50 mb-3 font-bold">Sommaire</p>
        <ul class="flex flex-wrap gap-2">
          <li v-for="s in data.sections" :key="s.id">
            <a
              :href="`#${s.id}`"
              class="text-xs px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:border-green-400/40 hover:text-green-400 transition"
            >
              {{ s.title }}
            </a>
          </li>
        </ul>
      </nav>

      <article
        v-for="(section, si) in data.sections"
        :id="section.id"
        :key="section.id ?? section.title"
        v-motion
        :initial="{ opacity: 0, y: 20 }"
        :visible="{
          opacity: 1,
          y: 0,
          transition: { delay: 120 + si * 90, duration: 500 },
        }"
        class="glass-card p-6 md:p-8 mb-5 scroll-mt-24"
      >
        <h2 class="text-xl font-bold mb-4 text-gradient">{{ section.title }}</h2>
        <div class="space-y-3 text-sm leading-relaxed opacity-85">
          <p
            v-for="(para, pi) in section.paragraphs"
            :key="pi"
            class="stagger-item"
            :style="{ animationDelay: `${pi * 40}ms` }"
          >
            {{ para }}
          </p>
        </div>
      </article>

      <p
        v-if="data.footer"
        class="text-center text-xs opacity-40 mt-6 px-4"
      >
        {{ data.footer }}
      </p>
    </template>
  </ContentPageLayout>
</template>
