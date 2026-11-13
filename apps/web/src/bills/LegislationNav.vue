<script setup lang="ts">
import { computed } from 'vue';
import { billsState } from './access.js';

/**
 * The links between the public Legislation pages (design §5.14, "Legislation and the scorecard"): the bills, the
 * scorecard, and the team's own Bills page for those who have it.
 */
const links = computed(() => [
  { to: '/legislation', label: 'Bills', icon: 'gavel' },
  { to: '/scorecard', label: 'Scorecard', icon: 'how_to_vote' },
  ...(billsState.access?.allowed ? [{ to: '/bills?tab=watchlist', label: 'The team’s Bills page', icon: 'bookmarks' }] : []),
]);
</script>

<template>
  <nav class="legislation-nav" aria-label="Legislation">
    <q-btn v-for="l in links" :key="l.to" flat dense no-caps :icon="l.icon" :label="l.label" :to="l.to" active-class="legislation-nav__active" />
  </nav>
</template>

<style scoped>
.legislation-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-bottom: 8px;
}
.legislation-nav__active {
  text-decoration: underline;
  text-underline-offset: 6px;
}
</style>
