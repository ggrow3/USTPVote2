<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref, useId } from 'vue';
import type { AdminTestView, TestRecipient } from 'ustp-domain';
import { announce } from '../a11y.js';
import { roleLabel } from '../approval-text.js';
import { attempt } from '../dialogs.js';
import { STATUS_LABELS } from '../membership/members-list.js';
import { adminTest, requestAdminTest, searchTestRecipients } from './api.js';
import { MAIL_STATUS_LABELS, REQUEST_OUTCOMES } from './my-email-text.js';

/**
 * A System or Site Admin's test email (design §10.12), in Admin › Email, to themselves, another System or Site Admin or a member, and
 * nobody else. It goes even while all email is off, so they can see that email works before switching it on for
 * everyone. The System and Site Admins are listed; members are found by typing a name or an email address. Polls while it waits
 * for the worker, and then for its delivery report.
 */
const view = ref<AdminTestView | null>(null);
const to = ref<TestRecipient | null>(null);
const options = ref<TestRecipient[]>([]);
const hintId = useId();
const last = computed(() => view.value?.last ?? null);
const waiting = computed(() => !!last.value && last.value.status !== 'done');
/** Sent, with no word yet from the recipient's mail server. */
const reporting = computed(() => last.value?.status === 'done' && !last.value.outcome && (!last.value.delivery || last.value.delivery === 'sent' || last.value.delivery === 'delayed'));

const label = (r: TestRecipient) => (r.email && r.email !== r.name ? `${r.name} (${r.email})` : r.name);
const caption = (r: TestRecipient) =>
  [r.adminRole ? roleLabel(r.adminRole) : null, r.memberStatus ? `${STATUS_LABELS[r.memberStatus]} member` : null, r.place, r.email ? null : 'no email address']
    .filter(Boolean)
    .join(' · ');

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
    to.value ??= view.value.systemAdmins[0] ?? null;
  });
}

async function send() {
  if (!to.value) return;
  const recipient = to.value.accountId;
  await attempt(async () => {
    view.value = await requestAdminTest(recipient);
  }, 'Test email queued: it goes within a minute.');
}

const SEARCH_DELAY_MS = 300;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(searchTimer));

/** Quasar's filter: the System and Site Admins with nothing typed, else a search once typing pauses. */
function search(text: string, update: (fn: () => void) => void, abort: () => void) {
  clearTimeout(searchTimer);
  const q = text.trim();
  if (!q) {
    update(() => (options.value = [...(view.value?.systemAdmins ?? [])]));
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const found = await searchTestRecipients(q);
      update(() => (options.value = found));
      announce(found.length === 0 ? 'Nobody matches.' : `${found.length} ${found.length === 1 ? 'match' : 'matches'}. Use the down arrow to choose.`);
    } catch {
      abort();
      announce('The search failed. Try again.');
    }
  }, SEARCH_DELAY_MS);
}

function chose(value: TestRecipient | null) {
  to.value = value;
  if (value) announce(`${value.name} chosen.`);
}

/** Typing something else than the chosen name clears the choice, so the test never goes to someone left over. */
function typed(text: string) {
  if (to.value && text !== label(to.value)) to.value = null;
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
        Check that the site can send email before switching it on for everyone. It goes only to the person you choose, a
        System or Site Admin or a member, even while all email is off; nobody else gets anything. It is refused for anyone who
        unsubscribed, whose email an admin stopped, or whose address is not confirmed.
      </p>
    </q-card-section>
    <q-card-section v-if="view" class="ustp-form q-pt-none">
      <div>
        <q-select
          :model-value="to"
          outlined
          dense
          hide-bottom-space
          use-input
          hide-selected
          fill-input
          input-debounce="0"
          label="Send it to"
          :options="options"
          :option-label="label"
          option-value="accountId"
          :aria-describedby="hintId"
          @filter="search"
          @input-value="typed"
          @update:model-value="chose"
        >
          <template #option="scope">
            <q-item v-bind="scope.itemProps">
              <q-item-section>
                <q-item-label>{{ label(scope.opt) }}</q-item-label>
                <q-item-label caption>{{ caption(scope.opt) }}</q-item-label>
              </q-item-section>
            </q-item>
          </template>
          <template #no-option="scope">
            <q-item>
              <q-item-section class="text-grey-7">
                {{ scope.inputValue.trim() ? 'No System or Site Admin or member matches.' : 'Type a member’s name or email address.' }}
              </q-item-section>
            </q-item>
          </template>
        </q-select>
        <div :id="hintId" class="ustp-message text-grey-7">
          {{ to ? `Goes to ${label(to)}${to.systemAdmin ? '' : ', a member'}.` : 'Type a member’s name or email address and choose them, or pick a System or Site Admin from the list.' }}
        </div>
      </div>
      <div class="ustp-actions">
        <q-btn outline color="primary" no-caps icon="mail" label="Send test email" :disable="waiting || !to" @click="send" />
      </div>
    </q-card-section>
    <q-card-section v-if="statusText" class="q-pt-none">
      <p class="q-my-none" role="status">{{ statusText }}</p>
    </q-card-section>
  </q-card>
</template>
