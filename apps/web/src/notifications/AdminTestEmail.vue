<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { AdminTestView } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { adminTest, requestAdminTest } from './api.js';
import { MAIL_STATUS_LABELS, REQUEST_OUTCOMES } from './my-email-text.js';

/**
 * A System Admin's test email (design §10.12), in Admin › Email, to themselves or another System Admin and nobody else. It
 * goes even while all email is off, so they can see that email works before switching it on for everyone. Polls while it
 * waits for the worker, and then for its delivery report.
 */
const view = ref<AdminTestView | null>(null);
const to = ref<string | null>(null);
const last = computed(() => view.value?.last ?? null);
const waiting = computed(() => !!last.value && last.value.status !== 'done');
/** Sent, with no word yet from the recipient's mail server. */
const reporting = computed(() => last.value?.status === 'done' && !last.value.outcome && (!last.value.delivery || last.value.delivery === 'sent' || last.value.delivery === 'delayed'));
const options = computed(() => (view.value?.systemAdmins ?? []).map((a) => ({ value: a.accountId, label: a.email && a.email !== a.name ? `${a.name} (${a.email})` : a.name })));

const statusText = computed(() => {
  const r = last.value;
  if (!r) return null;
  const whom = r.toName ? ` to ${r.toName}` : '';
  if (r.status !== 'done') return `Your test email${whom} is on its way…`;
  if (r.outcome) return `Your test email${whom} did not go: ${REQUEST_OUTCOMES[r.outcome]}.`;
  const when = r.doneAt ? ` ${new Date(r.doneAt).toLocaleString()}` : '';
  return `Your test email${whom} went${when}. ${MAIL_STATUS_LABELS[r.delivery ?? 'sent']}.`;
});

async function load() {
  await attempt(async () => {
    view.value = await adminTest();
    to.value ??= view.value.systemAdmins[0]?.accountId ?? null;
  });
}

async function send() {
  await attempt(async () => {
    view.value = await requestAdminTest(to.value);
  }, 'Test email queued: it goes within a minute.');
}

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(async () => {
  await load();
  timer = setInterval(() => {
    if (waiting.value || reporting.value) void load();
  }, 10_000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <q-card flat bordered tag="section" aria-labelledby="admin-test-email">
    <q-card-section>
      <h2 id="admin-test-email" class="text-subtitle1">Send a test email</h2>
      <p class="q-mt-sm q-mb-none">
        Check that the site can send email before switching it on for everyone. It goes only to the System Admin you choose,
        even while all email is off; members get nothing.
      </p>
    </q-card-section>
    <q-card-section v-if="view" class="ustp-form q-pt-none">
      <q-select v-model="to" outlined dense emit-value map-options :options="options" label="Send it to" />
      <div class="ustp-actions">
        <q-btn outline color="primary" no-caps icon="mail" label="Send test email" :disable="waiting || !to" @click="send" />
      </div>
    </q-card-section>
    <q-card-section v-if="statusText" class="q-pt-none">
      <p class="q-my-none" role="status">{{ statusText }}</p>
    </q-card-section>
  </q-card>
</template>
