<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MAX_MESSAGE_LENGTH, type MessagePeopleMatch, type MessagePerson, type MessageView, type ThreadSummary } from 'ustp-domain';
import { announce, focusElement } from '../a11y.js';
import { askReason, attempt, dialog } from '../dialogs.js';
import { blockMember, messagePeople, messagePerson, readThread, reportMessage, sendMessage, thread as loadThread, threads as loadThreads, unblockMember } from './api.js';
import { refreshUnread } from './inbox-state.js';
import { whenText } from './inbox-text.js';

/**
 * Messages between members (design §10.13): any Active member can write to any other, one to one. The list of
 * conversations, and the one open (`/messages/{threadId}`, or `/messages?to={accountId}` to start one). Only the two
 * members read a conversation. A member can block another, which stops them writing without telling them, and report a
 * message they got to the Membership Admins, who see that one message only.
 */
const route = useRoute();
const router = useRouter();

const list = ref<ThreadSummary[] | null>(null);
const openId = computed(() => (typeof route.params.threadId === 'string' ? route.params.threadId : null));
const toId = computed(() => (typeof route.query.to === 'string' ? route.query.to : null));

/** The person the open conversation is with (or the one about to be written to), and its messages. */
const person = ref<MessagePerson | null>(null);
const messages = ref<MessageView[]>([]);
const older = ref<string | null>(null);
const blocking = ref(false);
const draft = ref('');
const sending = ref(false);
const heading = ref<HTMLElement | null>(null);

const canWrite = computed(() => !!person.value?.active && !blocking.value);

async function loadList() {
  await attempt(async () => {
    list.value = await loadThreads();
  });
}

async function loadOpen() {
  messages.value = [];
  older.value = null;
  person.value = null;
  blocking.value = false;
  if (openId.value) {
    await attempt(async () => {
      const view = await loadThread(openId.value!);
      person.value = view.with;
      messages.value = [...view.messages];
      older.value = view.older;
      blocking.value = view.blocking;
      await readThread(openId.value!);
      void refreshUnread();
      const row = list.value?.find((t) => t.threadId === openId.value);
      if (row) list.value = list.value!.map((t) => (t === row ? { ...t, unread: 0 } : t));
    });
  } else if (toId.value) {
    await attempt(async () => {
      const target = await messagePerson(toId.value!);
      // Writing to someone there is a conversation with already opens it.
      if (target.exists) return router.replace(`/messages/${target.threadId}`);
      person.value = target.person;
      blocking.value = target.blocking;
    });
  }
  await nextTick();
  if (person.value) focusElement(heading.value);
}

async function loadOlder() {
  if (!openId.value || !older.value) return;
  await attempt(async () => {
    const view = await loadThread(openId.value!, older.value!);
    messages.value = [...view.messages, ...messages.value];
    older.value = view.older;
  });
}

async function send() {
  const to = person.value?.accountId;
  const body = draft.value.trim();
  if (!to || !body || sending.value) return;
  sending.value = true;
  const ok = await attempt(async () => {
    const sent = await sendMessage(to, body);
    draft.value = '';
    if (sent.threadId !== openId.value) {
      await router.replace(`/messages/${sent.threadId}`);
    } else {
      messages.value = [...messages.value, sent.message];
    }
    announce('Message sent.');
    void loadList();
  });
  sending.value = false;
  if (!ok) announce('The message was not sent.');
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void send();
  }
}

function toggleBlock() {
  const p = person.value;
  if (!p) return;
  if (blocking.value) {
    void attempt(async () => {
      await unblockMember(p.accountId);
      blocking.value = false;
      void loadList();
    }, `${p.name} can write to you again`);
    return;
  }
  dialog({
    title: `Block ${p.name}?`,
    message: `${p.name} will not be able to write to you, and is not told why. You will not be able to write to them either until you unblock them. The conversation stays here.`,
    cancel: true,
    ok: { label: 'Block', color: 'negative', noCaps: true },
  }).onOk(() =>
    attempt(async () => {
      await blockMember(p.accountId);
      blocking.value = true;
      void loadList();
    }, `${p.name} is blocked`),
  );
}

