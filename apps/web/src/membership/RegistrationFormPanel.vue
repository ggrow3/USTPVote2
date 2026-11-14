<script setup lang="ts">
import { useQuasar } from 'quasar';
import { computed, nextTick, onMounted, ref } from 'vue';
import {
  bylawsInForce,
  checkRegistrationForm,
  DEFAULT_REGISTRATION_FORM,
  nextBylawsVersion,
  publishedBylawsText,
  REGISTRATION_FIELDS,
  REGISTRATION_FORM_LIMITS as L,
  registrationFormChanges,
  resolveRegistrationForm,
  splitLines,
  tipsAddressProblem,
  type BylawsCheckScope,
  type BylawsRecord,
  type BylawsVersionSummary,
  type RegistrationForm,
  type RegistrationFormFields,
  type RegistrationFormRecord,
} from 'ustp-domain';
import { focusElement } from '../a11y.js';
import { useBylawsCheck } from '../bylaws-check.js';
import BylawsCheckSection from '../components/admin/BylawsCheckSection.vue';
import { attempt } from '../dialogs.js';
import { bylawsVersions, currentBylaws, publishBylaws, registrationFormSettings, saveRegistrationForm } from './api.js';
import MembershipQuestions from './MembershipQuestions.vue';
import { describeFormChange, FIELD_LABELS, settingOptions } from './registration-form-text.js';
import RegistrationIntro from './RegistrationIntro.vue';

/**
 * The registration form (design §5.2): Membership Admins change the heading and intro on the Register page, the bylaws
 * applicants agree to, the two questions and their help, the Core Ideals, and the bonus link applicants get; and which
 * fields the application asks, each required, optional or not shown. What the answers mean stays as it is. The form
 * and the bylaws are kept apart, each versioned and ledgered: saving changed bylaws publishes their next version, and
 * blank bylaws mean the Register page shows none and nobody agrees to any.
 */
const $q = useQuasar();

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
const previewAgreed = ref(false);

/** The newest published bylaws version, blank or not; null before any is published. */
const bylaws = ref<BylawsRecord | null>(null);
const versions = ref<BylawsVersionSummary[]>([]);
const bylawsLoaded = ref(false);
const bylawsDraft = ref({ title: 'USTP Bylaws', text: '' });
const bylawsField = ref<{ getNativeElement: () => HTMLTextAreaElement } | null>(null);
/** The bylaws in force now: none while none are published or the newest is blank. */
const inForce = computed(() => bylawsInForce(bylaws.value));
/** The text as it would be published: whitespace alone is blank. */
const bylawsText = computed(() => publishedBylawsText(bylawsDraft.value.text));
const bylawsTitle = computed(() => bylawsDraft.value.title.trim());
/** What saving would do to the bylaws: publish a new version, clear them, or nothing. */
const bylawsChange = computed<'publish' | 'clear' | null>(() => {
  if (!bylawsLoaded.value) return null;
  if (!bylawsText.value) return inForce.value ? 'clear' : null;
  return bylawsText.value !== inForce.value?.text || bylawsTitle.value !== inForce.value.title ? 'publish' : null;
});
const nextVersion = computed(() => nextBylawsVersion(bylaws.value?.version));
const bylawsProblem = computed(() => {
  if (!bylawsText.value) return null;
  if (!bylawsTitle.value) return 'give the bylaws a title';
  if (bylawsTitle.value.length > 200) return 'the bylaws title is over 200 characters';
  if (bylawsText.value.length > 500_000) return 'the bylaws are over 500,000 characters';
  return null;
});
const day = (iso: string) => new Date(iso).toLocaleDateString();
/** Unsaved changes: each part of the wording, and the bylaws as one. */
const unsaved = computed(() => changes.value.length + (bylawsChange.value ? 1 : 0));
/** Why Save is off: a problem with whichever of the wording and the bylaws has changes. */
const saveProblem = computed(() => (changes.value.length && problem.value) || (bylawsChange.value && bylawsProblem.value) || null);

