<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { session } from '../session.js';
import { bannerText } from './my-email-text.js';

/**
 * A banner on every page while the signed-in person's address is not mailed (design §10.12): it bounced for good, or
 * they marked an email as spam. It sends them to the Account page, where they can try the address again.
 */
const route = useRoute();
const text = computed(() => (route.path === '/account' ? null : bannerText(session.me?.mail?.state)));
</script>

<template>
  <q-banner v-if="text" class="bg-orange-2 text-black" role="region" aria-label="Email">
    {{ text }} See <router-link to="/account" class="text-black">your Account page</router-link> to try your address again.
  </q-banner>
</template>
