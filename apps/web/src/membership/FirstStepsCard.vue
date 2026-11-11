<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { firstStepsLeft, firstStepsList, firstStepsProgress, type FirstStepsView } from 'ustp-domain';
import { shown } from '../governance/navigation.js';
import { myFirstSteps } from './api.js';
import { firstStepsHidden, hideFirstSteps } from './first-steps-choice.js';

/**
 * A new member's first steps (design §5.16), on the voting home: what to do first, each ticked once a record says they
 * did it. Gone when every step is done or the member hides it; a failed load shows nothing.
 */

const view = ref<FirstStepsView | null>(null);
const hidden = ref(firstStepsHidden());
const items = computed(() => (view.value ? firstStepsList(view.value, shown.value.menu) : []));
const visible = computed(() => !hidden.value && firstStepsLeft(items.value));

function hide() {
  hidden.value = true;
  hideFirstSteps();
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
      <div class="text-caption text-grey-7">{{ firstStepsProgress(items) }}. Each is ticked once you have done it.</div>
    </q-card-section>
    <q-list>
      <q-item v-for="item in items" :key="item.step" :to="item.to" clickable>
        <q-item-section avatar>
          <q-icon :name="item.done ? 'check_circle' : 'radio_button_unchecked'" :color="item.done ? 'positive' : 'grey-6'" aria-hidden="true" />
        </q-item-section>
        <q-item-section>
          <q-item-label>
            {{ item.label }}<span class="sr-only">{{ item.done ? ' (done)' : ' (not done yet)' }}</span>
          </q-item-label>
          <q-item-label caption>{{ item.why }}</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
  </q-card>
</template>
