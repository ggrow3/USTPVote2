<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  checkFirstSteps,
  DEFAULT_FIRST_STEPS,
  FIRST_STEP_CHECK_LABELS,
  FIRST_STEP_CHECKS,
  FIRST_STEP_LABELS,
  FIRST_STEPS_LIMITS as L,
  firstStepLinkProblem,
  firstStepsDiffer,
  firstStepsList,
  MENU_LINKS,
  tidyFirstStep,
  type FirstStep,
  type FirstStepSetting,
  type FirstStepsRecord,
  type FirstStepsSettings,
} from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { firstStepsSettings, saveFirstSteps } from './api.js';
import { firstStepsCaption, newFirstStepId } from './first-steps-text.js';
import FirstStepsList from './FirstStepsList.vue';

/**
 * The getting started list (design §5.16): Membership Admins choose the steps new members see on their voting home,
 * their words, links and order, and how each is ticked: by one of the site's own records, or by the member.
 */

type DraftStep = { -readonly [K in keyof FirstStepSetting]: FirstStepSetting[K] };

const copy = (settings: FirstStepsSettings): DraftStep[] => settings.steps.map((s) => ({ ...s }));

const saved = ref<FirstStepsRecord | null>(null);
/** The steps being edited; shown once the saved list has loaded into them. */
const draft = ref<DraftStep[]>([]);
/** What the draft amounts to: each step's words on one line, its link trimmed. */
const resolved = computed<FirstStepsSettings>(() => ({ steps: draft.value.map(tidyFirstStep) }));
const changed = computed(() => !!saved.value && firstStepsDiffer(saved.value, resolved.value));
const problem = computed(() => {
  const check = checkFirstSteps(resolved.value);
  return check.ok ? null : check.reason;
});
const isDefault = computed(() => !firstStepsDiffer(DEFAULT_FIRST_STEPS, resolved.value));
const savedAt = computed(() => (saved.value?.updatedAt ? new Date(saved.value.updatedAt).toLocaleString() : null));

// Bound rather than written in the template: vue-tsc 3.3.13 loses the v-for's names after a `//` in a plain attribute.
const linkHint = 'A page on this site, such as /courses, or an https:// address';

const capital = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;
/** Each step's field errors, shown under the field. */
const errors = computed(() =>
  resolved.value.steps.map((s) => {
    const link = s.link ? firstStepLinkProblem(s.link) : 'Needed';
    return {
      label: !s.label ? 'Needed' : s.label.length > L.label ? `Over ${L.label} characters` : undefined,
      why: s.why.length > L.why ? `Over ${L.why} characters` : undefined,
      link: link ? capital(link) : undefined,
    };
  }),
);
/** The ways each step can be ticked: one of the site's checks already ticking another step is greyed out. */
const checkOptions = computed(() =>
  draft.value.map((_, i) =>
    FIRST_STEP_CHECKS.map((check) => ({
      value: check,
      label: FIRST_STEP_CHECK_LABELS[check],
      disable: check !== 'self' && draft.value.some((other, j) => j !== i && other.check === check),
    })),
  ),
);

// The preview's own ticks and records, so trying it changes nothing. It shows every step, whatever the navigation
// settings hide.
const previewDone = ref<FirstStep[]>([]);
const previewTicked = ref<string[]>([]);
const previewItems = computed(() =>
  firstStepsList({ memberSince: 'preview', done: previewDone.value, steps: resolved.value.steps, ticked: previewTicked.value }, MENU_LINKS),
);
/** The site's records the preview can pretend the member has: those a step on the list is ticked by. */
const previewDoneOptions = computed(() =>
  [...new Set(resolved.value.steps.map((s) => s.check))].flatMap((check) => (check === 'self' ? [] : [{ value: check, label: FIRST_STEP_LABELS[check] }])),
);
const previewCaption = computed(() => firstStepsCaption(previewItems.value));

function previewTick(id: string, done: boolean) {
  previewTicked.value = done ? [...previewTicked.value, id] : previewTicked.value.filter((t) => t !== id);
}

function addStep() {
  draft.value.push({ id: newFirstStepId(draft.value.map((s) => s.id)), label: '', why: '', link: '', check: 'self' });
}

function removeStep(i: number) {
  draft.value.splice(i, 1);
}

function moveStep(i: number, by: -1 | 1) {
  const steps = draft.value;
  if (i + by < 0 || i + by >= steps.length) return;
  [steps[i], steps[i + by]] = [steps[i + by]!, steps[i]!];
}

async function load() {
  await attempt(async () => {
    saved.value = await firstStepsSettings();
    draft.value = copy(saved.value);
  });
}

async function save() {
  if (!saved.value) return;
  const steps = resolved.value.steps.map((s) => ({ ...s }));
  await attempt(async () => {
    saved.value = await saveFirstSteps({ basedOn: saved.value!.version, steps });
    draft.value = copy(saved.value);
  }, 'Saved. Members see the new list on their voting home from now on.');
}

