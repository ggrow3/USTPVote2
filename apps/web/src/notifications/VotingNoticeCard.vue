<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  DEFAULT_NOTICE_SETTINGS,
  isRehearsalRoll,
  isVotingOpen,
  NOTICE_KINDS,
  noticeMessage,
  noticeSteps,
  reminderTime,
  type ElectionDetail,
  type NoticeKind,
  type NoticeStep,
  type NoticeSummary,
  type NoticeTestSummary,
} from 'ustp-domain';
import { announce } from '../a11y.js';
import { attempt, dialog } from '../dialogs.js';
import { hasRole, session } from '../session.js';
import { resendNotice, sendTestNotice } from './api.js';
import { loadNotices, noticesOf } from './notice-store.js';
import {
  countRows,
  ALL_OFF,
  EMAIL_DESCRIPTION,
  heldText,
  NOTICE_TITLES,
  noNoticeText,
  noticeStatus,
  receiptText,
  testBlocked,
  testReceiptText,
  testStatusText,
  verificationText,
} from './notice-text.js';
import { setupLine } from './mail-health-text.js';

/**
 * The election's emails (design §6.8) on the election editor: the voting-open notice and the closing-soon reminder,
 * whether each went out and how, as counts only; how many the send receipts say went; resending to those one failed
 * for; a test of each to the Election Admin's own address; and a preview of each.
 */
const props = defineProps<{ detail: ElectionDetail }>();

const view = computed(() => noticesOf(props.detail.election.electionId));
const now = ref(new Date());
const testingMode = computed(() => !!session.me?.testing.enabled);
const noticeOf = (kind: NoticeKind): NoticeSummary | null => view.value?.notices.find((n) => n.kind === kind) ?? null;
const canResend = (kind: NoticeKind) => {
  const notice = noticeOf(kind);
  return hasRole('election_admin') && isVotingOpen(props.detail.election, now.value) && notice?.status === 'done' && notice.counts.failed > 0;
};
const steps = computed(() =>
  noticeSteps({
    election: props.detail.election,
    rehearsal: isRehearsalRoll(props.detail.roll?.criteria),
    testingMode: testingMode.value,
    view: view.value,
    now: now.value,
  }),
);
const stepOf = (kind: NoticeKind): NoticeStep => steps.value.find((s) => s.kind === kind)!;
const rollSent = (kind: NoticeKind) => view.value?.receipts.roll.find((t) => t.kind === kind);
const checksOf = (kind: NoticeKind) => view.value?.verifications.find((t) => t.kind === kind);
const testsSent = (kind: NoticeKind) => view.value?.receipts.tests.find((t) => t.kind === kind);
// The caller's newest test of each email; the view lists them newest first.
const lastTest = (kind: NoticeKind): NoticeTestSummary | null => view.value?.tests.find((t) => t.kind === kind) ?? null;
const canTest = computed(() => hasRole('election_admin'));
const testUnavailable = computed(() => (canTest.value ? testBlocked(view.value, now.value) : null));
const testWaiting = computed(() => !!view.value?.tests.some((t) => t.status !== 'done'));
// With the System Admins' wording, lead time and contact, as the worker would send them.
const previews = computed(() => {
  const settings = view.value?.settings ?? DEFAULT_NOTICE_SETTINGS;
  return NOTICE_KINDS.map((kind) => ({
    kind,
    text: noticeMessage(kind, {
      election: props.detail.election,
      origin: window.location.origin,
      name: 'Alex Example',
      contact: view.value?.contact ?? null,
      now: kind === 'closing_soon' ? reminderTime(props.detail.election, settings.reminderHours) : new Date(),
      text: settings.kinds[kind],
    }).text,
  }));
});

async function load() {
  now.value = new Date();
  await attempt(() => loadNotices(props.detail.election.electionId));
}

// While an email is due or being sent, or a test is on its way, the counts change every minute; the workflow shows
// them too.
const timer = setInterval(() => {
  now.value = new Date();
  if (testWaiting.value || steps.value.some((s) => s.status === 'current')) void load();
}, 20_000);

// Say when a test the admin is waiting for has gone, or why not.
watch(
  () => NOTICE_KINDS.map((kind) => lastTest(kind)),
  (tests, before) => {
    tests.forEach((test, i) => {
      const was = before?.[i];
      if (test && was?.testId === test.testId && was.status !== 'done' && test.status === 'done') announce(testStatusText(test));
    });
  },
);
onMounted(load);
onBeforeUnmount(() => clearInterval(timer));

function resend(kind: NoticeKind) {
  const failed = noticeOf(kind)?.counts.failed ?? 0;
  dialog({
    title: `Resend “${NOTICE_TITLES[kind]}”?`,
    message: `The worker sends it again, within a minute, to the ${failed === 1 ? 'person' : `${failed} people`} it failed for. Nobody else gets a second copy.`,
    cancel: true,
    focus: 'cancel',
    ok: { label: 'Resend', noCaps: true },
  }).onOk(async () => {
    if (await attempt(() => resendNotice(props.detail.election.electionId, kind), 'Resend started')) {
      await load();
      const notice = noticeOf(kind);
      announce(notice ? noticeStatus(notice) : 'Resend started');
    }
  });
}

