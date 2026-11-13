<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { MailRequestKind, MyEmailView } from 'ustp-domain';
import { attempt, dialog } from '../dialogs.js';
import { refreshMe } from '../session.js';
import { myEmail, requestMyEmail, setMyEmail } from './api.js';
import { addressText, MAIL_KIND_LABELS, MAIL_STATUS_LABELS, REQUEST_OUTCOMES } from './my-email-text.js';

/**
 * The member's own email (design §10.12), on the Account page: whether party email reaches their address, the emails
 * sent to them in the last 90 days and what their mail server did with each, a test email to themselves, after an
 * address bounced or they marked an email as spam, trying it again, and unsubscribing from all of it or turning it back
 * on. Polls while a request waits for the worker.
 */
const view = ref<MyEmailView | null>(null);
/** Requests from this card: a System Admin's test has its own card, in Admin › Email. */
const mine = computed(() => view.value?.requests.filter((r) => r.kind !== 'admin_test') ?? []);
const waiting = computed(() => mine.value.some((r) => r.status !== 'done'));
const last = computed(() => mine.value[0] ?? null);
const blocked = computed(() => view.value?.state === 'bounced' || view.value?.state === 'complained');
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  await attempt(async () => {
    const was = waiting.value;
    view.value = await myEmail();
    // A retry done: the site-wide banner goes with it.
    if (was && !waiting.value) await refreshMe();
  });
}

async function ask(kind: Exclude<MailRequestKind, 'admin_test'>) {
  await attempt(
    async () => {
      view.value = await requestMyEmail(kind);
    },
    kind === 'test' ? 'Test email queued: it goes within a minute.' : 'Your address is tried again within a minute, with a test email.',
  );
}

async function setEmail(on: boolean) {
  await attempt(
    async () => {
      view.value = await setMyEmail(on);
      await refreshMe();
    },
    on ? 'Email from the party is back on.' : 'You are unsubscribed.',
  );
}

function unsubscribe() {
  dialog({
    title: 'Unsubscribe from all email?',
    message:
      'The party will send you no more email: no notice that voting has opened, no reminder before it closes, and no confirmation that your vote was recorded. You would not be told by email if someone voted using your account. Emails you ask for yourself, such as a password reset, still come.',
    cancel: true,
    ok: { label: 'Unsubscribe', color: 'primary', noCaps: true },
  }).onOk(() => void setEmail(false));
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');
const requestText = computed(() => {
  const r = last.value;
  if (!r) return null;
  if (r.status !== 'done') return r.kind === 'retry' ? 'Trying your address again…' : 'Your test email is on its way…';
  if (r.outcome) return `Your ${r.kind === 'retry' ? 'request' : 'test email'} did not go: ${REQUEST_OUTCOMES[r.outcome]}.`;
  return `A test email went ${when(r.doneAt)}; it is listed below.`;
});

onMounted(async () => {
  await load();
  timer = setInterval(() => {
    if (waiting.value) void load();
  }, 10_000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <q-card flat bordered tag="section" aria-labelledby="my-email-heading">
    <q-card-section>
      <h2 id="my-email-heading" class="text-subtitle1">Email from the party</h2>
      <p v-if="view" class="q-mt-sm q-mb-sm">{{ addressText(view) }}</p>
      <p class="q-mb-none text-caption text-grey-7">
        We know only whether your mail server took each email, never whether you opened it: there is no tracking image,
        and links go straight to this site.
      </p>
    </q-card-section>
    <q-card-section v-if="view && (view.state === 'ok' || blocked) && !view.requestsEnabled" class="q-pt-none">
      <p class="q-my-none text-grey-7">
        {{
          blocked
            ? 'Trying your address again from here is switched off for now by the site’s administrators.'
            : 'Test emails are switched off for now by the site’s administrators.'
        }}
      </p>
    </q-card-section>
    <q-card-section v-else-if="view && (view.state === 'ok' || blocked)" class="ustp-actions q-pt-none">
      <q-btn v-if="blocked" color="primary" no-caps label="Try my address again" :disable="waiting" @click="ask('retry')" />
      <q-btn v-else outline color="primary" no-caps label="Send me a test email" :disable="waiting" @click="ask('test')" />
    </q-card-section>
    <q-card-section v-if="requestText" class="q-pt-none">
      <p class="q-my-none" role="status">{{ requestText }}</p>
    </q-card-section>
    <q-card-section v-if="view && !view.stoppedAt && view.unsubscribedAt" class="ustp-actions q-pt-none">
      <q-btn color="primary" no-caps label="Turn email back on" @click="setEmail(true)" />
    </q-card-section>
    <q-card-section v-else-if="view && !view.stoppedAt && view.state !== 'no_address'" class="ustp-actions q-pt-none">
      <q-btn flat no-caps color="primary" label="Unsubscribe from all email" @click="unsubscribe" />
    </q-card-section>
    <q-list v-if="view?.messages.length" separator bordered class="q-mx-md q-mb-md rounded-borders">
      <q-item v-for="m in view.messages" :key="m.messageId">
        <q-item-section>
          <q-item-label>
            {{ MAIL_KIND_LABELS[m.kind] }}<template v-if="m.electionTitle">: {{ m.electionTitle }}</template>
          </q-item-label>
          <q-item-label caption>Sent {{ when(m.sentAt) }}. {{ MAIL_STATUS_LABELS[m.status] }}.</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
    <q-card-section v-else-if="view" class="q-pt-none">
      <p class="q-my-none text-grey-7">No email has been sent to you in the last 90 days.</p>
    </q-card-section>
  </q-card>
</template>
