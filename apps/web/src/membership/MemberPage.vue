<script setup lang="ts">
import { useQuasar } from 'quasar';
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { adminStatusChanges, memberCorrectionSchemaFor, type MailAddressState, type MemberDetail, type MemberStatus } from 'ustp-domain';
import { focusFirstInvalid, usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { askReason, attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import MemberCorrespondence from '../inbox/MemberCorrespondence.vue';
import MemberOffices from '../offices/MemberOffices.vue';
import { session } from '../session.js';
import ApplicationAnswers from './ApplicationAnswers.vue';
import DetailsFields from './DetailsFields.vue';
import { usePlaceRules } from './place-rules.js';
import { auth } from '../firebase.js';
import { sendWelcomeLink } from '../sign-in.js';
import { memberMailFlags, restoreMemberEmail, stopMemberEmail } from '../notifications/api.js';
import { FLAG_LABELS } from '../notifications/my-email-text.js';
import { changeMemberStatus, correctMemberDetails, member as fetchMember, welcomeAgain, welcomeLinkSent } from './api.js';
import { answerText, classOf, consentText, detailsForm, memberClassText, placeFacts, placeInput, type DetailsForm } from './member-text.js';

/** One member as a Membership Admin sees them (design §5.2): details, every application's answers, status history. */
const $q = useQuasar();
const route = useRoute();
const accountId = computed(() => String(route.params.accountId));
const detail = ref<MemberDetail | null>(null);
const loadState = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const m = computed(() => detail.value?.member ?? null);
usePageTitle(() => m.value?.legalName ?? 'Member');
/** Nobody changes their own status or corrects their own record (design §5.2). */
const isSelf = computed(() => accountId.value === session.me?.account?.accountId);
const statusChanges = computed(() => (m.value && !isSelf.value ? adminStatusChanges(m.value.status) : []));

const date = (iso: string) => new Date(iso).toLocaleDateString();
const dateTime = (iso: string) => new Date(iso).toLocaleString();
const NOT_GIVEN = 'Not given';

/** Why this member cannot be emailed (design §10.12); null when they can, or before it is known. */
const mailProblem = ref<string | null>(null);
const mailState = ref<MailAddressState | null>(null);

async function load() {
  const id = accountId.value;
  try {
    const [found, flags] = await Promise.all([fetchMember(id), memberMailFlags().catch(() => [])]);
    if (id !== accountId.value) return;
    const flag = flags.find((f) => f.accountId === id);
    mailProblem.value = flag ? FLAG_LABELS[flag.state] : null;
    mailState.value = flag?.state ?? null;
    detail.value = found;
    loadState.value = 'ready';
  } catch (e) {
    if (id !== accountId.value) return;
    loadState.value = e instanceof ApiError && e.status === 404 ? 'missing' : 'failed';
    if (loadState.value === 'failed') $q.notify({ type: 'negative', message: errorMessage(e) });
  }
}

/** No more email to this member, or email again (design §10.12): ledgered, with a reason, and shown to the member. */
async function stopEmail() {
  const reason = await askReason(
    'Stop email to this member',
    `${m.value?.legalName} will get no email from the party, election notices included, until an admin restores it. They will see this on their Account page, and it is recorded in the audit ledger.`,
  );
  if (reason === null) return;
  if (await attempt(() => stopMemberEmail({ accountId: accountId.value, reason }), 'Email stopped')) await load();
}

async function restoreEmail() {
  const reason = await askReason('Restore email to this member', `${m.value?.legalName} will get email from the party again, unless they unsubscribed themselves.`);
  if (reason === null) return;
  if (await attempt(() => restoreMemberEmail(accountId.value, { reason }), 'Email restored')) await load();
}

async function changeStatus(to: MemberStatus) {
  const member = m.value;
  if (!member) return;
  const reason = await askReason(`Change status to ${to}`, `${member.legalName}: ${member.status} → ${to}.`);
  if (reason === null) return;
  if (await attempt(() => changeMemberStatus(accountId.value, { to, reason }), 'Status changed')) await load();
}

// A member a Membership Admin added (design §5.13): whether they have signed in, and their welcome email.
const WELCOME_OUTCOMES: Readonly<Record<string, string>> = {
  refused: 'the mail service refused the address',
  unavailable: 'the mail service was unavailable',
  interrupted: 'interrupted; it may or may not have gone',
  error: 'an error',
  no_address: 'the account has no address',
  undeliverable: 'the address bounced before, or was marked as spam',
  signed_in: 'they had signed in already',
  unsubscribed: 'they have unsubscribed from email',
  email_stopped: 'an admin has stopped email to them',
};
/** What the mail service reported of a welcome email it took. */
const WELCOME_DELIVERY: Readonly<Record<string, string>> = {
  delayed: ', delayed so far',
  delivered: ', delivered',
  bounced: ', and it bounced: check the address',
  complained: ', delivered, and marked as spam',
  rejected: ', but the mail service did not send it after all',
};
const welcomeText = computed(() => {
  const w = detail.value?.added?.welcome;
  if (!w) return "Identity Platform's sign-in link, sent from the adding admin's browser";
  if (w.status === 'pending') return 'Waiting to be sent';
  if (w.status === 'sending') return 'Being sent';
  if (w.outcome) return `Not sent: ${WELCOME_OUTCOMES[w.outcome] ?? w.outcome}`;
  const delivery = w.delivery ? (WELCOME_DELIVERY[w.delivery] ?? '') : '';
  if (w.via === 'identity_platform') return `Identity Platform's sign-in link, sent ${dateTime(w.doneAt ?? w.requestedAt)} from an admin's browser${delivery}`;
  return `Sent ${dateTime(w.doneAt ?? w.requestedAt)}${delivery}`;
});
const welcoming = ref(false);

async function sendWelcome() {
  welcoming.value = true;
  try {
    const again = await welcomeAgain(accountId.value);
    let logged = true;
    if (again.welcome === 'identity_platform') {
      await sendWelcomeLink(auth, again.email);
      // The link went: only the email log's record of it can still fail.
      logged = await welcomeLinkSent(accountId.value).then(
        () => true,
        () => false,
      );
    }
    $q.notify({
      type: logged ? 'positive' : 'warning',
      message: logged ? `Welcome email sent again to ${again.email}` : `Welcome email sent again to ${again.email}, but not recorded in the email log`,
    });
    await load();
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) });
  } finally {
    welcoming.value = false;
  }
}