const checker = useBylawsCheck();
const draftLines = computed(() => splitLines(bylawsDraft.value.text));

function startCheck(scope: BylawsCheckScope) {
  checker.start({ title: bylawsTitle.value || 'Bylaws', text: bylawsDraft.value.text, amends: inForce.value?.version ?? null, scope });
}

/** From a finding: select that line of the bylaws field and put focus there. */
async function goToLine(line: number) {
  const field = bylawsField.value?.getNativeElement();
  if (!field) return;
  const lines = bylawsDraft.value.text.split('\n');
  const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  await nextTick();
  focusElement(field);
  field.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  field.scrollTop = ((line - 1) / Math.max(lines.length, 1)) * field.scrollHeight - field.clientHeight / 2;
}

async function loadBylaws() {
  const [current, all] = await Promise.all([currentBylaws(), bylawsVersions()]);
  bylaws.value = current;
  versions.value = all;
  const shown = bylawsInForce(current);
  bylawsDraft.value = { title: shown?.title ?? current?.title ?? 'USTP Bylaws', text: shown?.text ?? '' };
  bylawsLoaded.value = true;
  checker.reset();
}

/** Bylaws versions are permanent, so say plainly what saving them does before it happens. */
function confirmBylaws(): Promise<boolean> {
  const version = nextVersion.value;
  const permanent = 'Published versions are permanent and recorded in the audit ledger.';
  const [title, message] =
    bylawsChange.value === 'clear'
      ? [
          'Clear the bylaws?',
          `This publishes version ${version} with no text. From then on the Register page shows no bylaws and applicants agree to none; members keep the version they agreed to. ${permanent}`,
        ]
      : [
          `Publish bylaws version ${version}?`,
          inForce.value
            ? `It replaces version ${inForce.value.version}. New applicants must agree to it; members keep the version they agreed to. ${permanent}`
            : `New applicants must agree to it. ${permanent}`,
        ];
  return new Promise((resolve) =>
    $q
      .dialog({ title, message, cancel: true, persistent: true })
      .onOk(() => resolve(true))
      .onCancel(() => resolve(false)),
  );
}

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
    const [form] = await Promise.all([registrationFormSettings(), loadBylaws()]);
    saved.value = form;
    draft.value = copy(form);
  });
}

