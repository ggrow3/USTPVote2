<script setup lang="ts">
import { useQuasar } from 'quasar';
import { computed, ref } from 'vue';
import { preferencesOf } from 'ustp-domain';
import { announce } from '../a11y.js';
import { errorMessage } from '../api.js';
import { refreshMe, session } from '../session.js';
import { savePreferences } from './api.js';
import DailyQuoteCard from './DailyQuoteCard.vue';

/** The account page's switch for the daily quote and joke (design §4.1): off until the person turns it on. */
const $q = useQuasar();
const on = computed(() => preferencesOf(session.me?.account).dailyQuote);
const busy = ref(false);

async function toggle(value: boolean) {
  busy.value = true;
  try {
    await savePreferences({ dailyQuote: value });
    await refreshMe();
    announce(value ? 'Daily quote and joke turned on' : 'Daily quote and joke turned off');
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <q-card flat bordered>
    <q-card-section>
      <h2 class="text-subtitle1">Daily quote and joke</h2>
      <div class="text-caption text-grey-7">
        A transhumanist or humanist quote and a light joke, new each day, here and on your voting home. Off unless you
        turn it on.
      </div>
    </q-card-section>
    <q-card-section class="q-pt-none">
      <q-toggle :model-value="on" :disable="busy" label="Show me a daily quote and joke" @update:model-value="toggle" />
    </q-card-section>
    <q-card-section v-if="on" class="q-pt-none">
      <DailyQuoteCard heading="h3" />
    </q-card-section>
  </q-card>
</template>
