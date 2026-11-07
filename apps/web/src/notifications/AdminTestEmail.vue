<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { MyEmailView } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { myEmail, requestAdminTest } from './api.js';
import { MAIL_STATUS_LABELS, REQUEST_OUTCOMES } from './my-email-text.js';

/**
 * A System Admin's test email to their own address (design §10.12), in Admin › Email. It goes even while all email is off,
 * so they can see that email works before switching it on for everyone; nobody else gets it. Polls while it waits for the
 * worker, and then for its delivery report.
 */
const view = ref<MyEmailView | null>(null);
const last = computed(() => view.value?.requests.find((r) => r.kind === 'admin_test') ?? null);
const waiting = computed(() => !!last.value && last.value.status !== 'done');
const message = computed(() => view.value?.messages.find((m) => m.messageId === last.value?.messageId) ?? null);
/** Sent, with no word yet from the recipient's mail server. */
const reporting = computed(() => !!last.value?.messageId && (!message.value || message.value.status === 'sent' || message.value.status === 'delayed'));
const stoppedForMe = computed(() => view.value?.state === 'unsubscribed' || view.value?.state === 'email_stopped');
const noAddress = computed(() => view.value?.state === 'no_address' || view.value?.state === 'unverified');

const statusText = computed(() => {
  const r = last.value;
  if (!r) return null;
  if (r.status !== 'done') return 'Your test email is on its way…';
  if (r.outcome) return `Your test email did not go: ${REQUEST_OUTCOMES[r.outcome]}.`;
  const when = r.doneAt ? new Date(r.doneAt).toLocaleString() : '';
  return `Your test email went ${when}. ${message.value ? MAIL_STATUS_LABELS[message.value.status] : MAIL_STATUS_LABELS.sent}.`;
});

async function load() {
  await attempt(async () => {
    view.value = await myEmail();
  });
}

async function send() {
  await attempt(async () => {
    view.value = await requestAdminTest();
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
      <h2 id="admin-test-email" class="text-subtitle1">Send yourself a test email</h2>
      <p class="q-mt-sm q-mb-none">
        Check that the site can send email before switching it on for everyone. It goes only to your own address<template v-if="view?.address">, {{ view.address }}</template>,
        even while all email is off.
      </p>
    </q-card-section>
    <q-card-section v-if="view" class="ustp-actions q-pt-none">
      <q-btn outline color="primary" no-caps icon="mail" label="Send me a test email" :disable="waiting || stoppedForMe || noAddress" @click="send" />
    </q-card-section>
    <q-card-section v-if="stoppedForMe" class="q-pt-none">
      <p class="q-my-none text-grey-7">You get no email from the site just now: your Account page says why.</p>
    </q-card-section>
    <q-card-section v-else-if="noAddress" class="q-pt-none">
      <p class="q-my-none text-grey-7">Your account needs a confirmed email address first: your Account page says more.</p>
    </q-card-section>
    <q-card-section v-if="statusText" class="q-pt-none">
      <p class="q-my-none" role="status">{{ statusText }}</p>
    </q-card-section>
  </q-card>
</template>