// Correcting details: names, state and contact, never the member's email opt-ins.
const correcting = ref(false);
const rules = usePlaceRules();
const saving = ref(false);
const errors = ref<FieldErrors>({});
const correction = reactive({ legalName: '', details: null as DetailsForm | null, reason: '' });
let original = '';

function startCorrection() {
  if (!m.value) return;
  Object.assign(correction, { legalName: m.value.legalName, details: detailsForm(m.value), reason: '' });
  original = JSON.stringify([correction.legalName, correction.details]);
  errors.value = {};
  correcting.value = true;
}

async function saveCorrection() {
  if (JSON.stringify([correction.legalName, correction.details]) === original) {
    errors.value = { _: 'Nothing has changed.' };
    return;
  }
  if (!correction.details) return;
  const checked = validate(memberCorrectionSchemaFor(rules.value), {
    legalName: correction.legalName,
    preferredName: correction.details.preferredName,
    ...placeInput(correction.details),
    phone: correction.details.phone,
    reason: correction.reason,
  });
  if (!checked.ok) {
    errors.value = checked.errors;
    return focusFirstInvalid();
  }
  saving.value = true;
  try {
    await correctMemberDetails(accountId.value, checked.data);
    correcting.value = false;
    $q.notify({ type: 'positive', message: 'Details corrected' });
    await load();
  } catch (e) {
    errors.value = { _: errorMessage(e), ...apiFieldErrors(e) };
    await focusFirstInvalid();
  } finally {
    saving.value = false;
  }
}