async function report(m: MessageView) {
  const reason = await askReason(
    'Report this message',
    'The Membership Admins will see this one message, who wrote it, and what you say here; nothing else of the conversation. Say what is wrong with it.',
  );
  if (reason === null) return;
  await attempt(async () => {
    const updated = await reportMessage(m.messageId, reason);
    messages.value = messages.value.map((x) => (x.messageId === m.messageId ? updated : x));
  }, 'Reported to the Membership Admins');
}

// --- starting a conversation ----------------------------------------------------------------------------------------

const choosing = ref<MessagePeopleMatch | null>(null);
const found = ref<MessagePeopleMatch[]>([]);
let searchTimer: ReturnType<typeof setTimeout> | undefined;

function search(text: string, update: (fn: () => void) => void, abort: () => void) {
  clearTimeout(searchTimer);
  const name = text.trim();
  if (!name) {
    update(() => (found.value = []));
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const people = await messagePeople(name);
      update(() => (found.value = people));
      announce(people.length ? `${people.length} found. Use the down arrow to choose.` : 'No Active member matches.');
    } catch {
      abort();
      announce('The search failed. Try again.');
    }
  }, 300);
}

watch(choosing, (chosen) => {
  if (!chosen) return;
  choosing.value = null;
  void router.push({ path: '/messages', query: { to: chosen.accountId } });
});

// --- keeping it current ---------------------------------------------------------------------------------------------

let poll: ReturnType<typeof setInterval> | undefined;
async function refresh() {
  if (document.visibilityState !== 'visible') return;
  await loadList();
  if (openId.value) {
    try {
      const view = await loadThread(openId.value);
      const known = new Set(messages.value.map((m) => m.messageId));
      const fresh = view.messages.filter((m) => !known.has(m.messageId));
      if (fresh.length) {
        messages.value = [...messages.value, ...fresh];
        if (fresh.some((m) => !m.fromMe)) {
          announce(`${fresh.filter((m) => !m.fromMe).length} new message${fresh.length === 1 ? '' : 's'} from ${view.with.name}.`);
          await readThread(openId.value);
          void refreshUnread();
        }
      }
    } catch {
      // The next look tries again.
    }
  }
}

watch([openId, toId], () => void loadOpen());
onMounted(async () => {
  await loadList();
  await loadOpen();
  poll = setInterval(() => void refresh(), 20_000);
});
onBeforeUnmount(() => {
  clearInterval(poll);
  clearTimeout(searchTimer);
});

