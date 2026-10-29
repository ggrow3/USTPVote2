<script setup lang="ts">
import { computed } from 'vue';
import { session } from '../session.js';

/**
 * The links between the public communications pages (design §10.7): News, the Press page, the share kit (shown to
 * Active members, the only people it is for) and the suggestions form.
 */
const links = computed(() => [
  { to: '/news', label: 'News', icon: 'article' },
  { to: '/press', label: 'Press', icon: 'mic' },
  ...(session.me?.member?.status === 'active' ? [{ to: '/share', label: 'Share kit', icon: 'share' }] : []),
  { to: '/suggest', label: 'Send a suggestion', icon: 'lightbulb' },
]);
</script>

<template>
  <nav class="comms-nav" aria-label="News and press">
    <q-btn
      v-for="l in links"
      :key="l.to"
      flat
      dense
      no-caps
      :icon="l.icon"
      :label="l.label"
      :to="l.to"
      exact
      active-class="comms-nav__active"
    />
  </nav>
</template>

<style scoped>
.comms-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-bottom: 8px;
}
.comms-nav__active {
  color: var(--q-primary);
  text-decoration: underline;
  text-underline-offset: 6px;
}
</style>
