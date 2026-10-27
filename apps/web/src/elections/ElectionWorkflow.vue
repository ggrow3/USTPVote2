<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import {
  electionProgress,
  STEP_STATE,
  type ElectionDetail,
  type ElectionState,
  type ElectionStep,
  type StepStatus,
} from 'ustp-domain';
import ElectionLanes from './ElectionLanes.vue';
import { cancelledNote, STATUS_TEXT, STEP_LABELS, stepNote, waitingText } from './workflow.js';
import { session } from '../session.js';

/**
 * Where the election is in its lifecycle (design §6.1): swim lanes showing who does each step, with the current one
 * highlighted, and beside them the same steps as a list, with what each is waiting on.
 */
const props = defineProps<{ detail: ElectionDetail }>();

// Times pass while the page is open: "voting opens at …" becomes "the opening time has passed".
const now = ref(new Date());
const clock = setInterval(() => (now.value = new Date()), 30_000);
onBeforeUnmount(() => clearInterval(clock));

// Testing mode lets a rehearsal be deleted after voting (design §10.4), as the editor's Delete card does.
const progress = computed(() => electionProgress(props.detail, now.value, { testingMode: !!session.me?.testing.enabled }));
const status = computed(() => new Map(progress.value.steps.map((s) => [s.step, s.status])));
const GROUPS: readonly { label: string; tag: 'ol' | 'ul'; heading: boolean; steps: readonly ElectionStep[] }[] = [
  {
    label: 'Steps of this election',
    tag: 'ol',
    heading: false,
    steps: ['readiness', 'roll', 'scheduling', 'scheduled', 'open', 'sealing', 'tally', 'certification', 'certified'],
  },
  { label: 'Ways out', tag: 'ul', heading: true, steps: ['cancelled', 'deleted'] },
];
/** Draft and Closed have several steps each, so their steps name the state they are taken in. */
const GROUPED: Partial<Record<ElectionState, string>> = { draft: 'Draft', closed: 'Closed' };
const stateOf = (step: ElectionStep) => GROUPED[STEP_STATE[step] ?? 'cancelled'];

const waitingAt = (step: ElectionStep) =>
  progress.value.waiting.filter((w) => w.step === step).map((w) => waitingText(w, props.detail.problems.length));
const note = (step: ElectionStep) =>
  step === 'cancelled' && props.detail.election.state === 'cancelled'
    ? cancelledNote(props.detail.election)
    : stepNote(step, props.detail.election, progress.value.deletedFrom.includes('certified'));

const summary = computed(() => {
  const p = progress.value;
  const first = p.waiting[0];
  const next = first
    ? ` Next: ${waitingText(first, props.detail.problems.length)}`
    : p.current === 'certified'
      ? ' The election is complete.'
      : '';
  return `Current step: ${STEP_LABELS[p.current]}.${next}`;
});

const ICONS: Record<StepStatus, string | null> = {
  done: 'check',
  current: 'play_arrow',
  upcoming: null,
  possible: null,
  not_reached: 'remove',
};

</script>

<template>
  <q-card flat bordered tag="section" aria-labelledby="workflow-title">
    <q-card-section>
      <h2 id="workflow-title" class="text-subtitle1">Where this election is</h2>
      <div class="text-caption text-grey-7">{{ summary }}</div>
    </q-card-section>
    <q-card-section class="workflow">
      <div class="workflow__diagram">
        <!-- The list beside it is the text version; the picture is one image to assistive technology. -->
        <div
          role="img"
          :aria-label="`Swim lanes of the steps listed with it, showing who does each: an Election Admin, an Auditor, the worker or the members on the roll. The current step, ${STEP_LABELS[progress.current]}, is highlighted.`"
        >
          <ElectionLanes :progress="progress" :election="detail.election" />
        </div>
        <div class="text-caption text-grey-7 q-mt-xs" aria-hidden="true">
          ✓ done · ▶ current step · – not reached · dashed: a way out, or not reached
        </div>
      </div>

      <div class="workflow__list">
        <template v-for="group in GROUPS" :key="group.label">
          <h3 v-if="group.heading" class="text-subtitle2 q-mt-md">{{ group.label }}</h3>
          <component :is="group.tag" class="workflow-steps" :aria-label="group.label">
            <li
              v-for="step in group.steps"
              :key="step"
              :aria-current="status.get(step) === 'current' ? 'step' : undefined"
              :class="`workflow-steps__item workflow-steps__item--${status.get(step)}`"
            >
              <span
                class="workflow-steps__marker"
                :class="status.get(step) === 'current' ? 'bg-primary text-white' : ''"
                aria-hidden="true"
              >
                <q-icon v-if="ICONS[status.get(step)!]" :name="ICONS[status.get(step)!]!" size="16px" />
              </span>
              <div>
                <div
                  :class="{
                    'text-primary text-weight-bold': status.get(step) === 'current',
                    'text-grey-7': status.get(step) === 'not_reached',
                  }"
                >
                  <span class="sr-only">{{ STATUS_TEXT[status.get(step)!] }}:&nbsp;</span>
                  <span v-if="stateOf(step)" class="workflow-steps__state">{{ stateOf(step) }} · </span>{{ STEP_LABELS[step] }}
                </div>
                <div class="text-caption text-grey-7">{{ note(step) }}</div>
                <ul v-if="waitingAt(step).length" class="workflow-steps__waiting">
                  <li v-for="w in waitingAt(step)" :key="w"><span class="text-weight-medium">Waiting:</span> {{ w }}</li>
                </ul>
              </div>
            </li>
          </component>
        </template>
      </div>
    </q-card-section>
  </q-card>
</template>

<style scoped>
.workflow {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 32px;
}
.workflow__diagram {
  flex: 1 1 240px;
  min-width: 0;
}
.workflow__list {
  flex: 1 1 280px;
  min-width: 0;
}
.workflow-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.workflow-steps__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.workflow-steps__marker {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 2px solid currentColor;
  border-radius: 50%;
}
.workflow-steps__marker.bg-primary {
  border-color: var(--q-primary);
}
.workflow-steps__item--possible .workflow-steps__marker,
.workflow-steps__item--not_reached .workflow-steps__marker {
  border-style: dashed;
}
.workflow-steps__state {
  font-weight: normal;
}
.workflow-steps__waiting {
  margin: 4px 0 0;
  padding-left: 18px;
}
</style>
