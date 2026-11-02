<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePageTitle } from '../a11y.js';
import PageShell from '../components/PageShell.vue';
import { hasRole, session } from '../session.js';
import { endTour, guide, startTour, stepAddress, stepDone, TOUR_IDS, type TourId } from './tour.js';
import { TOURS } from './tours.js';

/**
 * The Guide (design §10.11): the walkthroughs for a Voter, an Election Admin and an Auditor, every step readable here,
 * and a way to start each one, at its first step or any other.
 */
usePageTitle('Guide');
const route = useRoute();
const router = useRouter();

const isTour = (value: unknown): value is TourId => (TOUR_IDS as readonly unknown[]).includes(value);

/** The walkthrough asked for, else the one under way, else the one for the person's role. */
function initial(): TourId {
  if (isTour(route.query.tour)) return route.query.tour;
  if (guide.progress) return guide.progress.tour;
  if (hasRole('auditor')) return 'auditor';
  if (hasRole('election_admin')) return 'election_admin';
  return 'voter';
}
const chosen = ref<TourId>(initial());
// The walkthrough's "All steps" button links here with its tour, perhaps while this page is open.
watch(
  () => route.query.tour,
  (tour) => isTour(tour) && (chosen.value = tour),
);

const tours = TOUR_IDS.map((id) => TOURS[id]);
const underWay = computed(() => (guide.progress ? { tour: TOURS[guide.progress.tour], step: guide.progress.step } : null));
/** On a test deployment, a System Admin can rehearse every part alone as test personas (design §10.4). */
const rehearsal = computed(() => !!session.me?.testing.enabled && hasRole('system_admin'));

async function start(tour: TourId, step = 0) {
  startTour(tour, step);
  const s = TOURS[tour].steps[step]!;
  if (!stepDone(s, !!session.user)) await router.push(stepAddress(s, guide.progress?.election ?? null));
}
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <h1 class="text-h5">Guide</h1>
      <p>
        Page by page, what to do on this site in an election, for each of the three people it takes: the voter, the Election
        Admin who sets it up, and the Auditor who approves each step. Start a walkthrough and a panel at the foot of every
        page says what to do there; Next opens the next page. Or read every step below.
      </p>
      <q-banner v-if="underWay" class="bg-grey-3 text-black" rounded>
        You are on step {{ underWay.step + 1 }} of {{ underWay.tour.steps.length }} of the {{ underWay.tour.title }}
        walkthrough: {{ underWay.tour.steps[underWay.step]!.title }}.
        <template #action>
          <q-btn flat no-caps color="primary" label="Continue" @click="start(underWay.tour.id, underWay.step)" />
          <q-btn flat no-caps color="primary" label="End it" @click="endTour" />
        </template>
      </q-banner>

      <h2 class="text-subtitle1">How an election runs</h2>
      <ol>
        <li>An Election Admin creates the election and builds its ballot.</li>
        <li>The Election Admin requests the voter roll, and an Auditor approves it.</li>
        <li>The Election Admin requests scheduling, and an Auditor approves it: the ballot and roll are frozen.</li>
        <li>Voting opens at its set time. Everyone on the roll is emailed; voters cast their ballots and keep their receipts.</li>
        <li>Voting closes. The ballots are sealed and counted, and provisional results are published.</li>
        <li>The Election Admin requests certification, and an Auditor approves it: the results are final.</li>
        <li>Anyone can check the results, and each voter their receipt, against the published record.</li>
      </ol>
      <q-banner v-if="rehearsal" class="bg-grey-3 text-black" rounded>
        This is a test deployment, so you can rehearse all three parts alone. In
        <router-link :to="{ path: '/admin', query: { tab: 'testing' } }">Admin › Testing</router-link>, “Create demo
        election” sets up a rehearsal, and “Act as” makes this browser tab a test persona: the Test Election Admin, the Test
        Auditor or a Test Voter. Each tab follows its own walkthrough.
      </q-banner>

      <h2 class="text-subtitle1">Walkthroughs</h2>
      <q-tabs v-model="chosen" dense align="left" class="text-primary" no-caps>
        <q-tab
          v-for="t in tours"
          :id="`guide-tab-${t.id}`"
          :key="t.id"
          :name="t.id"
          :label="t.title"
          :aria-controls="`guide-panel-${t.id}`"
        />
      </q-tabs>
      <q-separator />
      <q-tab-panels v-model="chosen" keep-alive class="bg-transparent">
        <q-tab-panel
          v-for="t in tours"
          :id="`guide-panel-${t.id}`"
          :key="t.id"
          :name="t.id"
          :aria-labelledby="`guide-tab-${t.id}`"
          class="q-px-none"
        >
          <p>{{ t.who }} {{ t.steps.length }} steps.</p>
          <q-btn unelevated color="primary" no-caps icon="play_arrow" :label="`Start the ${t.title} walkthrough`" @click="start(t.id)" />
          <ol class="ustp-guide-steps">
            <li v-for="(s, i) in t.steps" :key="s.id">
              <h3 class="text-subtitle1 q-mb-none">{{ s.title }}</h3>
              <p class="q-mb-sm">{{ s.about }}</p>
              <ol class="q-mb-sm">
                <li v-for="(item, j) in s.todo" :key="j">{{ item }}</li>
              </ol>
              <ul v-if="s.notes?.length" class="text-caption q-mb-sm">
                <li v-for="(note, j) in s.notes" :key="j">{{ note }}</li>
              </ul>
              <q-btn flat dense no-caps color="primary" label="Start here" @click="start(t.id, i)">
                <span class="sr-only">: {{ s.title }}</span>
              </q-btn>
            </li>
          </ol>
        </q-tab-panel>
      </q-tab-panels>
    </div>
  </PageShell>
</template>

<style scoped>
/* Each step's number before its heading, the step's text under it. */
.ustp-guide-steps {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 16px 0 0;
  padding-left: 1.5em;
}
.ustp-guide-steps > li::marker {
  font-weight: 600;
}
.ustp-guide-steps h3 {
  font-weight: 600;
  line-height: 1.4;
}
</style>
