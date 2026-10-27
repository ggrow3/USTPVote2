<script setup lang="ts">
import { computed } from 'vue';
import type { HomeQuote } from 'ustp-domain';

/**
 * The home page quote (design §10.5) set as a headline: the words in quotation marks, then who said them and the
 * source. Smaller the longer the quote, so a long one still fits a phone; `compact` is the admin's preview.
 */
const props = defineProps<{ quote: Pick<HomeQuote, 'text' | 'attribution' | 'source'>; compact?: boolean }>();

const size = computed(() => (props.quote.text.length > 200 ? 'long' : props.quote.text.length > 110 ? 'medium' : 'short'));
</script>

<template>
  <figure
    class="ustp-quote"
    :class="[`ustp-quote--${size}`, { 'ustp-quote--compact': compact, 'ustp-quote--dark': $q.dark.isActive }]"
  >
    <blockquote class="ustp-quote__text">
      <p>{{ quote.text }}</p>
    </blockquote>
    <figcaption class="ustp-quote__credit">
      <span v-if="quote.attribution" class="ustp-quote__who">{{ quote.attribution }}</span>
      <cite v-if="quote.source" class="ustp-quote__source">{{ quote.source }}</cite>
    </figcaption>
  </figure>
</template>

<style scoped>
/* Colours are the scrim's (.ustp-scrim): docs/ACCESSIBILITY.md has the figures. */
/* Sized to its own width (cqi), which is narrower beside the signed-in cards than beside the sign-in card. */
.ustp-quote {
  --mark: #a34400;
  --muted: #4a4a4a;
  margin: 0;
  container-type: inline-size;
}
.ustp-quote--dark {
  --mark: #ff8a3d;
  --muted: #d0d0d0;
}
.ustp-quote__text {
  margin: 0;
}
.ustp-quote__text p {
  margin: 0;
  font-size: clamp(1.5rem, 0.75rem + 5.5cqi, 2.75rem);
  font-weight: 400;
  line-height: 1.2;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}
.ustp-quote--medium .ustp-quote__text p {
  font-size: clamp(1.375rem, 0.75rem + 4.2cqi, 2.25rem);
}
.ustp-quote--long .ustp-quote__text p {
  font-size: clamp(1.25rem, 0.75rem + 3cqi, 1.75rem);
  line-height: 1.3;
}
/* The opening mark hangs in the panel's padding, so the text's left edge stays straight. */
.ustp-quote__text p::before {
  content: '“';
  display: inline-block;
  width: 0.45em;
  margin-left: -0.45em;
  color: var(--mark);
}
.ustp-quote__text p::after {
  content: '”';
  color: var(--mark);
}
.ustp-quote__credit {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 16px;
}
.ustp-quote__who {
  font-size: 1.125rem;
  font-weight: 600;
}
.ustp-quote__who::before {
  content: '— ';
}
.ustp-quote__source {
  color: var(--muted);
  font-size: 0.9375rem;
  font-style: normal;
}
.ustp-quote--compact .ustp-quote__text p {
  font-size: 1.375rem;
}
.ustp-quote--compact.ustp-quote--long .ustp-quote__text p {
  font-size: 1.125rem;
}
.ustp-quote--compact .ustp-quote__who {
  font-size: 1rem;
}
</style>
