<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import {
  checkNewMember,
  MAX_MEMBER_IMPORT_ROWS,
  MEMBER_IMPORT_TEMPLATE,
  readMemberImport,
  SET_PASSWORD_PATH,
  type MemberImportFile,
  type MemberImportPlan,
  type MemberImportResult,
  type NewMemberText,
} from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import { errorMessage } from '../api.js';
import { auth } from '../firebase.js';
import { apiFieldErrors, type FieldErrors } from '../forms.js';
import { sendWelcomeLink } from '../sign-in.js';
import DetailsFields from './DetailsFields.vue';
import { addMember, importMembers, previewMemberImport } from './api.js';
import type { DetailsForm } from './member-text.js';

/**
 * A Membership Admin adds members (design §5.13): one on a form, or many from a CSV file after a preview of what will
 * be added and what skipped, and why. They are Active at once, with no password: each sets their own when they first
 * come, after proving the address is theirs. The welcome email goes out after: by the site's mail, or, where the
 * deployment sends none, as Identity Platform's sign-in link, which this browser asks for.
 */
const emit = defineEmits<{ added: []; close: [] }>();

const setPasswordUrl = `${location.origin}${SET_PASSWORD_PATH}`;
const mode = ref<'one' | 'file'>('one');

// --- one member ----------------------------------------------------------------------------------------------------

const blankDetails = (): DetailsForm => ({ preferredName: '', state: null, country: null, city: '', postalCode: '', phone: '' });
const one = reactive({ email: '', legalName: '', details: blankDetails(), usVoteEligible: '', reason: '' });
const errors = ref<FieldErrors>({});
const busy = ref(false);
const VOTE_OPTIONS = [
  { label: 'Not asked', value: '' },
  { label: 'Yes: a United States Member', value: 'yes' },
  { label: 'No: an Allied Member', value: 'no' },
];

function oneText(): NewMemberText {
  const d = one.details;
  return {
    email: one.email,
    legalName: one.legalName,
    preferredName: d.preferredName,
    state: d.state ?? '',
    country: d.country ?? '',
    city: d.city,
    postalCode: d.postalCode,
    phone: d.phone,
    usVoteEligible: one.usVoteEligible,
  };
}

async function addOne() {
  const text = oneText();
  const checked = checkNewMember(text);
  const found: FieldErrors = {};
  if (!checked.ok) for (const p of checked.problems) found[p.field ?? '_'] ??= p.message;
  if (!one.reason.trim()) found.reason = 'a written reason is required';
  if (Object.keys(found).length) {
    errors.value = found;
    return focusFirstInvalid();
  }
  errors.value = {};
  busy.value = true;
  try {
    const result = await addMember({ ...text, reason: one.reason });
    Object.assign(one, { email: '', legalName: '', details: blankDetails(), usVoteEligible: '', reason: one.reason });
    await finished(result);
  } catch (e) {
    errors.value = { _: errorMessage(e), ...apiFieldErrors(e) };
    await focusFirstInvalid();
  } finally {
    busy.value = false;
  }
}

// --- a file --------------------------------------------------------------------------------------------------------

const file = ref<File | null>(null);
const read = ref<MemberImportFile | null>(null);
const plan = ref<MemberImportPlan | null>(null);
const fileError = ref<string | null>(null);
const reason = ref('');
const reasonError = ref<string | null>(null);
const skippedRows = computed(() => plan.value?.rows.filter((r) => !r.add) ?? []);
const addedRows = computed(() => plan.value?.rows.filter((r) => r.add) ?? []);

