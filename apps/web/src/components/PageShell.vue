<script setup lang="ts">
import HomeBackdrop from './HomeBackdrop.vue';

/**
 * Every page but the hub and the voting home (design §10.5): the voting home's sunrise behind it, and the page itself
 * on one card lifted off the picture, as the voting home's cards are. `layout.css` ("Page") has the styles.
 */
defineProps<{
  /** `narrow` for a short form on its own (sign in); `wide` for the admin console, whose tables and tabs need room. */
  width?: 'narrow' | 'wide';
}>();
</script>

<template>
  <q-page class="ustp-page" :class="width && `ustp-page--${width}`">
    <HomeBackdrop class="ustp-page__backdrop" />
    <div class="ustp-page__sheet">
      <slot />
    </div>
  </q-page>
</template>
