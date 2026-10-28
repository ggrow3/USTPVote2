<script setup lang="ts">
import { computed, useId } from 'vue';
import { dailyPick } from 'ustp-domain';

/** Today's quote and joke (design §4.1), for people who turned them on in their account. */
const props = withDefaults(defineProps<{ heading?: 'h2' | 'h3' }>(), { heading: 'h2' });
const titleId = useId();
const today = computed(() => dailyPick(new Date()));
</script>

<template>
  <q-card flat bordered tag="section" :aria-labelledby="titleId">
    <q-card-section>
      <component :is="props.heading" :id="titleId" class="text-subtitle1">Today’s quote and joke</component>
    </q-card-section>
    <q-card-section class="q-pt-none">
      <figure class="q-ma-none">
        <blockquote class="q-ma-none text-body1">“{{ today.quote.text }}”</blockquote>
        <figcaption class="text-caption text-grey-7 q-mt-xs">
          — {{ today.quote.author }}, <cite>{{ today.quote.source }}</cite>
        </figcaption>
      </figure>
    </q-card-section>
    <q-separator inset />
    <q-card-section>
      <p class="q-mb-xs">{{ today.joke.setup }}</p>
      <p class="q-mb-none text-weight-medium">{{ today.joke.punchline }}</p>
    </q-card-section>
  </q-card>
</template>