async function chooseFile(chosen: File | null) {
  read.value = null;
  plan.value = null;
  fileError.value = null;
  outcome.value = null;
  if (!chosen) return;
  busy.value = true;
  try {
    read.value = readMemberImport(await chosen.text());
    if (read.value.problem) return;
    plan.value = await previewMemberImport({ rows: [...read.value.rows] });
  } catch (e) {
    fileError.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

async function importFile() {
  if (!read.value || !plan.value) return;
  reasonError.value = reason.value.trim() ? null : 'a written reason is required';
  if (reasonError.value) return focusFirstInvalid();
  busy.value = true;
  try {
    const result = await importMembers({ rows: [...read.value.rows], reason: reason.value });
    file.value = null;
    read.value = null;
    plan.value = null;
    await finished(result);
  } catch (e) {
    fileError.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([MEMBER_IMPORT_TEMPLATE], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'members-to-add.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// --- after adding: the welcome -------------------------------------------------------------------------------------

interface Outcome {
  readonly result: MemberImportResult;
  /** Identity Platform's links this browser has sent so far, and those it could not. */
  sent: number;
  failed: { email: string; why: string }[];
  sending: boolean;
}
const outcome = ref<Outcome | null>(null);

async function finished(result: MemberImportResult) {
  outcome.value = { result, sent: 0, failed: [], sending: false };
  if (result.added.length) emit('added');
  if (result.welcome === 'identity_platform') await sendLinks(result.added.map((a) => a.email));
}

/** Asks Identity Platform for each address's sign-in link, one after another. */
async function sendLinks(emails: readonly string[]) {
  const o = outcome.value;
  if (!o || !emails.length) return;
  o.sending = true;
  o.failed = o.failed.filter((f) => !emails.includes(f.email));
  for (const email of emails) {
    try {
      await sendWelcomeLink(auth, email);
      o.sent++;
    } catch (e) {
      o.failed.push({ email, why: errorMessage(e) });
    }
  }
  o.sending = false;
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;
</script>

<template>
  <q-card flat bordered class="add-members">
    <q-card-section class="ustp-header">
      <div>
        <h3 class="text-subtitle1">Add members</h3>
        <div class="text-caption text-grey-7">
          They become Active members at once, recorded in the audit ledger with your reason. Nobody sets a password for
          them: each sets their own the first time they come, at <code>{{ setPasswordUrl }}</code>, after an emailed link
          proves the address is theirs.
        </div>
      </div>
      <q-btn flat round dense icon="close" aria-label="Close adding members" @click="emit('close')" />
    </q-card-section>

    <q-tabs v-model="mode" dense align="left" no-caps class="text-primary">
      <q-tab id="add-tab-one" name="one" label="One member" aria-controls="add-panel" />
      <q-tab id="add-tab-file" name="file" label="From a CSV file" aria-controls="add-panel" />
    </q-tabs>
    <q-separator />

    <q-card-section v-if="mode === 'one'" id="add-panel" role="tabpanel" aria-labelledby="add-tab-one">
      <q-form class="ustp-form" @submit.prevent="addOne">
        <div class="ustp-row">
          <q-input
            v-model="one.email"
            outlined
            dense
            hide-bottom-space
            type="email"
            label="Email address"
            autocomplete="off"
            :error="!!errors.email"
            :error-message="errors.email"
          />
          <q-input
            v-model="one.legalName"
            outlined
            dense
            hide-bottom-space
            label="Legal name"
            autocomplete="off"
            :error="!!errors.legalName"
            :error-message="errors.legalName"
          />
        </div>
        <DetailsFields v-model="one.details" :errors="errors" optional-contact />
        <q-select
          v-model="one.usVoteEligible"
          outlined
          dense
          hide-bottom-space
          emit-value
          map-options
          :options="VOTE_OPTIONS"
          label="Eligible to vote in any United States elections?"
          :error="!!errors.usVoteEligible"
          :error-message="errors.usVoteEligible"
        />
        <q-input
          v-model="one.reason"
          outlined
          dense
          autogrow
          hide-bottom-space
          type="textarea"
          label="Reason (recorded in the audit ledger)"
          :error="!!errors.reason"
          :error-message="errors.reason"
        />
        <q-banner v-if="errors._" class="bg-negative text-white" rounded>{{ errors._ }}</q-banner>
        <div class="ustp-actions">
          <q-btn type="submit" color="primary" no-caps label="Add member" :loading="busy" />
        </div>
      </q-form>
    </q-card-section>

    <q-card-section v-else id="add-panel" role="tabpanel" aria-labelledby="add-tab-file" class="ustp-stack">
      <p>
        The first row names the columns. Each member needs <code>email</code>, <code>legal_name</code> and
        <code>state</code>, or <code>country</code> for a member living outside the US; <code>preferred_name</code>,
        <code>city</code>, <code>zip</code>, <code>phone</code> and <code>us_vote_eligible</code> (yes or no) are optional.
        Other columns are ignored. At most {{ MAX_MEMBER_IMPORT_ROWS }} members a file.
      </p>
      <div class="ustp-toolbar">
        <q-file
          v-model="file"
          outlined
          dense
          accept=".csv,text/csv"
          label="Choose a CSV file"
          :loading="busy && !plan"
          @update:model-value="chooseFile"
        />
        <q-btn flat no-caps color="primary" icon="file_download" label="Download the template" @click="downloadTemplate" />
      </div>
      <q-banner v-if="read?.problem" class="bg-negative text-white" rounded>This file cannot be imported: {{ read.problem }}.</q-banner>
      <q-banner v-if="fileError" class="bg-negative text-white" rounded>{{ fileError }}</q-banner>

      <template v-if="plan && read">
        <div role="status">
          <strong>{{ plural(plan.adding, 'member') }} to add</strong>, {{ plural(plan.skipping, 'row') }} skipped.
          <span v-if="read.ignored.length" class="text-grey-7">Columns ignored: {{ read.ignored.join(', ') }}.</span>
        </div>

        <div v-if="skippedRows.length">
          <h4 class="text-subtitle2 q-mt-none q-mb-xs">Skipped</h4>
          <q-list bordered separator dense class="add-members__list">
            <q-item v-for="r in skippedRows" :key="r.line">
              <q-item-section>
                <q-item-label>Row {{ r.line }}: {{ r.email || 'no email' }}<template v-if="r.legalName"> ({{ r.legalName }})</template></q-item-label>
                <q-item-label caption>{{ r.reasons.join('; ') }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </div>

        <q-expansion-item v-if="addedRows.length" dense :label="`To add (${addedRows.length})`" header-class="text-primary">
          <q-list bordered separator dense class="add-members__list">
            <q-item v-for="r in addedRows" :key="r.line">
              <q-item-section>
                <q-item-label>Row {{ r.line }}: {{ r.email }} ({{ r.legalName }})</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-expansion-item>

        <template v-if="plan.adding">
          <q-input
            v-model="reason"
            outlined
            dense
            autogrow
            hide-bottom-space
            type="textarea"
            label="Reason for adding them (recorded in the audit ledger)"
            :error="!!reasonError"
            :error-message="reasonError ?? undefined"
          />
          <div class="ustp-actions">
            <q-btn color="primary" no-caps :label="`Add ${plural(plan.adding, 'member')}`" :loading="busy" @click="importFile" />
          </div>
        </template>
      </template>
    </q-card-section>

    <q-card-section v-if="outcome" class="ustp-stack" role="status">
      <q-separator />
      <div>
        <strong>Added {{ plural(outcome.result.added.length, 'member') }}.</strong>
        <template v-if="outcome.result.skipped.length">
          Skipped {{ plural(outcome.result.skipped.length, 'row') }}:
          <span v-for="(s, i) in outcome.result.skipped" :key="s.line">
            row {{ s.line }} ({{ s.email || 'no email' }}: {{ s.reasons.join('; ') }}){{ i < outcome.result.skipped.length - 1 ? ', ' : '.' }}
          </span>
        </template>
      </div>
      <template v-if="outcome.result.added.length">
        <div v-if="outcome.result.welcome === 'mail'">
          Each gets a welcome email from the site within a few minutes, leading to the page where they set their password.
        </div>
        <div v-else>
          This site sends no email of its own, so Identity Platform sends each a sign-in link that leads to setting their
          password:
          <template v-if="outcome.sending">sending {{ outcome.sent + outcome.failed.length + 1 }} of {{ outcome.result.added.length }}…</template>
          <template v-else>{{ plural(outcome.sent, 'link') }} sent.</template>
        </div>
        <div v-if="outcome.failed.length && !outcome.sending">
          <q-banner class="bg-warning text-black" rounded>
            Identity Platform did not send {{ plural(outcome.failed.length, 'link') }}:
            {{ outcome.failed.map((f) => `${f.email} (${f.why})`).join(', ') }}.
            <template #action>
              <q-btn flat no-caps label="Send again" @click="sendLinks(outcome.failed.map((f) => f.email))" />
            </template>
          </q-banner>
        </div>
        <div class="text-caption text-grey-7">
          You can also tell them yourself: they go to <code>{{ setPasswordUrl }}</code> and enter their email address.
        </div>
      </template>
    </q-card-section>
  </q-card>
</template>

<style scoped>
.add-members__list {
  max-height: 24rem;
  overflow-y: auto;
  overflow-wrap: anywhere;
}
</style>