/** Publishes changed bylaws first (once confirmed), then saves changed wording; each is its own record. */
async function save() {
  if (!saved.value) return;
  const publishing = bylawsChange.value;
  if (publishing && !(await confirmBylaws())) return;
  const form = resolved.value;
  const version = nextVersion.value;
  const done = [
    publishing === 'clear' && `Bylaws cleared (version ${version}): the Register page shows none from now on.`,
    publishing === 'publish' && `Bylaws version ${version} published: new applicants agree to it from now on.`,
    changes.value.length > 0 && 'Wording saved: the Register page shows it to everyone from now on.',
  ]
    .filter(Boolean)
    .join(' ');
  await attempt(async () => {
    if (publishing) {
      await publishBylaws({ version, title: bylawsTitle.value || bylaws.value!.title, text: bylawsText.value, amends: bylaws.value?.version ?? null });
      await loadBylaws();
    }
    if (changes.value.length) {
      saved.value = await saveRegistrationForm({ basedOn: saved.value!.version, ...form, ideals: [...form.ideals] });
      draft.value = copy(saved.value);
    }
  }, done);
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
      The Register page's heading and the intro above its steps, the bylaws applicants agree to, the application's two
      membership questions and their help, the Core Ideals shown before the second question, the link applicants get
      once they have applied, and which fields the application asks. Each application records the versions of the
      form and the bylaws it answered, and is refused if either changed while it was being filled in, so the
      applicant reads the new ones first.
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
        <h3 class="text-subtitle2">Bylaws applicants agree to</h3>
        <div class="text-caption text-grey-7">
          <template v-if="inForce">
            In force: version {{ inForce.version }}, published {{ day(inForce.publishedAt) }} · SHA-256
            <code>{{ inForce.contentHash.slice(0, 16) }}…</code> ·
            <router-link :to="`/bylaws/${encodeURIComponent(inForce.version)}`">public page</router-link>.
          </template>
          <template v-else-if="bylaws">None in force: version {{ bylaws.version }} cleared them.</template>
          <template v-else-if="bylawsLoaded">None published yet.</template>
          Saving changed bylaws publishes them as version {{ nextVersion }}. Versions are permanent and recorded in the
          audit ledger, and new applicants agree to the newest. Leave the text empty for no bylaws: the Register page
          then shows none and applicants agree to none.
        </div>
        <q-input
          v-model="bylawsDraft.title"
          outlined
          dense
          counter
          maxlength="200"
          label="Title"
          :error="!!bylawsText && !bylawsTitle"
          error-message="Needed while there are bylaws"
        />
        <q-input
          ref="bylawsField"
          v-model="bylawsDraft.text"
          type="textarea"
          outlined
          dense
          label="Bylaws (optional)"
          hint="Plain text, as applicants will read it. Empty means no bylaws."
          :input-style="{ height: '22rem' }"
          :error="bylawsText.length > 500_000"
          error-message="Over 500,000 characters"
        />
        <BylawsCheckSection
          v-if="bylawsText"
          :check="checker.state.check"
          :checked-lines="checker.state.checkedLines"
          :requesting="checker.state.requesting"
          :error="checker.state.error"
          :gave-up="checker.state.gaveUp"
          :draft-lines="draftLines"
          :changes-since="inForce && bylawsChange ? inForce.version : null"
          @check="startCheck"
          @go-to-line="goToLine"
        />
        <q-expansion-item v-if="versions.length" dense dense-toggle icon="history" :label="`All versions (${versions.length})`">
          <q-list separator>
            <q-item v-for="v in versions" :key="v.version" :to="`/bylaws/${encodeURIComponent(v.version)}`">
              <q-item-section>
                <q-item-label>Version {{ v.version }} · {{ v.title }}</q-item-label>
                <q-item-label caption>
                  Published {{ day(v.publishedAt) }}<span v-if="v.amends"> · replaces {{ v.amends }}</span
                  ><span v-if="v.changeNote"> · {{ v.changeNote }}</span>
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-expansion-item>
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
          <q-card v-if="bylawsText" flat bordered>
            <q-card-section>
              <h4 class="text-subtitle1 q-my-none">{{ bylawsTitle }}</h4>
            </q-card-section>
            <q-separator />
            <div class="q-pa-md bylaws-preview">{{ bylawsText }}</div>
            <q-separator />
            <q-card-section>
              <q-checkbox v-model="previewAgreed" label="I have read these bylaws and agree to abide by them." />
            </q-card-section>
          </q-card>
          <p v-else class="text-grey-7 q-mb-none">No bylaws: applicants see none and agree to none.</p>
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

      <q-card-section v-if="changes.length || bylawsChange">
        <h3 class="text-subtitle2">Not saved yet: {{ unsaved === 1 ? '1 change' : `${unsaved} changes` }}</h3>
        <ul class="q-mt-sm q-mb-none">
          <li v-if="bylawsChange === 'publish'">Bylaws: publishes version {{ nextVersion }}, which new applicants agree to.</li>
          <li v-else-if="bylawsChange === 'clear'">Bylaws: cleared (version {{ nextVersion }}, blank), so applicants agree to none.</li>
          <li v-for="c in changes" :key="c.part" class="form-change">{{ describeFormChange(c) }}</li>
        </ul>
      </q-card-section>
      <q-card-section v-if="saveProblem" class="text-negative" role="alert">Can't save yet: {{ saveProblem }}.</q-card-section>
      <q-card-section class="ustp-actions">
        <q-btn color="primary" label="Save changes" :disable="!unsaved || !!saveProblem" @click="save" />
        <q-btn flat color="primary" label="Discard changes" :disable="!unsaved" @click="load" />
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
.bylaws-preview {
  max-height: 16rem;
  overflow-y: auto;
  white-space: pre-wrap;
}
</style>
