<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { closingProblem, createPollSchema, POLL_LIMITS, updatePollSchema, type AdminPoll, type PollState } from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { confirmAction } from './admin-forms.js';
import { adminPolls, closePollNow, createPoll, deletePoll, publishPollNow, savePoll } from './api.js';
import { formatHashtags, fromLocalInput, longDate, parseHashtags, shortTime, toLocalInput } from './comms-text.js';
import PollBars from './PollBars.vue';
import { answersText, pollPath } from './polls.js';

/**
 * Issue polls for Communications Admins (design §10.16): drafts, publishing (open at once until the closing time),
 * closing early and deleting. A published poll's question and choices no longer change. Nothing is ledgered.
 */
const polls = ref<AdminPoll[] | null>(null);

interface Form {
  question: string;
  description: string;
  choices: string[];
  hashtags: string;
  /** A local `YYYY-MM-DDTHH:mm`, or empty. */
  closesAt: string;
}
const STATE_LABELS: Readonly<Record<PollState, string>> = { draft: 'Draft', open: 'Open', closed: 'Closed' };
const STATE_COLORS: Readonly<Record<PollState, string>> = { draft: 'orange-9', open: 'positive', closed: 'grey-7' };

const editing = ref(false);
const current = ref<AdminPoll | null>(null);
const inAWeek = () => toLocalInput(new Date(Date.now() + 7 * 86_400_000).toISOString());
const blank = (): Form => ({ question: '', description: '', choices: ['Yes', 'No', 'Not sure'], hashtags: '', closesAt: inAWeek() });
const form = ref<Form>(blank());
const errors = ref<FieldErrors>({});
const busy = ref(false);

async function load() {
  await attempt(async () => {
    polls.value = await adminPolls();
  });
}

const toForm = (p: AdminPoll): Form => ({
  question: p.question,
  description: p.description,
  choices: p.choices.map((c) => c.label),
  hashtags: formatHashtags(p.hashtags),
  closesAt: p.closesAt ? toLocalInput(p.closesAt) : '',
});

function startNew() {
  current.value = null;
  form.value = blank();
  errors.value = {};
  editing.value = true;
}

function open(p: AdminPoll) {
  current.value = p;
  form.value = toForm(p);
  errors.value = {};
  editing.value = true;
}

const draftOpen = computed(() => !current.value || current.value.state === 'draft');
const dirty = computed(() => editing.value && (!current.value || JSON.stringify(toForm(current.value)) !== JSON.stringify(form.value)));
const notReady = computed(() => (draftOpen.value ? closingProblem(form.value.closesAt ? fromLocalInput(form.value.closesAt) : null, new Date()) : null));
const choiceError = (i: number) => errors.value[`choices.${i}`];

function addChoice() {
  if (form.value.choices.length < POLL_LIMITS.maxChoices) form.value.choices.push('');
}
function removeChoice(i: number) {
  if (form.value.choices.length > POLL_LIMITS.minChoices) form.value.choices.splice(i, 1);
}

/** Saves the draft (new, or changed) and returns it as saved; null if refused. */
async function save(): Promise<AdminPoll | null> {
  const poll = current.value;
  const body = {
    question: form.value.question,
    description: form.value.description,
    choices: form.value.choices,
    hashtags: parseHashtags(form.value.hashtags),
    closesAt: form.value.closesAt ? fromLocalInput(form.value.closesAt) || null : null,
  };
  const checked = poll ? validate(updatePollSchema, { ...body, basedOn: poll.version }) : validate(createPollSchema, body);
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return null;
  }
  errors.value = {};
  let saved = null as AdminPoll | null;
  busy.value = true;
  try {
    await attempt(async () => {
      try {
        saved = poll ? await savePoll(poll.pollId, checked.data as Parameters<typeof savePoll>[1]) : await createPoll(checked.data as Parameters<typeof createPoll>[0]);
      } catch (err) {
        errors.value = apiFieldErrors(err);
        throw err;
      }
    }, 'Draft saved');
  } finally {
    busy.value = false;
  }
  if (saved) {
    open(saved);
    await load();
  }
  return saved;
}