function restoreDefault() {
  draft.value = copy(DEFAULT_FIRST_STEPS);
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <div>
      <h2 class="text-subtitle1">Getting started</h2>
      <div class="text-caption text-grey-7">
        <template v-if="saved?.version">Version {{ saved.version }}, saved {{ savedAt }}.</template>
        <template v-else-if="saved">The default: nobody has changed it yet.</template>
      </div>
    </div>
    <p>
      The list Active members see at the top of their voting home, so that someone just approved knows what to do
      first. Each step links to a page on this site or to an https:// address elsewhere, which opens in a new tab. A
      step whose page the navigation settings hide from a member is left out of their list.
    </p>
    <p>
      The site ticks a step itself when one of its records says the member did it: started a course, joined a team,
      entered the members’ room, posted or commented in the forum, or cast a ballot. Each of these can tick one step.
      For anything else, such as reading the bylaws, choose “When they tick it themselves”: the member gets a box to
      tick. The list goes away once every step on it is done, or when the member hides it; a member who hid it does not
      see it again when steps are added. With no steps at all, nobody sees a list.
    </p>

    <q-card v-if="saved" flat bordered>
      <q-card-section class="ustp-form">
        <h3 class="text-subtitle2">Steps, in the order members see them</h3>
        <p v-if="!draft.length" class="text-grey-7 q-mb-none">No steps: members see no getting started list.</p>
        <ol class="steps-editor">
          <li v-for="(step, i) in draft" :key="step.id" class="steps-editor__row">
            <fieldset class="steps-editor__fields ustp-form">
              <legend class="text-subtitle2">Step {{ i + 1 }}</legend>
              <q-input
                v-model="step.label"
                outlined
                dense
                counter
                label="What to do"
                hint="The words members click, such as “Join a team”"
                :error="!!errors[i]?.label"
                :error-message="errors[i]?.label"
              />
              <q-input
                v-model="step.why"
                outlined
                dense
                counter
                autogrow
                type="textarea"
                label="What it is for (optional)"
                :error="!!errors[i]?.why"
                :error-message="errors[i]?.why"
              />
              <q-input
                v-model="step.link"
                outlined
                dense
                label="Link"
                :hint="linkHint"
                :error="!!errors[i]?.link"
                :error-message="errors[i]?.link"
              />
              <q-select v-model="step.check" outlined dense emit-value map-options :options="checkOptions[i]" label="Ticked" />
            </fieldset>
            <div class="steps-editor__actions">
              <q-btn flat dense round icon="arrow_upward" :disable="i === 0" :aria-label="`Move Step ${i + 1} up`" @click="moveStep(i, -1)" />
              <q-btn
                flat
                dense
                round
                icon="arrow_downward"
                :disable="i === draft.length - 1"
                :aria-label="`Move Step ${i + 1} down`"
                @click="moveStep(i, 1)"
              />
              <q-btn flat dense round icon="delete" :aria-label="`Remove Step ${i + 1}`" @click="removeStep(i)" />
            </div>
          </li>
        </ol>
        <div class="ustp-actions">
          <q-btn outline no-caps color="primary" icon="add" label="Add a step" :disable="draft.length >= L.steps" @click="addStep" />
          <span v-if="draft.length >= L.steps" class="text-caption text-grey-7 self-center">At most {{ L.steps }} steps.</span>
        </div>
      </q-card-section>

      <q-separator />
      <q-card-section>
        <h3 class="text-subtitle2 q-mb-sm">Preview</h3>
        <div class="steps-preview">
          <template v-if="previewItems.length">
            <div class="text-subtitle1">Getting started</div>
            <div class="text-caption text-grey-7">{{ previewCaption }}</div>
            <FirstStepsList :items="previewItems" @tick="previewTick" />
            <q-select
              v-if="previewDoneOptions.length"
              v-model="previewDone"
              class="q-mt-sm"
              outlined
              dense
              multiple
              emit-value
              map-options
              :options="previewDoneOptions"
              label="Try it: what the member has done on the site"
            />
          </template>
          <p v-else class="text-grey-7 q-mb-none">No steps: the voting home shows no list.</p>
        </div>
      </q-card-section>

      <q-card-section v-if="changed" class="text-subtitle2">Not saved yet.</q-card-section>
      <q-card-section v-if="problem && changed" class="text-negative" role="alert">Can't save yet: {{ problem }}.</q-card-section>
      <q-card-section class="ustp-actions">
        <q-btn color="primary" label="Save changes" :disable="!changed || !!problem" @click="save" />
        <q-btn flat color="primary" label="Discard changes" :disable="!changed" @click="load" />
        <q-btn flat color="primary" label="Restore the default" :disable="isDefault" @click="restoreDefault" />
      </q-card-section>
    </q-card>
  </div>
</template>

<style scoped>
.steps-editor {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.steps-editor__row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.steps-editor__fields {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.steps-editor__fields > legend {
  padding: 0;
  margin-bottom: 4px;
}
.steps-editor__actions {
  display: flex;
  flex-direction: column;
  padding-top: 24px;
}
/* The list as members see it, set apart from the fields above. */
.steps-preview {
  padding: 16px;
  border: 1px dashed rgba(0, 0, 0, 0.24);
  border-radius: 8px;
}
.body--dark .steps-preview {
  border-color: rgba(255, 255, 255, 0.36);
}
</style>
