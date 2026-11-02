<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { announce } from '../a11y.js';
import { session } from '../session.js';
import { atPlace, endTour, foldPanel, goToStep, guide, noteElection, stepAddress, stepDone, stepPlace } from './tour.js';
import { TOURS } from './tours.js';

/**
 * The walkthrough under way (design §10.11), at the foot of every page: the step, what to do on its page, and Back and
 * Next, which open the steps' pages. The layout loads it only while a walkthrough is under way.
 */
const route = useRoute();
const router = useRouter();

const tour = computed(() => (guide.progress ? TOURS[guide.progress.tour] : null));
const index = computed(() => guide.progress?.step ?? 0);
const step = computed(() => tour.value?.steps[index.value] ?? null);
const count = computed(() => tour.value?.steps.length ?? 0);
const election = computed(() => guide.progress?.election ?? null);
const folded = computed(() => !!guide.progress?.folded);

/** On the step's page (and tab). */
const here = computed(() => !!step.value && atPlace(step.value, route.path, guide.openTab));
/** Where the step's election is picked from, while the walkthrough follows none and the step is on its page. */
const pick = computed(() => (step.value && stepPlace(step.value, election.value) !== step.value ? step.value.pick! : null));
const atPick = computed(() => !!pick.value && atPlace(pick.value, route.path, guide.openTab));
const placeTitle = computed(() => pick.value?.title ?? step.value?.title ?? '');
const done = computed(() => !!step.value && stepDone(step.value, !!session.user));

// The election of each election page opened, so later steps open its pages.
watch(() => route.path, noteElection, { immediate: true });

async function show(at: number) {
  goToStep(at);
  const s = step.value;
  if (!s) return;
  announce(`Step ${at + 1} of ${count.value}: ${s.title}`);
  if (!stepDone(s, !!session.user)) await router.push(stepAddress(s, election.value));
}

async function openPlace() {
  if (step.value) await router.push(stepAddress(step.value, election.value));
}

function finish(completed: boolean) {
  const title = tour.value?.title;
  endTour();
  announce(completed ? `${title} walkthrough finished.` : 'Walkthrough ended.');
}
</script>

<template>
  <!-- A region of its own, not the page's footer (contentinfo), which a <footer> would be taken for. -->
  <q-footer v-if="tour && step" bordered class="ustp-guide-bar" role="region" aria-label="Walkthrough">
    <div class="ustp-guide-bar__inner">
      <div class="ustp-guide-bar__head">
        <div class="ustp-guide-bar__title">
          <p class="text-caption q-mb-none">{{ tour.title }} walkthrough · Step {{ index + 1 }} of {{ count }}</p>
          <h2 class="text-subtitle1 q-my-none">{{ step.title }}</h2>
        </div>
        <q-btn
          flat
          round
          dense
          :icon="folded ? 'expand_less' : 'expand_more'"
          :aria-label="folded ? 'Show what to do' : 'Hide what to do'"
          :aria-expanded="folded ? 'false' : 'true'"
          aria-controls="ustp-guide-step"
          @click="foldPanel(!folded)"
        />
        <q-btn flat round dense icon="close" aria-label="End the walkthrough" @click="finish(false)" />
      </div>
      <div v-show="!folded" id="ustp-guide-step" class="ustp-guide-bar__body">
        <p>{{ step.about }}</p>
        <div v-if="!here || done" class="ustp-guide-bar__away">
          <template v-if="done">You are signed in, so this step is done.</template>
          <template v-else-if="atPick">{{ pick!.how }}</template>
          <template v-else>
            <span>{{ pick ? pick.how : 'This step is on another page.' }}</span>
            <q-btn outline color="primary" no-caps :label="`Open ${placeTitle}`" @click="openPlace" />
          </template>
        </div>
        <h3 class="text-subtitle2 q-mt-sm q-mb-xs">What to do here</h3>
        <ol class="q-my-none">
          <li v-for="(item, i) in step.todo" :key="i">{{ item }}</li>
        </ol>
        <template v-if="step.notes?.length">
          <h3 class="text-subtitle2 q-mt-sm q-mb-xs">Good to know</h3>
          <ul class="q-my-none">
            <li v-for="(note, i) in step.notes" :key="i">{{ note }}</li>
          </ul>
        </template>
      </div>
      <div class="ustp-guide-bar__actions">
        <q-btn flat no-caps icon="arrow_back" label="Back" :disable="index === 0" @click="show(index - 1)" />
        <q-btn flat no-caps label="All steps" :to="{ path: '/guide', query: { tour: tour.id } }" />
        <q-space />
        <q-btn
          v-if="index < count - 1"
          unelevated
          color="primary"
          no-caps
          icon-right="arrow_forward"
          :label="$q.screen.gt.xs ? `Next: ${tour.steps[index + 1]!.title}` : 'Next'"
          :aria-label="`Next: ${tour.steps[index + 1]!.title}`"
          @click="show(index + 1)"
        />
        <q-btn v-else unelevated color="primary" no-caps icon-right="check" label="Finish" @click="finish(true)" />
      </div>
    </div>
  </q-footer>
</template>

<style scoped>
.ustp-guide-bar {
  background: #fff;
  color: rgba(0, 0, 0, 0.87);
  font-size: 1rem;
  line-height: 1.5;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.18);
}
.body--dark .ustp-guide-bar {
  background: var(--q-dark);
  color: #fff;
}
/* The page card's column, so the steps line up with the page they are about. */
.ustp-guide-bar__inner {
  max-width: 940px;
  margin: 0 auto;
  padding: 8px 16px;
}
.ustp-guide-bar__head {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ustp-guide-bar__title {
  flex: 1;
  min-width: 0;
}
/* Scrolling inside, so the page above stays usable: on a phone the panel keeps to under half the screen. */
.ustp-guide-bar__body {
  max-height: min(40vh, 360px);
  overflow-y: auto;
  padding: 4px 0;
}
@media (max-width: 599.98px) {
  .ustp-guide-bar__body {
    max-height: 30vh;
  }
}
.ustp-guide-bar__body p {
  margin: 0 0 4px;
}
.ustp-guide-bar__away {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  padding: 8px 12px;
  border-left: 4px solid var(--q-primary);
  background: rgba(0, 0, 0, 0.04);
}
.body--dark .ustp-guide-bar__away {
  background: rgba(255, 255, 255, 0.08);
}
.ustp-guide-bar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
</style>
