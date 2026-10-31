<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Notify, type QInput } from 'quasar';
import {
  parseRoomInput,
  ROOM_LIMITS,
  type RoomActionView,
  type RoomMessageView,
  type RoomReaction,
  type RoomSource,
  type RoomStatus,
  type RoomVoiceView,
  type VoteValue,
} from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { attempt, dialog } from '../dialogs.js';
import { session } from '../session.js';
import ActionDialog from './ActionDialog.vue';
import { acceptTerms, ask, deleteMessage, history, joke, leaveRoom, postMessage, reactTo, roomStatus, switchAssistant, updates, voteOn } from './api.js';
import DecisionDialog from './DecisionDialog.vue';
import EmojiPicker from './EmojiPicker.vue';
import { JokeVoice } from './joke-voice.js';
import MemoryPanel from './MemoryPanel.vue';
import RoomMessage from './RoomMessage.vue';
import { assistantLine, commandHints, dayLabel, insertText, microphoneProblem, peopleLine, startsDay } from './room-text.js';
import { VoiceCall } from './voice.js';
import VoiceBar from './VoiceBar.vue';

/**
 * The members' room (design §5.10): at the door, the terms an Active member accepts before anything of the room is
 * shown; inside, the chat with its assistant, its votes and emoji reactions, kept current by asking the api for
 * updates (it holds each request until something changes), the composer with its slash commands and emoji picker, the
 * room's memory, and its call, which members join to talk while they chat.
 */
usePageTitle('Members’ room');

const status = ref<RoomStatus | null>(null);
const error = ref<string | null>(null);
const messages = ref<RoomMessageView[]>([]);
const older = ref<string | null>(null);
const seq = ref(0);
const memorySeq = ref(0);
const text = ref('');
const sending = ref(false);
const entering = ref(false);
const loadingOlder = ref(false);
const list = ref<HTMLElement | null>(null);
const composer = ref<QInput | null>(null);

const decisionOpen = ref(false);
const decisionFrom = ref<RoomMessageView | null>(null);
const decisionText = ref('');
const actionOpen = ref(false);
const actionTask = ref('');
const actionItem = ref<RoomActionView | null>(null);
const memoryOpen = ref(false);
const memoryQuery = ref('');
const memoryHighlight = ref<string | null>(null);

const room = computed(() => status.value?.room ?? null);
const moderator = computed(() => room.value?.moderator ?? false);
const assistant = computed(() => (room.value ? assistantLine(room.value.assistant) : null));
const pending = computed(() => new Set(room.value?.assistant.pending ?? []));
const hints = computed(() => commandHints(text.value, moderator.value));
const myId = computed(() => session.me?.account?.accountId ?? '');
const people = computed(() => room.value?.people ?? []);

/** Who is in the call, and the feed number of that list. */
const voice = ref<RoomVoiceView[]>([]);
const voiceSeq = ref(-1);
const call = new VoiceCall({ dropped: (reason) => Notify.create({ type: 'info', message: reason }) });
const jokes = new JokeVoice();
/** Closing the tab leaves the call at once, rather than when the page goes quiet. */
const unloading = () => call.leave(true);
window.addEventListener('pagehide', unloading);

let polling = 0;
/** Stops waiting for the tab to be shown again, when the page closes. */
let stopWaiting: (() => void) | null = null;
onBeforeUnmount(() => {
  polling++;
  stopWaiting?.();
  window.removeEventListener('pagehide', unloading);
  leaveCall();
});

async function load() {
  error.value = null;
  try {
    status.value = await roomStatus();
    if (status.value.room) await enter();
  } catch (e) {
    error.value = errorMessage(e);
  }
}
void load();

/** Loads the latest page and keeps it current until the page closes or the member is no longer in the room. */
async function enter() {
  const page = await history();
  messages.value = [...page.messages];
  older.value = page.before;
  seq.value = page.seq;
  memorySeq.value = status.value?.room?.memorySeq ?? 0;
  if (status.value?.room) setVoice(status.value.room.voice, status.value.room.voiceSeq);
  await scrollToEnd();
  void poll(++polling);
}

/**
 * Resolves once the tab is visible. A hidden tab stops asking: each held request keeps an api instance busy, which
 * Cloud Run bills by the second, and the page catches up the moment it is looked at again.
 */
