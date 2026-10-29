<script setup lang="ts">
import { computed } from 'vue';
import { usePageTitle } from '../a11y.js';
import HubView from '../governance/HubView.vue';
import { FALLBACK_HUB, hubState } from '../governance/hub.js';
import { usePageDescription } from '../seo.js';

/** The home page: the party's link hub (design §10.6), the same for everyone, on a page of its own. */
const hub = computed(() => hubState.hub ?? FALLBACK_HUB);
usePageTitle(() => hub.value.profile.name);
// Its tagline and the line on what it is for, as the party wrote them, describe it in search results (design §15).
usePageDescription(() => `${hub.value.profile.tagline} ${hub.value.profile.bio}`);
</script>

<template>
  <q-page class="ustp-hub-page">
    <HubView :hub="hub" />
  </q-page>
</template>
