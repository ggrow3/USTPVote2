<script setup lang="ts">
import { computed } from 'vue';
import { dismissUpdate, reloadForUpdate, update } from '../update.js';
import { updateMessage } from '../version.js';

/**
 * Offers a reload when a release has replaced the web app or the api under this page (design §15). Shown at the foot
 * of the header, so it stays in view and its buttons come right after the menu in the tab order; its message is also
 * spoken through the layout's polite live region (update.ts), without taking focus.
 */
const message = computed(() => (update.banner ? updateMessage(update.banner.reason) : ''));
</script>

<template>
  <div v-if="message" class="ustp-update row items-center q-px-md q-py-xs" role="region" aria-label="New version">
    <span class="q-mr-md">{{ message }}</span>
    <q-space />
    <q-btn unelevated dense no-caps color="primary" label="Reload" class="q-px-md" @click="reloadForUpdate" />
    <q-btn flat dense no-caps label="Later" class="q-ml-sm q-px-sm" @click="dismissUpdate" />
  </div>
</template>

<style scoped>
/* Black on light blue (18.4:1, 10.9 under the header's focus tint) in both themes, like the testing bar's yellow;
   Reload is white on primary as elsewhere (4.94:1). */
.ustp-update {
  background: #e3f2fd;
  color: #000;
}
</style>