function visible(): Promise<void> {
  if (document.visibilityState === 'visible') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      document.removeEventListener('visibilitychange', shown);
      stopWaiting = null;
      resolve();
    };
    const shown = () => {
      if (document.visibilityState === 'visible') done();
    };
    stopWaiting = done;
    document.addEventListener('visibilitychange', shown);
  });
}

async function poll(run: number) {
  let failures = 0;
  while (run === polling && status.value?.room) {
    // In the call the page keeps asking while hidden: others joining need its answer to reach it.
    if (!call.joined) await visible();
    if (run !== polling) return;
    try {
      const asked = call.sessionId;
      const u = await updates(seq.value, asked);
      if (run !== polling) return;
      failures = 0;
      if (u.reset) {
        await enter();
        return;
      }
      const atEnd = nearEnd();
      const added = merge(u.messages);
      seq.value = u.seq;
      memorySeq.value = u.memorySeq;
      if (status.value.room) status.value = { ...status.value, room: { ...status.value.room, assistant: u.assistant } };
      if (u.voice) setVoice(u.voice, u.voiceSeq);
      await call.receive(u.signals);
      // Joined while this request was out: handshakes sent to the new page since it joined come now.
      if (call.sessionId && call.sessionId !== asked) await call.receive((await updates(call.joinedSeq, call.sessionId, false)).signals);
      announce(added);
      // Someone entered or left: who is in the room (the header, action items' owners) comes with the status.
      if (u.peopleSeq !== status.value.room?.peopleSeq) status.value = await roomStatus();
      if (atEnd && u.messages.length) await scrollToEnd();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        // Left in another tab, the membership ended, or the terms changed: back to the door, out of the call.
        leaveCall();
        try {
          status.value = await roomStatus();
        } catch (again) {
          error.value = errorMessage(again);
        }
        return;
      }
      failures++;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** failures)));
    }
  }
}

/** Adds new messages and replaces changed ones, in time order (message IDs are time-ordered); returns the new ones. */
function merge(changed: readonly RoomMessageView[]): RoomMessageView[] {
  const byId = new Map(messages.value.map((m) => [m.messageId, m]));
  const added = changed.filter((m) => !byId.has(m.messageId));
  for (const m of changed) byId.set(m.messageId, m);
  messages.value = [...byId.values()].sort((a, b) => (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0));
  return added;
}

/** A joke told just now is read out to a member in the call, with the assistant shown in it while it speaks. */
function announce(added: readonly RoomMessageView[]) {
  const told = added.filter((m) => m.joke && !m.deleted).at(-1);
  if (told && call.joined) jokes.tell(told.body);
}

/** Who is in the call, unless the list is older than the one shown. */
function setVoice(list: readonly RoomVoiceView[], at: number) {
  if (at < voiceSeq.value) return;
  voiceSeq.value = at;
  voice.value = [...list];
  call.apply(list, at);
}

async function joinCall() {
  await attempt(async () => {
    try {
      const joined = await call.join();
      setVoice(joined.voice, joined.voiceSeq);
    } catch (e) {
      const problem = microphoneProblem(e);
      throw problem ? new Error(problem) : e;
    }
  });
}

function leaveCall() {
  jokes.stop();
  call.leave();
}

async function tellJoke() {
  sending.value = true;
  await attempt(async () => {
    announce(merge([await joke()]));
    await scrollToEnd();
  });
  sending.value = false;
}

async function loadOlder() {
  loadingOlder.value = true;
  await attempt(async () => {
    const page = await history(older.value);
    const before = list.value?.scrollHeight ?? 0;
    merge(page.messages);
    older.value = page.before;
    await nextTick();
    if (list.value) list.value.scrollTop += list.value.scrollHeight - before;
  });
  loadingOlder.value = false;
}

