<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  checkRegistrationForm,
  DEFAULT_REGISTRATION_FORM,
  REGISTRATION_FIELDS,
  REGISTRATION_FORM_LIMITS as L,
  registrationFormChanges,
  resolveRegistrationForm,
  tipsAddressProblem,
  type RegistrationForm,
  type RegistrationFormFields,
  type RegistrationFormRecord,
} from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { registrationFormSettings, saveRegistrationForm } from './api.js';
import MembershipQuestions from './MembershipQuestions.vue';
import { describeFormChange, FIELD_LABELS, settingOptions } from './registration-form-text.js';
import RegistrationIntro from './RegistrationIntro.vue';

/**
 * The registration form's wording (design §5.2): Membership Admins change the heading and intro on the Register page,
 * the two questions and their help, the Core Ideals, and the bonus link applicants get; and which fields the
 * application asks, each required, optional or not shown. What the answers mean stays as it is.
 */

type Draft = Omit<RegistrationForm, 'ideals' | 'fields'> & { ideals: string[]; fields: { -readonly [F in keyof RegistrationFormFields]: RegistrationFormFields[F] } };

const copy = (form: RegistrationForm): Draft => ({ ...form, ideals: [...form.ideals], fields: { ...form.fields } });

const saved = ref<RegistrationFormRecord | null>(null);
/** The fields being edited; shown once the saved version has loaded into them. */
const draft = ref<Draft>(copy(DEFAULT_REGISTRATION_FORM));
/** What the draft amounts to: each part tidied, empty ideals dropped. */
const resolved = computed(() => resolveRegistrationForm(draft.value));
const changes = computed(() => (saved.value ? registrationFormChanges(saved.value, resolved.value) : []));
const problem = computed(() => {
  const check = checkRegistrationForm(resolved.value);
  return check.ok ? null : check.reason;
});
const isDefault = computed(() => registrationFormChanges(DEFAULT_REGISTRATION_FORM, resolved.value).length === 0);
const savedAt = computed(() => (saved.value?.updatedAt ? new Date(saved.value.updatedAt).toLocaleString() : null));

// The preview's own answers, so trying it changes nothing.
const previewVoter = ref<boolean | null>(null);
const previewIdeals = ref<boolean | null>(null);

/** Why a one-line or paragraph part cannot be saved, if it cannot. */
function partError(part: 'title' | 'usVoterQuestion' | 'coreIdealsQuestion' | 'idealsTitle' | 'tipsTitle', max: number): string | undefined {
  const value = resolved.value[part];
  if (value.length > max) return `Over ${max} characters`;
  if (!value && part !== 'tipsTitle') return 'Needed';
  if (!value && part === 'tipsTitle' && resolved.value.tipsAddress) return 'Needed while there is an address';
  return undefined;
}
const tooLong = (value: string, max: number) => (value.length > max ? `Over ${max} characters` : undefined);
const addressError = computed(() => {
  const p = tipsAddressProblem(resolved.value.tipsAddress);
  return p ? `${p[0]!.toUpperCase()}${p.slice(1)}` : undefined;
});

function addIdeal() {
  draft.value.ideals.push('');
}

function removeIdeal(i: number) {
  draft.value.ideals.splice(i, 1);
}

function moveIdeal(i: number, by: -1 | 1) {
  const ideals = draft.value.ideals;
  if (i + by < 0 || i + by >= ideals.length) return;
  [ideals[i], ideals[i + by]] = [ideals[i + by]!, ideals[i]!];
}

async function load() {
  await attempt(async () => {
    saved.value = await registrationFormSettings();
    draft.value = copy(saved.value);
  });
}

async function save() {
  if (!saved.value) return;
  const form = resolved.value;
  await attempt(async () => {
    saved.value = await saveRegistrationForm({ basedOn: saved.value!.version, ...form, ideals: [...form.ideals] });
    draft.value = copy(saved.value);
  }, 'Saved. The Register page shows it to everyone from now on.');
}