function sendTest(kind: NoticeKind) {
  dialog({
    title: `Send a test of “${NOTICE_TITLES[kind]}”?`,
    message:
      'The worker sends it within a minute to your own email address only, with [TEST] at the start of the subject and ' +
      'a note at the top. Nobody on the roll gets anything, and it is not counted with the emails sent to them.',
    cancel: true,
    ok: { label: 'Send test email', noCaps: true },
  }).onOk(async () => {
    if (await attempt(() => sendTestNotice(props.detail.election.electionId, kind))) {
      await load();
      const test = lastTest(kind);
      announce(test ? testStatusText(test) : 'Test email queued');
    }
  });
}
</script>

<template>
  <q-card flat bordered tag="section" aria-labelledby="election-email-heading">
    <q-card-section>
      <h2 id="election-email-heading" class="text-subtitle1">Email to voters</h2>
      <div class="text-caption text-grey-7">{{ EMAIL_DESCRIPTION }}</div>
      <div v-if="testUnavailable && !testWaiting" class="text-caption text-grey-7">No test emails: {{ testUnavailable }}</div>
      <q-banner v-if="view && !view.settings.allEmails" dense rounded class="bg-orange-2 text-black q-mt-sm">{{ ALL_OFF }}</q-banner>
      <q-banner v-if="setupLine(view?.setup ?? null)" dense rounded class="bg-orange-1 text-black q-mt-sm">{{ setupLine(view?.setup ?? null) }}</q-banner>
    </q-card-section>
    <template v-for="kind in NOTICE_KINDS" :key="kind">
      <q-separator />
      <q-card-section class="ustp-header">
        <div>
          <h3 :id="`notice-${kind}`" class="text-body1 text-weight-medium q-my-none">{{ NOTICE_TITLES[kind] }}</h3>
          <div class="text-caption text-grey-7">
            <template v-if="noticeOf(kind)">{{ noticeStatus(noticeOf(kind)!) }}</template>
            <template v-else-if="view">{{ noNoticeText(stepOf(kind), detail, view) }}</template>
          </div>
        </div>
        <q-badge v-if="noticeOf(kind)?.rehearsal" color="orange-2" text-color="black" label="Rehearsal: outbox only" />
        <q-badge v-if="noticeOf(kind)?.held" color="negative" label="Held" />
        <q-btn
          v-if="canTest && !testUnavailable"
          flat
          no-caps
          color="primary"
          label="Send test email"
          :aria-label="`Send a test of ${NOTICE_TITLES[kind]} to your own email address`"
          @click="sendTest(kind)"
        />
        <q-btn
          v-if="canResend(kind)"
          outline
          no-caps
          color="primary"
          :label="`Resend to the ${noticeOf(kind)!.counts.failed} it failed for`"
          :aria-label="`Resend ${NOTICE_TITLES[kind]} to the ${noticeOf(kind)!.counts.failed} it failed for`"
          @click="resend(kind)"
        />
      </q-card-section>
      <q-card-section v-if="noticeOf(kind)?.held" class="q-pt-none">
        <q-banner dense rounded class="bg-orange-1 text-black" role="status">{{ heldText(noticeOf(kind)!.held!) }}</q-banner>
      </q-card-section>
      <q-card-section v-if="noticeOf(kind)" class="q-pt-none">
        <dl class="ustp-facts">
          <template v-for="row in countRows(kind, noticeOf(kind)!.counts)" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }} <span class="text-grey-7">({{ row.note }})</span></dd>
          </template>
        </dl>
      </q-card-section>
      <q-card-section v-if="view" class="q-pt-none">
        <p class="q-my-none"><strong>Send receipts:</strong> {{ receiptText(rollSent(kind)) }}</p>
        <q-banner v-if="checksOf(kind)?.shortSends" dense rounded class="bg-orange-1 text-black q-my-xs" role="status">
          <strong>Delivery check:</strong> {{ verificationText(checksOf(kind)) }}
        </q-banner>
        <p v-else-if="verificationText(checksOf(kind))" class="q-my-none"><strong>Delivery check:</strong> {{ verificationText(checksOf(kind)) }}</p>
        <p v-if="testReceiptText(testsSent(kind))" class="q-my-none text-caption text-grey-7">{{ testReceiptText(testsSent(kind)) }}</p>
        <p v-if="lastTest(kind)" class="q-my-none text-caption">{{ testStatusText(lastTest(kind)!) }}</p>
      </q-card-section>
    </template>
    <q-separator />
    <q-expansion-item v-for="p in previews" :key="p.kind" dense :label="`Preview: ${NOTICE_TITLES[p.kind]} (with a sample name)`">
      <q-card-section>
        <pre class="ustp-notice-preview">{{ p.text }}</pre>
      </q-card-section>
    </q-expansion-item>
  </q-card>
</template>

<style scoped>
.ustp-notice-preview {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
  font-size: 0.875rem;
}
</style>