function nearEnd(): boolean {
  const el = list.value;
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

async function scrollToEnd() {
  await nextTick();
  if (list.value) list.value.scrollTop = list.value.scrollHeight;
}

async function accept() {
  if (!status.value) return;
  entering.value = true;
  const ok = await attempt(async () => {
    status.value = await acceptTerms(status.value!.terms.version);
  });
  entering.value = false;
  if (ok && status.value?.room) await attempt(enter);
}

function leave() {
  dialog({
    title: 'Leave the room?',
    message:
      'Your consent is withdrawn at once and the room closes to you. What you posted stays until it expires (messages after 90 days); delete anything you want gone first. You can come back by accepting the terms again.',
    cancel: { flat: true, noCaps: true, label: 'Stay' },
    ok: { unelevated: true, noCaps: true, color: 'negative', label: 'Leave the room' },
  }).onOk(() => {
    void attempt(async () => {
      const left = await leaveRoom();
      polling++;
      leaveCall();
      status.value = left;
      messages.value = [];
    }, 'You have left the room');
  });
}

/** Sends what the composer holds: a message, or a command (design §5.10). */
async function send() {
  const parsed = parseRoomInput(text.value);
  if (parsed.kind === 'message' && !parsed.text) return;
  if (parsed.kind === 'unknown') {
    Notify.create({ type: 'warning', message: `There is no /${parsed.command} command. Type / to see them; start with // to send a message beginning with /.` });
    return;
  }
  if (parsed.kind === 'message') {
    await submit(() => postMessage(parsed.text));
    return;
  }
  const { command, args } = parsed;
  switch (command) {
    case 'ask':
      if (!args) Notify.create({ type: 'warning', message: 'Write your question after /ask.' });
      else await submit(() => ask(args));
      return;
    case 'decide':
      openDecision(null, args);
      break;
    case 'todo':
      openAction(null, args);
      break;
    case 'memory':
    case 'forget':
      openMemory(args, null);
      break;
    case 'joke':
      await tellJoke();
      break;
    case 'assistant':
      await switchTo(args.toLowerCase());
      return;
    case 'leave-room':
      leave();
      break;
  }
  text.value = '';
}

async function submit(run: () => Promise<RoomMessageView>) {
  sending.value = true;
  const ok = await attempt(async () => {
    merge([await run()]);
  });
  sending.value = false;
  if (ok) {
    text.value = '';
    await scrollToEnd();
  }
}

async function switchTo(arg: string) {
  if (!moderator.value) {
    Notify.create({ type: 'warning', message: 'Only a Membership Admin switches the assistant on or off.' });
    return;
  }
  if (arg !== 'on' && arg !== 'off') {
    Notify.create({ type: 'warning', message: 'Use /assistant on or /assistant off.' });
    return;
  }
  const ok = await attempt(async () => {
    status.value = await switchAssistant(arg === 'on');
  }, arg === 'on' ? 'The assistant is on' : 'The assistant is off');
  if (ok) text.value = '';
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void send();
  }
}

function useHint(command: string) {
  text.value = `/${command} `;
}

/** Puts a picked emoji where the caret was (a textarea keeps its selection while the picker has the focus). */
async function insertEmoji(emoji: string) {
  const el = composer.value?.getNativeElement() as HTMLTextAreaElement | undefined;
  const start = el?.selectionStart ?? text.value.length;
  const next = insertText(text.value, start, el?.selectionEnd ?? start, emoji, ROOM_LIMITS.message);
  if (!next) {
    Notify.create({ type: 'warning', message: `A message holds at most ${ROOM_LIMITS.message} characters.` });
    return;
  }
  text.value = next.text;
  await nextTick();
  el?.focus();
  el?.setSelectionRange(next.caret, next.caret);
}

/** Votes and reactions come back as the message, as everyone else's reach this page through the updates. */
function vote(m: RoomMessageView, value: VoteValue) {
  void attempt(async () => merge([await voteOn(m.messageId, value)]));
}

function react(m: RoomMessageView, reaction: RoomReaction, on: boolean) {
  void attempt(async () => merge([await reactTo(m.messageId, reaction, on)]));
}

function openDecision(from: RoomMessageView | null, prefill: string) {
  decisionFrom.value = from;
  decisionText.value = prefill;
  decisionOpen.value = true;
}

function openAction(item: RoomActionView | null, task: string) {
  actionItem.value = item;
  actionTask.value = task;
  actionOpen.value = true;
}

function openMemory(query: string, highlight: string | null) {
  memoryQuery.value = query;
  memoryHighlight.value = highlight;
  memoryOpen.value = true;
}

function remove(m: RoomMessageView) {
  dialog({
    title: 'Delete this message?',
    message: m.mine ? 'Its text is erased for everyone.' : 'You are deleting another member’s message as a Membership Admin. Its text is erased for everyone.',
    cancel: { flat: true, noCaps: true, label: 'Keep it' },
    ok: { unelevated: true, noCaps: true, color: 'negative', label: 'Delete' },
  }).onOk(() => {
    void attempt(async () => merge([await deleteMessage(m.messageId, !m.mine)]));
  });
}

