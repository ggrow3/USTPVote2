<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { ApiKeysStatus } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import ApiKeyCard from './ApiKeyCard.vue';
import ClaudeKeyPanel from './ClaudeKeyPanel.vue';
import { apiKeysStatus } from './api.js';
import { KEYS_INTRO } from './api-keys-text.js';

/**
 * Admin › API keys (design §5.6): every outside service's key in one place, each optional. The Anthropic API key for the
 * Claude checks first, then the public-records services' keys for the Candidates and Your area pages.
 */
const keys = ref<ApiKeysStatus | null>(null);

onMounted(() =>
  attempt(async () => {
    keys.value = await apiKeysStatus();
  }),
);
</script>

<template>
  <div class="ustp-content">
    <p class="text-body2 q-my-none">{{ KEYS_INTRO }}</p>
    <ClaudeKeyPanel />
    <template v-if="keys">
      <ApiKeyCard v-for="k in keys.keys" :key="k.name" :status="k" :tried="keys.tried" @changed="keys = $event" />
    </template>
  </div>
</template>
