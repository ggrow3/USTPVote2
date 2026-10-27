<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  isVotingOpen,
  NOTICE_KINDS,
  noticeMessage,
  reminderTime,
  type ElectionDetail,
  type NoticeKind,
  type NoticesView,
  type NoticeSummary,
} from 'ustp-domain';
import { announce } from '../a11y.js';
import { attempt, dialog } from '../dialogs.js';
import { hasRole, session } from '../session.js';
import { electionNotices, resendNotice } from './api.js';
import { countRows, NOTICE_TITLES, noNoticeText, noticeStatus } from './notice-text.js';

/**
 * The election's emails (design §6.8) on the election editor: the voting-open notice and the closing-soon reminder,
 * whether each went out and how, as counts only; resending to those one failed for; and a preview of each.
 */
const props = defineProps<{ detail: ElectionDetail }>();

const view = ref<NoticesView | null>(null);
const now = ref(new Date());
const testingMode = computed(() => !!session.me?.testing.enabled);
const noticeOf = (kind: NoticeKind): NoticeSummary | null => view.value?.notices.find((n) => n.kind === kind) ?? null;
const canResend = (kind: NoticeKind) => {
  const notice = noticeOf(kind);
  return hasRole('election_admin') && isVotingOpen(props.detail.election, now.value) && notice?.status === 'done' && notice.counts.failed > 0;
};
const previews = computed(() =>
  NOTICE_KINDS.map((kind) => ({
    kind,
    text: noticeMessage(kind, {
      election: props.detail.election,
      origin: window.location.origin,
      name: 'Alex Example',
      contact: view.value?.contact ?? null,
      now: kind === 'closing_soon' ? reminderTime(props.detail.election) : new Date(),
    }).text,
  })),
);

async function load() {
  now.value = new Date();
  await attempt(async () => {
    view.value = await electionNotices(props.detail.election.electionId);
  });
}

// While the worker is sending, the counts change every minute.
const timer = setInterval(() => {
  if (isVotingOpen(props.detail.election, new Date()) && view.value?.notices.some((n) => n.status !== 'done')) void load();
}, 20_000);
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
</script>

<template>
  <q-card flat bordered tag="section" aria-labelledby="election-email-heading">
    <q-card-section>
      <h2 id="election-email-heading" class="text-subtitle1">Email to voters</h2>
      <div class="text-caption text-grey-7">
        Official election notices: they go out whatever members' newsletter and announcement choices. Counts only; who
        each went to is not shown.
      </div>
    </q-card-section>
    <template v-for="kind in NOTICE_KINDS" :key="kind">
      <q-separator />
      <q-card-section class="ustp-header">
        <div>
          <h3 :id="`notice-${kind}`" class="text-body1 text-weight-medium q-my-none">{{ NOTICE_TITLES[kind] }}</h3>
          <div class="text-caption text-grey-7">
            <template v-if="noticeOf(kind)">{{ noticeStatus(noticeOf(kind)!) }}</template>
            <template v-else-if="view">{{ noNoticeText(kind, detail, view, testingMode, now) }}</template>
          </div>
        </div>
        <q-badge v-if="noticeOf(kind)?.rehearsal" color="orange-2" text-color="black" label="Rehearsal: outbox only" />
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
      <q-card-section v-if="noticeOf(kind)" class="q-pt-none">
        <dl class="ustp-facts">
          <template v-for="row in countRows(kind, noticeOf(kind)!.counts)" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }} <span class="text-grey-7">({{ row.note }})</span></dd>
          </template>
        </dl>
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
