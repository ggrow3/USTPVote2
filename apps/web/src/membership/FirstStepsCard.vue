<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { firstStepsLeft, firstStepsList, type FirstStepsView } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { shown } from '../governance/navigation.js';
import { myFirstSteps, tickFirstStep } from './api.js';
import { firstStepsHidden, hideFirstSteps } from './first-steps-choice.js';
import { firstStepsCaption } from './first-steps-text.js';
import FirstStepsList from './FirstStepsList.vue';

/**
 * A new member's first steps (design §5.16), on the voting home: the steps Membership Admins set, each ticked once a
 * record says they did it, or by the member for a step the site cannot check. Gone when every step is done or the
 * member hides it; a failed load shows nothing.
 */

const view = ref<FirstStepsView | null>(null);
const hidden = ref(firstStepsHidden());
const saving = ref<string | null>(null);
const tickedHere = ref(false);
const items = computed(() => (view.value ? firstStepsList(view.value, shown.value.menu) : []));
// Once the member ticks a box here the list stays until they leave, so ticking the last step does not take it away
// under the pointer, and a slip can be unticked.
const visible = computed(() => !hidden.value && (firstStepsLeft(items.value) || tickedHere.value));
const caption = computed(() => firstStepsCaption(items.value));

function hide() {
  hidden.value = true;
  hideFirstSteps();
}

async function tick(id: string, done: boolean) {
  if (!view.value) return;
  tickedHere.value = true;
  saving.value = id;
  await attempt(async () => {
    view.value = await tickFirstStep(id, done);
  });
  saving.value = null;
}

onMounted(async () => {
  if (hidden.value) return;
  try {
    view.value = await myFirstSteps();
  } catch {
    view.value = null;
  }
});
</script>

<template>
  <q-card v-if="visible" flat bordered class="ustp-first-steps" role="region" aria-labelledby="first-steps-title">
    <q-card-section class="q-pb-none">
      <div class="row items-center no-wrap">
        <h2 id="first-steps-title" class="text-subtitle1 col">Getting started</h2>
        <q-btn flat dense no-caps label="Hide" aria-label="Hide the getting started list" @click="hide" />
      </div>
      <div class="text-caption text-grey-7" aria-live="polite">{{ caption }}</div>
    </q-card-section>
    <FirstStepsList :items="items" :saving="saving" @tick="tick" />
  </q-card>
</template>
