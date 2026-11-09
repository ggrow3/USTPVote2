<script setup lang="ts">
import { useQuasar } from 'quasar';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { MAX_INBOX_MESSAGE, type MyTeamThreadView } from 'ustp-domain';
import { announce, usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import { attempt } from '../dialogs.js';
import { answerTeam, myTeamThread, readTeamThread } from './api.js';
import { refreshUnread } from './inbox-state.js';

/**
 * A member's conversation with the membership team (design §10.13): what they wrote and what the team answered, signed
 * by the team; the team's own notes are not here. Opening it marks the team's messages read, and the team sees that.
 */
const $q = useQuasar();
const route = useRoute();
const threadId = computed(() => String(route.params.threadId));
const view = ref<MyTeamThreadView | null>(null);
const state = ref<'loading' | 'ready' | 'missing'>('loading');
const draft = ref('');
const sending = ref(false);

usePageTitle(() => (view.value ? `${view.value.subject} (membership team)` : 'Membership team'));

const time = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function load() {
  try {
    view.value = await myTeamThread(threadId.value);
    state.value = 'ready';
    // Always, so the team sees when the member last opened it.
    await readTeamThread(threadId.value);
    void refreshUnread();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) state.value = 'missing';
    else $q.notify({ type: 'negative', message: errorMessage(e) });
  }
}

async function send() {
  const body = draft.value.trim();
  if (!body || sending.value) return;
  sending.value = true;
  const done = await attempt(async () => {
    view.value = await answerTeam(threadId.value, body);
    draft.value = '';
  }, 'Sent to the membership team');
  sending.value = false;
  if (done) announce('Message sent.');
}

watch(threadId, () => void load());
onMounted(load);
</script>

<template>
  <q-page padding>
    <div class="ustp-page">
      <p class="q-mb-sm"><router-link to="/messages">Back to Messages</router-link></p>
      <div v-if="state === 'loading'" class="text-grey-7">Loading…</div>
      <p v-else-if="state === 'missing'">There is no such conversation.</p>
      <template v-else-if="view">
        <h1 class="text-h5 q-mt-none q-mb-xs">{{ view.subject }}</h1>
        <p class="text-grey-7">With the party’s membership team. Every Membership Admin can read it.</p>
        <ol class="team-log" aria-label="Conversation with the membership team">
          <li v-for="m in view.messages" :key="m.messageId" class="team-log__item" :class="m.fromTeam ? 'team-log__item--team' : 'team-log__item--mine'">
            <div class="text-caption text-weight-medium">{{ m.fromTeam ? 'The membership team' : 'You' }} · {{ time(m.sentAt) }}</div>
            <div class="team-log__body">{{ m.body }}</div>
          </li>
        </ol>
        <q-banner v-if="view.closed" dense rounded class="bg-grey-3 text-black q-my-md">
          The membership team closed this conversation. Writing again opens it.
        </q-banner>
        <q-form class="ustp-form q-mt-md" @submit.prevent="send">
          <q-input v-model="draft" outlined type="textarea" autogrow label="Your answer" :maxlength="MAX_INBOX_MESSAGE" counter hint="Plain text" />
          <div class="ustp-actions">
            <q-btn type="submit" unelevated no-caps color="primary" icon="send" label="Send" :loading="sending" :disable="!draft.trim()" />
          </div>
        </q-form>
      </template>
    </div>
  </q-page>
</template>

<style scoped>
.team-log {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.team-log__item {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(127, 127, 127, 0.4);
  max-width: 90%;
}
.team-log__item--mine {
  align-self: flex-end;
  border-color: var(--q-primary);
}
.team-log__body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