const time = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<template>
  <q-page padding>
    <div class="ustp-page">
      <h1 class="text-h5 q-mt-none">Messages</h1>
      <p>
        Write to any Active member of the party. Only the two of you read a conversation. Messages are kept for a year. If
        a message is abusive, report it, and the Membership Admins will see that message alone.
      </p>
      <div class="messages" :class="{ 'messages--open': !!person }">
        <section class="messages__list" aria-labelledby="conversations">
          <h2 id="conversations" class="text-subtitle1 q-mt-none">Conversations</h2>
          <q-select
            v-model="choosing"
            outlined
            dense
            use-input
            hide-selected
            fill-input
            input-debounce="0"
            label="Write to a member"
            hint="Type part of their name"
            :options="found"
            option-value="accountId"
            option-label="name"
            class="q-mb-md"
            @filter="search"
          >
            <template #no-option="scope">
              <q-item>
                <q-item-section class="text-grey-7">{{ scope.inputValue.trim() ? 'No Active member matches.' : 'Type part of a member’s name.' }}</q-item-section>
              </q-item>
            </template>
          </q-select>
          <q-list v-if="list?.length" bordered separator class="rounded-borders">
            <q-item v-for="t in list" :key="t.threadId" clickable :to="`/messages/${t.threadId}`" :active="t.threadId === openId" :class="{ 'text-weight-bold': t.unread > 0 }">
              <q-item-section>
                <q-item-label>{{ t.with.name }}<template v-if="t.blocking"> (blocked)</template></q-item-label>
                <q-item-label caption lines="1">{{ t.lastFromMe ? 'You: ' : '' }}{{ t.lastText }}</q-item-label>
              </q-item-section>
              <q-item-section side top>
                <q-item-label caption>{{ whenText(t.lastMessageAt) }}</q-item-label>
                <q-badge v-if="t.unread" color="primary" :label="`${t.unread} new`" />
              </q-item-section>
            </q-item>
          </q-list>
          <p v-else-if="list" class="text-grey-7">No conversations yet.</p>
        </section>

        <section v-if="person" class="messages__open" aria-labelledby="open-heading">
          <div class="row items-center no-wrap q-mb-sm">
            <q-btn flat round dense icon="arrow_back" aria-label="Back to conversations" class="lt-md q-mr-sm" to="/messages" />
            <h2 id="open-heading" ref="heading" tabindex="-1" class="text-subtitle1 q-my-none col">{{ person.name }}</h2>
            <q-btn flat no-caps dense :color="blocking ? 'primary' : 'negative'" :icon="blocking ? 'lock_open' : 'block'" :label="blocking ? 'Unblock' : 'Block'" @click="toggleBlock" />
          </div>
          <div v-if="older" class="q-mb-sm">
            <q-btn flat no-caps dense color="primary" icon="expand_less" label="Earlier messages" @click="loadOlder" />
          </div>
          <ol class="messages__log" :aria-label="`Messages with ${person.name}`">
            <li v-for="m in messages" :key="m.messageId" class="messages__item" :class="m.fromMe ? 'messages__item--mine' : 'messages__item--theirs'">
              <div class="messages__bubble">
                <span class="sr-only">{{ m.fromMe ? 'You' : person.name }}: </span>
                <span class="messages__body">{{ m.body }}</span>
              </div>
              <div class="text-caption text-grey-7">
                {{ time(m.sentAt) }}
                <template v-if="!m.fromMe">
                  ·
                  <span v-if="m.reported">Reported</span>
                  <button v-else type="button" class="messages__report" @click="report(m)">Report</button>
                </template>
              </div>
            </li>
          </ol>
          <p v-if="!messages.length" class="text-grey-7">No messages yet. Write the first one below.</p>
          <q-banner v-if="blocking" dense rounded class="bg-grey-3 text-black q-mb-sm">You have blocked {{ person.name }}. Unblock them to write to them.</q-banner>
          <q-banner v-else-if="!person.active" dense rounded class="bg-grey-3 text-black q-mb-sm">{{ person.name }} is not an Active member now, so they cannot get messages.</q-banner>
          <q-form v-if="canWrite" class="ustp-form" @submit.prevent="send">
            <q-input
              v-model="draft"
              outlined
              type="textarea"
              autogrow
              :label="`Message to ${person.name}`"
              :maxlength="MAX_MESSAGE_LENGTH"
              counter
              hint="Plain text. Ctrl+Enter sends."
              @keydown="onKey"
            />
            <div class="ustp-actions">
              <q-btn type="submit" unelevated no-caps color="primary" icon="send" label="Send" :loading="sending" :disable="!draft.trim()" />
            </div>
          </q-form>
        </section>
        <section v-else class="messages__open gt-sm text-grey-7">
          <p>Choose a conversation, or write to a member.</p>
        </section>
      </div>
    </div>
  </q-page>
</template>

<style scoped>
.messages {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) 2fr;
  gap: 24px;
  align-items: start;
}
.messages__log {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.messages__item {
  max-width: 85%;
}
.messages__item--mine {
  align-self: flex-end;
  text-align: right;
}
.messages__bubble {
  display: inline-block;
  padding: 8px 12px;
  border-radius: 12px;
  text-align: left;
  border: 1px solid rgba(127, 127, 127, 0.4);
}
.messages__item--mine .messages__bubble {
  background: var(--q-primary);
  color: #fff;
  border-color: transparent;
}
.messages__body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.messages__report {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--ustp-link);
  text-decoration: underline;
  cursor: pointer;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
/* On a phone, the list or the open conversation, not both side by side (WCAG 1.4.10). */
@media (max-width: 1023px) {
  .messages {
    grid-template-columns: 1fr;
  }
  .messages--open .messages__list {
    display: none;
  }
}
</style>