/** An answer's source: a message scrolls into view; a decision or action item opens memory on it. */
function showSource(s: RoomSource) {
  if (s.kind !== 'message') {
    openMemory('', s.id);
    return;
  }
  const el = document.getElementById(`msg-${s.id}`);
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('room-flash');
    setTimeout(() => el.classList.remove('room-flash'), 1600);
  } else {
    Notify.create({ type: 'info', message: `Further back in the room: “${s.excerpt}”` });
  }
}

watch(
  () => session.me?.account?.accountId,
  (now, before) => {
    if (now !== before && before !== undefined) {
      polling++;
      leaveCall();
      void load();
    }
  },
);
</script>

<template>
  <PageShell>
    <div class="ustp-content room-page">
      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!status" class="text-grey-7">Loading…</div>

      <!-- The door: nothing of the room until the terms are accepted (spec rule 1). -->
      <template v-else-if="!status.room">
        <div>
          <h1 class="text-h5 q-mb-xs">Members’ room</h1>
          <div class="text-grey-7">
            A chat room for Active members, with an assistant that keeps the group’s decisions and action items and answers
            questions about them.
          </div>
        </div>
        <q-banner v-if="!status.open" class="bg-grey-3 text-black" rounded>
          <template #avatar><q-icon name="lock" /></template>
          The room is closed for now{{ status.closed?.by ? `: ${status.closed.by.name} closed it` : '' }}. Nothing in it
          is deleted; it opens again when an admin opens it.
        </q-banner>
        <q-banner v-else-if="!status.member" class="bg-blue-1 text-black" rounded>
          The room is for Active members. <router-link v-if="!session.me?.member" to="/register">Apply to join the party</router-link
          ><template v-else>Your membership is not active now.</template>
        </q-banner>
        <q-card v-else flat bordered>
          <q-card-section>
            <h2 class="text-h6 q-mb-sm">Before you enter</h2>
            <q-banner v-if="status.consent?.withdrawnAt" class="bg-grey-2 text-black q-mb-md" rounded dense>
              You left the room. Accept the terms again to come back.
            </q-banner>
            <q-banner v-else-if="status.consent && status.consent.version !== status.terms.version" class="bg-blue-1 text-black q-mb-md" rounded dense>
              The room’s terms have changed since you accepted them. Read them again to enter.
            </q-banner>
            <div class="room-terms">
              <p v-for="(p, i) in status.terms.text.split('\n\n')" :key="i">{{ p }}</p>
            </div>
          </q-card-section>
          <q-card-actions class="q-px-md q-pb-md">
            <q-btn unelevated no-caps color="primary" label="Accept and enter" :loading="entering" @click="accept" />
            <q-btn flat no-caps label="Not now" to="/" />
          </q-card-actions>
        </q-card>
      </template>

      <!-- The room. -->
      <template v-else>
        <div class="room-header">
          <div class="col">
            <h1 class="text-h5 q-my-none">Members’ room</h1>
            <div class="text-caption text-grey-7">
              {{ people.length }} in the room: {{ peopleLine(people.map((p) => p.name)) }}
            </div>
          </div>
          <q-chip v-if="assistant" :color="assistant.on ? 'green-1' : 'grey-3'" text-color="black" :icon="assistant.on ? 'smart_toy' : 'block'" dense>
            {{ assistant.label }}
            <q-tooltip max-width="280px">{{ assistant.caption }}</q-tooltip>
          </q-chip>
          <q-btn outline no-caps color="primary" icon="psychology" label="Memory" @click="openMemory('', null)" />
          <q-btn flat round icon="more_vert" aria-label="Room menu">
            <q-menu auto-close>
              <q-list style="min-width: 220px">
                <q-item v-if="moderator" clickable @click="switchTo(room!.assistant.on ? 'off' : 'on')">
                  <q-item-section avatar><q-icon :name="room!.assistant.on ? 'pause_circle' : 'play_circle'" /></q-item-section>
                  <q-item-section>Switch the assistant {{ room!.assistant.on ? 'off' : 'on' }}</q-item-section>
                </q-item>
                <q-item clickable @click="leave">
                  <q-item-section avatar><q-icon name="logout" /></q-item-section>
                  <q-item-section>Leave the room</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </div>

        <VoiceBar :voice="voice" :call="call" :jokes="jokes" @join="joinCall" @leave="leaveCall" @mute="(m) => attempt(() => call.setMuted(m))" @joke="tellJoke" />

        <div ref="list" class="room-list" role="log" aria-live="polite" aria-label="Messages">
          <div v-if="older" class="text-center q-pa-sm">
            <q-btn flat no-caps dense color="primary" label="Show earlier messages" :loading="loadingOlder" @click="loadOlder" />
          </div>
          <div v-else-if="!messages.length" class="room-empty text-grey-7">
            Nothing here yet. Say hello, log a decision with <code>/decide</code>, or ask the assistant with <code>/ask</code>.
          </div>
          <template v-for="(m, i) in messages" :key="m.messageId">
            <div v-if="startsDay(messages, i)" class="room-day text-grey-7"><span>{{ dayLabel(m.createdAt) }}</span></div>
            <RoomMessage
              :message="m"
              :pending="pending.has(m.messageId)"
              :moderator="moderator"
              @decide="(msg) => openDecision(msg, '')"
              @delete="remove"
              @source="showSource"
              @vote="vote"
              @react="react"
            />
          </template>
        </div>

        <div class="room-composer">
          <q-card v-if="hints.length" bordered class="room-hints">
            <q-list dense role="listbox" aria-label="Commands">
              <q-item v-for="h in hints" :key="h.command" clickable role="option" @click="useHint(h.command)">
                <q-item-section>
                  <q-item-label><code>{{ h.usage }}</code></q-item-label>
                  <q-item-label caption>{{ h.does }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card>
          <div class="row no-wrap items-end q-gutter-sm">
            <q-input
              ref="composer"
              v-model="text"
              class="col"
              outlined
              autogrow
              dense
              :maxlength="ROOM_LIMITS.message"
              placeholder="Message the room, or type / for commands"
              aria-label="Message"
              :input-style="{ maxHeight: '160px' }"
              @keydown="onKey"
            >
              <template #append>
                <EmojiPicker @pick="insertEmoji" />
              </template>
            </q-input>
            <q-btn unelevated round color="primary" icon="send" aria-label="Send" :loading="sending" :disable="!text.trim()" @click="send" />
          </div>
          <div class="room-quick">
            <q-btn flat dense no-caps size="sm" icon="smart_toy" label="Ask" @click="useHint('ask')" />
            <q-btn flat dense no-caps size="sm" icon="gavel" label="Decision" @click="openDecision(null, '')" />
            <q-btn flat dense no-caps size="sm" icon="task_alt" label="Action item" @click="openAction(null, '')" />
            <q-btn flat dense no-caps size="sm" icon="sentiment_very_satisfied" label="Joke" :disable="sending" @click="tellJoke" />
            <q-space />
            <span class="text-caption text-grey-7">Enter sends · Shift+Enter for a new line</span>
          </div>
        </div>

        <DecisionDialog v-model="decisionOpen" :from="decisionFrom" :text="decisionText" />
        <ActionDialog v-model="actionOpen" :people="people" :task="actionTask" :item="actionItem" :my-id="myId" :as-admin="!!actionItem && !actionItem.editable" />
        <MemoryPanel v-model="memoryOpen" :query="memoryQuery" :memory-seq="memorySeq" :moderator="moderator" :highlight="memoryHighlight" @edit="(a) => openAction(a, '')" />
      </template>
    </div>
  </PageShell>
</template>

<style scoped>
.room-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.room-terms p {
  margin: 0 0 0.75em;
}
.room-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.room-list {
  height: min(60vh, 640px);
  min-height: 280px;
  overflow-y: auto;
  border: 1px solid rgba(128, 128, 128, 0.35);
  border-radius: 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.room-empty {
  margin: auto;
  max-width: 420px;
  text-align: center;
}
.room-day {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 4px;
  font-size: 0.8em;
}
.room-day::before,
.room-day::after {
  content: '';
  flex: 1;
  border-top: 1px solid rgba(128, 128, 128, 0.35);
}
.room-composer {
  position: relative;
}
.room-hints {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  right: 48px;
  z-index: 2;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}
.room-quick {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
:deep(.room-flash) {
  animation: room-flash 1.6s ease-out;
}
@keyframes room-flash {
  from {
    background: rgba(255, 193, 7, 0.35);
  }
  to {
    background: transparent;
  }
}
</style>
