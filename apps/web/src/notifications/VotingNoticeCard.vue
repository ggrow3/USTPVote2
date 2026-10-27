<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { isVotingOpen, votingOpenMessage, type ElectionDetail, type NoticesView, type NoticeSummary } from 'ustp-domain';
import { announce } from '../a11y.js';
import { attempt, dialog } from '../dialogs.js';
import { hasRole, session } from '../session.js';
import { electionNotices, resendNotice } from './api.js';
import { countRows, noNoticeText, noticeStatus } from './notice-text.js';

/**
 * The voting-open email (design §6.7) on the election editor: whether it went out and how it went, as counts only,
 * resending to those it failed for, and a preview of the message.
 */
const props = defineProps<{ detail: ElectionDetail }>();

const view = ref<NoticesView | null>(null);
const now = ref(new Date());
const notice = computed<NoticeSummary | null>(() => view.value?.notices.find((n) => n.kind === 'voting_open') ?? null);
const testingMode = computed(() => !!session.me?.testing.enabled);
const canResend = computed(
  () =>
    hasRole('election_admin') &&
    isVotingOpen(props.detail.election, now.value) &&
    notice.value?.status === 'done' &&
    notice.value.counts.failed > 0,
);
const preview = computed(
  () => votingOpenMessage({ election: props.detail.election, origin: window.location.origin, name: 'Alex Example' }).text,
);

async function load() {
  now.value = new Date();
  await attempt(async () => {
    view.value = await electionNotices(props.detail.election.electionId);
  });
}

// While the worker is sending, the counts change every minute.
const timer = setInterval(() => {
  if (notice.value?.status !== 'done' && isVotingOpen(props.detail.election, new Date())) void load();
}, 20_000);
onMounted(load);
onBeforeUnmount(() => clearInterval(timer));

function resend() {
  const failed = notice.value?.counts.failed ?? 0;
  dialog({
    title: 'Resend the notice?',
    message: `The worker sends the voting notice again, within a minute, to the ${failed === 1 ? 'person' : `${failed} people`} it failed for. Nobody else gets a second copy.`,
    cancel: true,
    focus: 'cancel',
    ok: { label: 'Resend', noCaps: true },
  }).onOk(async () => {
    if (await attempt(() => resendNotice(props.detail.election.electionId, 'voting_open'), 'Resend started')) {
      await load();
      announce(notice.value ? noticeStatus(notice.value) : 'Resend started');
    }
  });
}
</script>

<template>
  <q-card flat bordered tag="section" aria-labelledby="voting-notice-heading">
    <q-card-section class="ustp-header">
      <div>
        <h2 id="voting-notice-heading" class="text-subtitle1">Email to voters</h2>
        <div class="text-caption text-grey-7">
          <template v-if="notice">{{ noticeStatus(notice) }}</template>
          <template v-else-if="view">{{ noNoticeText(detail, view, testingMode, now) }}</template>
        </div>
      </div>
      <q-badge v-if="notice?.rehearsal" color="orange-2" text-color="black" label="Rehearsal: outbox only" />
      <q-btn
        v-if="canResend"
        outline
        no-caps
        color="primary"
        :label="`Resend to the ${notice!.counts.failed} it failed for`"
        @click="resend"
      />
    </q-card-section>
    <q-card-section v-if="notice">
      <dl class="ustp-facts">
        <template v-for="row in countRows(notice.counts)" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }} <span class="text-grey-7">({{ row.note }})</span></dd>
        </template>
      </dl>
    </q-card-section>
    <q-expansion-item dense label="Preview the email (with a sample name)">
      <q-card-section>
        <pre class="ustp-notice-preview">{{ preview }}</pre>
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