async function publish() {
  const poll = dirty.value ? await save() : current.value;
  if (!poll || !poll.closesAt) return;
  const ok = await confirmAction(
    'Publish this poll?',
    `“${poll.question}” goes on the public Polls page at once, open to anyone until ${shortTime(poll.closesAt)}. Its question and choices cannot change afterwards.`,
    'Publish',
  );
  if (!ok) return;
  let published = null as AdminPoll | null;
  await attempt(async () => {
    published = await publishPollNow(poll.pollId, poll.version);
  }, 'Published');
  if (published) {
    open(published);
    await load();
  }
}

async function closeNow() {
  const poll = current.value;
  if (!poll || !(await confirmAction('Close this poll now?', 'No more answers are taken, and everyone sees its results. It cannot be opened again.', 'Close now'))) return;
  let closed = null as AdminPoll | null;
  await attempt(async () => {
    closed = await closePollNow(poll.pollId, poll.version);
  }, 'Closed');
  if (closed) {
    open(closed);
    await load();
  }
}

async function remove() {
  const poll = current.value;
  if (!poll) return;
  const what = poll.state === 'draft' ? 'This draft' : 'The poll, its page and its results';
  if (!(await confirmAction('Delete this poll?', `${what} will be deleted for good, and links to it will stop working.`, 'Delete'))) return;
  if (await attempt(() => deletePoll(poll.pollId), 'Poll deleted')) {
    editing.value = false;
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <p class="text-grey-7">
      Questions of the day anyone may answer on the public <router-link to="/polls">Polls page</router-link>, signed in or
      not, once each. A poll decides nothing and is not an election; it is not in the audit ledger. People who answer see
      the results so far; everyone sees them at the close, and links shared after that show them as bars.
    </p>
    <div class="ustp-actions">
      <q-btn v-if="!editing" unelevated no-caps color="primary" icon="add" label="New poll" @click="startNew" />
    </div>

    <q-card v-if="editing" flat bordered>
      <q-card-section class="ustp-header">
        <div>
          <h2 class="text-subtitle1">{{ current ? current.question : 'New poll' }}</h2>
          <div v-if="current" class="text-caption text-grey-7">
            <q-badge :color="STATE_COLORS[current.state]" :label="STATE_LABELS[current.state]" />
            <template v-if="current.publishedAt"> · published {{ longDate(current.publishedAt) }}</template>
            <template v-if="current.state === 'open' && current.closesAt"> · closes {{ shortTime(current.closesAt) }}</template>
            <template v-if="current.closedAt"> · closed early {{ shortTime(current.closedAt) }}</template>
            <template v-if="current.state !== 'draft'"> · shared {{ current.shared }} {{ current.shared === 1 ? 'time' : 'times' }}</template>
          </div>
        </div>
        <q-btn
          v-if="current && current.state !== 'draft'"
          flat
          no-caps
          color="primary"
          icon-right="north_east"
          label="View"
          :to="pollPath(current.pollId)"
          target="_blank"
          aria-label="View the poll (opens in a new tab)"
        />
      </q-card-section>

      <q-card-section v-if="draftOpen">
        <q-form class="ustp-form" novalidate @submit.prevent="save">
          <q-input
            v-model="form.question"
            outlined
            label="Question"
            placeholder="Should Congress fund longevity research?"
            :maxlength="POLL_LIMITS.question"
            counter
            :error="!!errors.question"
            :error-message="errors.question"
          />
          <q-input
            v-model="form.description"
            outlined
            type="textarea"
            autogrow
            label="About this question (optional)"
            hint="Plain text, shown under the question."
            :maxlength="POLL_LIMITS.description"
            counter
          />
          <fieldset class="ustp-fieldset">
            <legend>Choices ({{ POLL_LIMITS.minChoices }} to {{ POLL_LIMITS.maxChoices }})</legend>
            <div class="ustp-form">
              <div v-for="(_, i) in form.choices" :key="i" class="poll-admin__choice">
                <q-input
                  v-model="form.choices[i]"
                  outlined
                  dense
                  :label="`Choice ${i + 1}`"
                  :maxlength="POLL_LIMITS.choice"
                  :error="!!choiceError(i)"
                  :error-message="choiceError(i)"
                  class="col"
                />
                <q-btn
                  flat
                  round
                  dense
                  icon="close"
                  :disable="form.choices.length <= POLL_LIMITS.minChoices"
                  :aria-label="`Remove choice ${i + 1}`"
                  @click="removeChoice(i)"
                />
              </div>
              <div v-if="errors.choices" class="text-negative text-caption" role="alert">{{ errors.choices }}</div>
              <div>
                <q-btn flat no-caps color="primary" icon="add" label="Add a choice" :disable="form.choices.length >= POLL_LIMITS.maxChoices" @click="addChoice" />
              </div>
            </div>
          </fieldset>
          <q-input
            v-model="form.closesAt"
            outlined
            dense
            type="datetime-local"
            label="Closes"
            stack-label
            hint="In your time zone. From 10 minutes to 90 days after it is published."
            :error="!!errors.closesAt"
            :error-message="errors.closesAt"
          />
          <q-input
            v-model="form.hashtags"
            outlined
            dense
            label="Hashtags (optional)"
            placeholder="#USTP #Longevity"
            hint="Up to 5; share buttons add them."
            :error="!!errors.hashtags || Object.keys(errors).some((k) => k.startsWith('hashtags.'))"
            :error-message="errors.hashtags ?? Object.entries(errors).find(([k]) => k.startsWith('hashtags.'))?.[1]"
          />
          <div class="ustp-actions">
            <q-btn type="submit" unelevated no-caps color="primary" label="Save draft" :disable="!dirty" :loading="busy" />
            <q-btn outline no-caps color="primary" icon="campaign" label="Publish" :disable="!!notReady || busy" @click="publish" />
            <q-btn v-if="current" flat no-caps color="negative" label="Delete draft" @click="remove" />
            <q-btn flat no-caps label="Close" @click="editing = false" />
          </div>
          <div v-if="notReady" class="text-caption text-grey-7">To publish: {{ notReady }}.</div>
        </q-form>
      </q-card-section>

      <q-card-section v-else-if="current">
        <p v-if="current.description" class="poll-admin__description">{{ current.description }}</p>
        <div class="text-caption text-grey-7 q-mb-sm">
          {{ current.state === 'open' ? 'Running results, which only people who answered see until the close' : 'Final results' }}:
          {{ answersText(current.results.everyone.total) }}.
        </div>
        <PollBars :choices="current.choices" :results="current.results" />
        <div class="ustp-actions q-mt-md">
          <q-btn v-if="current.state === 'open'" outline no-caps color="primary" label="Close now" @click="closeNow" />
          <q-btn flat no-caps color="negative" label="Delete poll" @click="remove" />
          <q-btn flat no-caps label="Close" @click="editing = false" />
        </div>
      </q-card-section>
    </q-card>

    <div v-if="polls && polls.length === 0 && !editing" class="text-grey-7">No polls yet.</div>
    <q-list v-else-if="polls" bordered separator class="rounded-borders">
      <q-item v-for="p in polls" :key="p.pollId" clickable :active="editing && current?.pollId === p.pollId" @click="open(p)">
        <q-item-section>
          <q-item-label>{{ p.question }}</q-item-label>
          <q-item-label caption>
            <template v-if="p.state === 'draft'">changed {{ longDate(p.updatedAt) }}</template>
            <template v-else>{{ answersText(p.results.everyone.total) }} · {{ p.state === 'open' ? 'closes' : 'closed' }} {{ shortTime(p.closedAt ?? p.closesAt!) }}</template>
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-badge :color="STATE_COLORS[p.state]" :label="STATE_LABELS[p.state]" />
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<style scoped>
.poll-admin__choice {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.poll-admin__description {
  white-space: pre-line;
}
</style>
