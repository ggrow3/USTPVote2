<script setup lang="ts">
import { ref } from 'vue';

/**
 * A password field with a "Show password" button (design §4, NIST SP 800-63B-4), so a long password can be checked
 * before it is sent. Other attributes (label, autocomplete, hint, error) go to the field as usual.
 */
const model = defineModel<string>({ required: true });
const shown = ref(false);
</script>

<template>
  <q-input v-model="model" :type="shown ? 'text' : 'password'" autocapitalize="off" autocorrect="off" spellcheck="false">
    <template #append>
      <q-btn
        flat
        round
        dense
        :icon="shown ? 'visibility_off' : 'visibility'"
        aria-label="Show password"
        :aria-pressed="shown ? 'true' : 'false'"
        @click="shown = !shown"
      />
    </template>
  </q-input>
</template>