// Another member's page reuses this one, so follow the route rather than loading once.
watch(
  accountId,
  () => {
    if (typeof route.params.accountId !== 'string') return;
    detail.value = null;
    loadState.value = 'loading';
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <q-btn flat dense no-caps icon="arrow_back" label="Members" :to="{ path: '/admin', query: { tab: 'members' } }" class="ustp-back" />
      <div>
        <h1 class="text-h5">{{ m?.legalName ?? 'Member' }}</h1>
        <div v-if="m" class="text-caption text-grey-7">
          <span v-if="m.preferredName">Goes by {{ m.preferredName }} · </span>Account <code>{{ m.accountId }}</code>
        </div>
      </div>

      <div v-if="loadState === 'loading'" class="text-grey-7">Loading…</div>
      <div v-else-if="loadState === 'missing'" class="text-grey-7">No member has this account ID.</div>
      <div v-else-if="loadState === 'failed'" class="text-grey-7">Could not load this member.</div>
      <template v-else-if="detail && m">
        <q-banner v-if="isSelf" class="bg-grey-3 text-black" rounded>
          This is your own membership. Another Membership Admin changes your status or corrects your details; you keep
          your own details up to date on your <router-link to="/account">Account page</router-link>.
        </q-banner>

        <q-card flat bordered>
          <q-card-section class="ustp-header">
            <div><h2 class="text-subtitle1">Membership</h2></div>
            <q-btn-dropdown v-if="statusChanges.length" outline no-caps color="primary" label="Change status">
              <q-list dense>
                <q-item v-for="to in statusChanges" :key="to" v-close-popup clickable @click="changeStatus(to)">
                  <q-item-section>{{ to }}</q-item-section>
                </q-item>
              </q-list>
            </q-btn-dropdown>
          </q-card-section>
          <q-card-section>
            <dl class="ustp-facts">
              <dt>Status</dt>
              <dd><q-badge :label="m.status" /></dd>
              <dt>Email</dt>
              <dd>
                <q-chip v-if="mailProblem" dense color="orange-2" text-color="black" icon="unsubscribe" :label="`Can't be emailed: ${mailProblem}`" />
                <template v-else>Can be emailed</template>
              </dd>
              <dt>Class</dt>
              <dd :class="{ 'text-grey-7': classOf(m) === null }">{{ memberClassText(m.usVoteEligible) }}</dd>
              <dt>Agrees with the Core Ideals</dt>
              <dd :class="{ 'text-grey-7': typeof m.agreesWithCoreIdeals !== 'boolean' }">{{ answerText(m.agreesWithCoreIdeals) }}</dd>
              <dt>Member since</dt>
              <dd>{{ m.memberSince ? date(m.memberSince) : 'Not yet' }}</dd>
              <dt>Status changed</dt>
              <dd>{{ dateTime(m.statusChangedAt) }}</dd>
              <dt>{{ detail.added ? 'Bylaws in force when added' : 'Bylaws agreed to' }}</dt>
              <dd>Version {{ m.bylawsVersion }}</dd>
              <template v-if="detail.added">
                <dt>Added</dt>
                <dd>By a Membership Admin, {{ dateTime(detail.added.at) }}</dd>
                <dt>Signed in</dt>
                <dd :class="{ 'text-grey-7': !detail.added.signedInAt }">
                  {{ detail.added.signedInAt ? `First on ${dateTime(detail.added.signedInAt)}` : 'Not yet: they have not set a password' }}
                </dd>
                <template v-if="!detail.added.signedInAt">
                  <dt>Welcome email</dt>
                  <dd>{{ welcomeText }}</dd>
                </template>
              </template>
            </dl>
          </q-card-section>
          <q-card-actions v-if="detail.added && !detail.added.signedInAt" class="q-px-md q-pb-md">
            <q-btn outline no-caps color="primary" icon="mail" label="Send the welcome email again" :loading="welcoming" @click="sendWelcome" />
          </q-card-actions>
          <q-card-actions v-if="!isSelf" class="q-px-md q-pb-md">
            <q-btn v-if="mailState === 'email_stopped'" outline no-caps color="primary" icon="mail" label="Restore email to this member" @click="restoreEmail" />
            <q-btn v-else flat no-caps color="primary" icon="unsubscribe" label="Stop email to this member" @click="stopEmail" />
          </q-card-actions>
        </q-card>

        <MemberOffices :member="m" :is-self="isSelf" />

        <MemberCorrespondence :account-id="accountId" :name="m.preferredName || m.legalName" :is-self="isSelf" />

        <q-card flat bordered>
          <q-card-section class="ustp-header">
            <div>
              <h2 class="text-subtitle1">Details</h2>
              <div class="text-caption text-grey-7">As membership uses them now. Members keep their own up to date.</div>
            </div>
            <q-btn v-if="!isSelf" outline no-caps color="primary" label="Correct details" @click="startCorrection" />
          </q-card-section>
          <q-card-section>
            <dl class="ustp-facts">
              <dt>Legal name</dt>
              <dd>{{ m.legalName }}</dd>
              <dt>Preferred name</dt>
              <dd :class="{ 'text-grey-7': !m.preferredName }">{{ m.preferredName ?? NOT_GIVEN }}</dd>
              <template v-for="fact in placeFacts(m)" :key="fact.label">
                <dt>{{ fact.label }}</dt>
                <dd :class="{ 'text-grey-7': !fact.value }">{{ fact.value ?? NOT_GIVEN }}</dd>
              </template>
              <dt>Phone</dt>
              <dd :class="{ 'text-grey-7': !m.contact?.phone }">{{ m.contact?.phone ?? NOT_GIVEN }}</dd>
              <dt>USTP newsletter</dt>
              <dd>{{ consentText(m.communications?.newsletter) }}</dd>
              <dt>Party announcements and calls to vote</dt>
              <dd>{{ consentText(m.communications?.announcements) }}</dd>
              <dt>Daily quote and joke</dt>
              <dd>{{ detail?.preferences?.dailyQuote ? 'On' : 'Off' }}</dd>
            </dl>
          </q-card-section>
        </q-card>

        <q-card flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Applications</h2>
            <div class="text-caption text-grey-7">Newest first, with every answer as the applicant gave it.</div>
          </q-card-section>
          <q-list v-if="detail.applications.length" separator>
            <q-expansion-item
              v-for="(a, i) in detail.applications"
              :key="a.applicationId"
              :default-opened="i === 0"
              :label="`Application of ${dateTime(a.submittedAt)}`"
              :caption="a.status"
            >
              <q-card-section>
                <ApplicationAnswers :application="a" />
              </q-card-section>
            </q-expansion-item>
          </q-list>
          <q-card-section v-else class="text-grey-7">No applications: this member was admitted without one.</q-card-section>
        </q-card>

        <q-card flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Status history</h2>
            <div class="text-caption text-grey-7">Newest first; each change is in the audit ledger.</div>
          </q-card-section>
          <q-list separator>
            <q-item v-for="h in detail.history" :key="h.ledgerSeq">
              <q-item-section>
                <q-item-label>{{ h.from ?? 'none' }} → {{ h.to }}</q-item-label>
                <q-item-label caption>
                  {{ dateTime(h.at) }} · ledger #{{ h.ledgerSeq }}<span v-if="h.reason"> · {{ h.reason }}</span>
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>
      </template>
    </div>

    <q-dialog v-model="correcting" persistent aria-labelledby="correct-title">
      <q-card class="ustp-dialog ustp-dialog--wide">
        <q-card-section>
          <h2 id="correct-title" class="text-h6">Correct details of {{ m?.legalName }}</h2>
          <div class="text-caption text-grey-7">
            Which details changed, and your reason, are recorded in the audit ledger. Email choices are the member's own.
          </div>
        </q-card-section>
        <q-card-section v-if="correction.details">
          <q-form class="ustp-form" @submit.prevent="saveCorrection">
            <q-input
              v-model="correction.legalName"
              outlined
              dense
              hide-bottom-space
              label="Legal name"
              autocomplete="off"
              :error="!!errors.legalName"
              :error-message="errors.legalName"
            />
            <DetailsFields v-model="correction.details" :errors="errors" :rules="rules" />
            <q-input
              v-model="correction.reason"
              outlined
              dense
              autogrow
              hide-bottom-space
              type="textarea"
              label="Reason"
              :error="!!errors.reason"
              :error-message="errors.reason"
            />
            <q-banner v-if="errors._" class="bg-negative text-white" rounded>{{ errors._ }}</q-banner>
          </q-form>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat no-caps label="Cancel" />
          <q-btn color="primary" no-caps label="Save" :loading="saving" @click="saveCorrection" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </PageShell>
</template>