function restoreDefault() {
  draft.value = copy(DEFAULT_REGISTRATION_FORM);
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <div>
      <h2 class="text-subtitle1">The registration form</h2>
      <div class="text-caption text-grey-7">
        <template v-if="saved?.version">Version {{ saved.version }}, saved {{ savedAt }}.</template>
        <template v-else-if="saved">The default: nobody has changed it yet.</template>
      </div>
    </div>
    <p>
      The Register page's heading and the intro above its steps, the application's two membership questions and their
      help, the Core Ideals shown before the second question, the link applicants get once they have applied, and
      which fields the application asks. Each application records the version it answered, and is refused if the form
      changed while it was being filled in, so the applicant reads the new form first.
    </p>
    <p>
      What the answers mean stays as it is, whatever the wording: Yes to the first question makes a United States
      Member and No an Allied Member, and the second records whether they agree with the Core Ideals. Neither answer
      stops anyone from joining.
    </p>

    <q-card v-if="saved" flat bordered>
      <q-card-section class="ustp-form">
        <h3 class="text-subtitle2">Heading and intro</h3>
        <q-input
          v-model="draft.title"
          outlined
          dense
          counter
          label="Page heading"
          :error="!!partError('title', L.title)"
          :error-message="partError('title', L.title)"
        />
        <q-input
          v-model="draft.intro"
          type="textarea"
          autogrow
          outlined
          dense
          counter
          label="Intro (optional)"
          hint="Plain text. Leave a blank line between paragraphs. Empty shows no intro."
          :error="!!tooLong(resolved.intro, L.intro)"
          :error-message="tooLong(resolved.intro, L.intro)"
        />
      </q-card-section>

      <q-separator />
      <q-card-section class="ustp-form">
        <h3 class="text-subtitle2">First question: the member's class</h3>
        <q-input
          v-model="draft.usVoterQuestion"
          outlined
          dense
          counter
          label="Question"
          :error="!!partError('usVoterQuestion', L.question)"
          :error-message="partError('usVoterQuestion', L.question)"
        />
        <q-input
          v-model="draft.usVoterHelp"
          type="textarea"
          autogrow
          outlined
          dense
          counter
          label="Help (optional)"
          :error="!!tooLong(resolved.usVoterHelp, L.help)"
          :error-message="tooLong(resolved.usVoterHelp, L.help)"
        />
      </q-card-section>

      <q-separator />
      <q-card-section class="ustp-form">
        <h3 class="text-subtitle2">Core Ideals, shown before the second question</h3>
        <q-input
          v-model="draft.idealsTitle"
          outlined
          dense
          counter
          label="Heading"
          :error="!!partError('idealsTitle', L.idealsTitle)"
          :error-message="partError('idealsTitle', L.idealsTitle)"
        />
        <ol class="ideals-editor">
          <li v-for="(_, i) in draft.ideals" :key="i" class="ideals-editor__row">
            <q-input
              v-model="draft.ideals[i]"
              class="ideals-editor__text"
              type="textarea"
              autogrow
              outlined
              dense
              :label="`Ideal ${i + 1}`"
              :error="(draft.ideals[i] ?? '').trim().length > L.ideal"
              :error-message="`Over ${L.ideal} characters`"
            />
            <div class="ideals-editor__actions">
              <q-btn flat dense round icon="arrow_upward" :disable="i === 0" :aria-label="`Move Ideal ${i + 1} up`" @click="moveIdeal(i, -1)" />
              <q-btn
                flat
                dense
                round
                icon="arrow_downward"
                :disable="i === draft.ideals.length - 1"
                :aria-label="`Move Ideal ${i + 1} down`"
                @click="moveIdeal(i, 1)"
              />
              <q-btn flat dense round icon="delete" :aria-label="`Remove Ideal ${i + 1}`" @click="removeIdeal(i)" />
            </div>
          </li>
        </ol>
        <div class="ustp-actions">
          <q-btn outline no-caps color="primary" icon="add" label="Add an ideal" :disable="draft.ideals.length >= L.ideals" @click="addIdeal" />
        </div>
        <div v-if="!resolved.ideals.length" class="ustp-message text-negative" role="alert">List at least one Core Ideal.</div>
      </q-card-section>

      <q-separator />
      <q-card-section class="ustp-form">
        <h3 class="text-subtitle2">Second question: agreeing with the Core Ideals</h3>
        <q-input
          v-model="draft.coreIdealsQuestion"
          outlined
          dense
          counter
          label="Question"
          :error="!!partError('coreIdealsQuestion', L.question)"
          :error-message="partError('coreIdealsQuestion', L.question)"
        />
        <q-input
          v-model="draft.coreIdealsHelp"
          type="textarea"
          autogrow
          outlined
          dense
          counter
          label="Help (optional)"
          :error="!!tooLong(resolved.coreIdealsHelp, L.help)"
          :error-message="tooLong(resolved.coreIdealsHelp, L.help)"
        />
      </q-card-section>

      <q-separator />
      <q-card-section class="ustp-form">
        <h3 class="text-subtitle2">Bonus link, shown once someone has applied</h3>
        <q-input
          v-model="draft.tipsTitle"
          outlined
          dense
          counter
          label="Title"
          :error="!!partError('tipsTitle', L.tipsTitle)"
          :error-message="partError('tipsTitle', L.tipsTitle)"
        />
        <q-input
          v-model="draft.tipsAddress"
          outlined
          dense
          type="url"
          label="Address (optional)"
          hint="An https:// address. Empty shows no link."
          :error="!!addressError"
          :error-message="addressError"
        />
      </q-card-section>

      <q-separator />
      <q-card-section class="ustp-form">
        <h3 class="text-subtitle2">Fields the application asks</h3>
        <div class="text-body2">
          Set each field to required, optional or not shown. The legal name, the bylaws, the age confirmation and the two
          membership questions are always asked. For the state, city and ZIP code, required means required of people in
          the United States: elsewhere they stay optional, since not every country has them. An answer to a field that
          is not shown is never kept.
        </div>
        <div class="field-settings">
          <q-select
            v-for="field in REGISTRATION_FIELDS"
            :key="field"
            v-model="draft.fields[field]"
            outlined
            dense
            emit-value
            map-options
            :options="settingOptions(field)"
            :label="FIELD_LABELS[field]"
          />
        </div>
        <div v-if="resolved.fields.country === 'hidden'" class="ustp-message text-body2" role="status">
          Without the country, every applicant is taken to live in the United States, and people elsewhere cannot say so.
        </div>
        <div v-if="resolved.fields.dateOfBirth !== 'required'" class="ustp-message text-body2" role="status">
          Without a date of birth, an applicant's age rests on the box they tick to confirm it.
        </div>
        <div class="text-caption text-grey-7">
          Members' own details follow the same rules: what is not required here is not required on their Account page
          either, where they can still fill in a field this form does not show.
        </div>
      </q-card-section>

      <q-separator />
      <q-card-section>
        <h3 class="text-subtitle2 q-mb-sm">Preview</h3>
        <div class="form-preview ustp-stack">
          <h4 class="text-h5 q-my-none">{{ resolved.title }}</h4>
          <RegistrationIntro :intro="resolved.intro" />
          <p v-if="!resolved.intro" class="text-grey-7 q-mb-none">No intro: the Register page starts with its steps.</p>
          <MembershipQuestions
            v-model:us-vote-eligible="previewVoter"
            v-model:agrees-with-core-ideals="previewIdeals"
            :form="resolved"
            :heading-level="4"
          />
          <p v-if="resolved.tipsAddress" class="q-mb-none">
            After applying: <a :href="resolved.tipsAddress">{{ resolved.tipsTitle }}</a>.
          </p>
          <p class="text-grey-7 q-mb-none">The fields are not previewed here: open the Register page to see them.</p>
        </div>
      </q-card-section>

      <q-card-section v-if="changes.length">
        <h3 class="text-subtitle2">Not saved yet: {{ changes.length === 1 ? '1 change' : `${changes.length} changes` }}</h3>
        <ul class="q-mt-sm q-mb-none">
          <li v-for="c in changes" :key="c.part" class="form-change">{{ describeFormChange(c) }}</li>
        </ul>
      </q-card-section>
      <q-card-section v-if="problem && changes.length" class="text-negative" role="alert">Can't save yet: {{ problem }}.</q-card-section>
      <q-card-section class="ustp-actions">
        <q-btn color="primary" label="Save changes" :disable="!changes.length || !!problem" @click="save" />
        <q-btn flat color="primary" label="Discard changes" :disable="!changes.length" @click="load" />
        <q-btn flat color="primary" label="Restore the default" :disable="isDefault" @click="restoreDefault" />
      </q-card-section>
    </q-card>
  </div>
</template>

<style scoped>
.ideals-editor {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ideals-editor__row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.ideals-editor__text {
  flex: 1;
}
.ideals-editor__actions {
  display: flex;
  padding-top: 4px;
}
/* One picker per field, as many across as fit. */
.field-settings {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 12px 16px;
}
/* The form as applicants see it, set apart from the fields above. */
.form-preview {
  padding: 16px;
  border: 1px dashed rgba(0, 0, 0, 0.24);
  border-radius: 8px;
}
.body--dark .form-preview {
  border-color: rgba(255, 255, 255, 0.36);
}
.form-change {
  white-space: pre-line;
}
</style>
