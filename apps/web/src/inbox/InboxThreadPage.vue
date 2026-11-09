<script setup lang="ts">
import { useQuasar } from 'quasar';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { MAX_INBOX_MESSAGE, type InboxTeamMember, type InboxThreadView } from 'ustp-domain';
import { announce, usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { attempt } from '../dialogs.js';
import { session } from '../session.js';
import { assignInbox, inboxTeam, inboxThread, replyInInbox, setInboxStatus } from './api.js';
import { refreshUnread } from './inbox-state.js';
import { INBOX_STATUS_COLOURS, INBOX_STATUS_LABELS, emailSkipBanner, inboxAuthor, inboxEmailText, readByMember } from './membership-inbox-text.js';

/**
 * One conversation in the membership inbox, as the Membership Admins see it (design §10.13): every message and note, who
 * wrote each for the team, whether each was emailed and read; and the team's answer, a note, who has it, and closing it.
 */
const $q = useQuasar();
const route = useRoute();
const threadId = computed(() => String(route.params.threadId));
const view = ref<InboxThreadView | null>(null);
const state = ref<'loading' | 'ready' | 'missing'>('loading');
const team = ref<InboxTeamMember[]>([]);
const draft = ref('');
const busy = ref(false);

usePageTitle(() => (view.value ? `${view.value.subject} (membership inbox)` : 'Membership inbox'));

const me = computed(() => session.me?.account?.accountId ?? null);
const assignOptions = computed(() => [
  { value: null, label: 'The whole team' },
  ...team.value.map((a) => ({ value: a.accountId, label: a.accountId === me.value ? `${a.name} (you)` : a.name })),
]);
const time = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function load() {
  try {
    view.value = await inboxThread(threadId.value);
    state.value = 'ready';
    void refreshUnread();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) state.value = 'missing';
    else $q.notify({ type: 'negative', message: errorMessage(e) });
  }
}

async function send(kind: 'send' | 'close' | 'note') {
  const body = draft.value.trim();
  if (!body || busy.value) return;
  busy.value = true;
  const done = await attempt(
    async () => {
      view.value = await replyInInbox(threadId.value, { body, note: kind === 'note' || undefined, close: kind === 'close' || undefined });
      draft.value = '';
    },
    kind === 'note' ? 'Note added' : kind === 'close' ? 'Sent, and the conversation is closed' : 'Sent',
  );
  busy.value = false;
  if (done) announce(kind === 'note' ? 'Note added.' : 'Message sent.');
}

async function setStatus(status: 'open' | 'closed') {
  await attempt(async () => {
    view.value = await setInboxStatus(threadId.value, status);
  }, status === 'closed' ? 'Closed' : 'Open again');
}

async function assign(accountId: string | null) {
  await attempt(async () => {
    view.value = await assignInbox(threadId.value, accountId);
  }, accountId ? 'Given to them' : 'Back with the whole team');
}

watch(threadId, () => void load());
onMounted(async () => {
  await load();
  team.value = await inboxTeam().catch(() => []);
});
</script>

<template>
  <PageShell>
    <p class="q-mb-sm"><router-link to="/admin?tab=inbox">Back to the membership inbox</router-link></p>
    <div v-if="state === 'loading'" class="text-grey-7">Loading…</div>
    <p v-else-if="state === 'missing'">There is no such conversation: it may have gone with the member’s account, or after two years.</p>
    <template v-else-if="view">
      <h1 class="text-h5 q-mt-none q-mb-xs">{{ view.subject }}</h1>
      <p class="q-mb-md">
        With <router-link :to="`/admin/members/${view.accountId}`">{{ view.memberName }}</router-link>
        <template v-if="view.memberStatus"> ({{ view.memberStatus }})</template>
        · started by {{ view.startedBy === 'team' ? 'the team' : 'the member' }} {{ time(view.createdAt) }}
        ·
        <q-badge :color="INBOX_STATUS_COLOURS[view.status]" :label="INBOX_STATUS_LABELS[view.status]" />
      </p>
      <div class="row q-gutter-md items-center q-mb-md">
        <q-select
          :model-value="view.assignedTo"
          outlined
          dense
          emit-value
          map-options
          :options="assignOptions"
          label="Who has it"
          class="inbox-assign"
          @update:model-value="assign"
        />
        <q-btn v-if="view.status !== 'closed'" flat no-caps color="primary" icon="done_all" label="Close" @click="setStatus('closed')" />
        <q-btn v-else flat no-caps color="primary" icon="undo" label="Open again" @click="setStatus('open')" />
      </div>
      <q-banner v-if="view.emailSkip" dense rounded class="bg-orange-2 text-black q-mb-md">{{ emailSkipBanner(view.memberName, view.emailSkip) }}</q-banner>

      <ol class="inbox-log" :aria-label="`Conversation with ${view.memberName}`">
        <li
          v-for="m in view.messages"
          :key="m.messageId"
          class="inbox-log__item"
          :class="{ 'inbox-log__item--team': m.from === 'team' && !m.note, 'inbox-log__item--note': m.note }"
        >
          <div class="text-caption text-weight-medium">{{ inboxAuthor(m) }} · {{ time(m.sentAt) }}</div>
          <div class="inbox-log__body">{{ m.body }}</div>
          <div v-if="m.from === 'team' && !m.note" class="text-caption text-grey-8">
            {{ inboxEmailText(m.email) }}<template v-if="readByMember(view.memberReadAt, m.sentAt)"> · Read on the site</template>
          </div>
        </li>
      </ol>

      <q-form class="ustp-form q-mt-md" @submit.prevent="send('send')">
        <q-input
          v-model="draft"
          outlined
          type="textarea"
          autogrow
          :label="`Answer ${view.memberName}, or write a note for the team`"
          :maxlength="MAX_INBOX_MESSAGE"
          counter
          hint="Plain text. The member sees the membership team, not your name; a note only the team sees."
        />
        <div class="ustp-actions">
          <q-btn type="submit" unelevated no-caps color="primary" icon="send" label="Send" :loading="busy" :disable="!draft.trim()" />
          <q-btn unelevated no-caps color="primary" outline icon="done_all" label="Send and close" :disable="!draft.trim() || busy" @click="send('close')" />
          <q-btn flat no-caps color="primary" icon="sticky_note_2" label="Add as a note" :disable="!draft.trim() || busy" @click="send('note')" />
        </div>
      </q-form>
    </template>
  </PageShell>
</template>

<style scoped>
.inbox-assign {
  min-width: 220px;
}
.inbox-log {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.inbox-log__item {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(127, 127, 127, 0.4);
  max-width: 90%;
}
.inbox-log__item--team {
  align-self: flex-end;
  border-color: var(--q-primary);
}
.inbox-log__item--note {
  align-self: stretch;
  max-width: none;
  border-style: dashed;
  background: rgba(255, 193, 7, 0.12);
}
.inbox-log__body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
