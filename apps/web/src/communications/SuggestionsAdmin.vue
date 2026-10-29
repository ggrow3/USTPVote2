<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { SUGGESTION_LIMITS, SUGGESTION_RETENTION_DAYS, SUGGESTION_STATUSES, type SuggestionRecord, type SuggestionStatus } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { confirmAction } from './admin-forms.js';
import { deleteSuggestion, suggestions, triageSuggestion } from './api.js';
import { shortTime, SUGGESTION_STATUS_LABELS, SUGGESTION_TOPIC_LABELS } from './comms-text.js';

/**
 * Suggestions sent with the public form (design §10.9), for Communications Admins only: read them, reply by email where
 * the sender left one, note what was done, and mark spam. Opening a new one marks it read. Each is deleted a year after
 * it arrives; delete one sooner when it is spam or the sender asks.
 */
const emit = defineEmits<{ unread: [count: number] }>();
const all = ref<SuggestionRecord[] | null>(null);
const filter = ref<SuggestionStatus | 'open'>('open');
const notes = ref<Record<string, string>>({});

const filters = [
  { value: 'open', label: 'To handle' },
  ...SUGGESTION_STATUSES.map((s) => ({ value: s, label: SUGGESTION_STATUS_LABELS[s] })),
] as { value: SuggestionStatus | 'open'; label: string }[];

const shown = computed(() =>
  (all.value ?? []).filter((s) => (filter.value === 'open' ? s.status === 'new' || s.status === 'read' : s.status === filter.value)),
);
const countOf = (f: SuggestionStatus | 'open') =>
  (all.value ?? []).filter((s) => (f === 'open' ? s.status === 'new' || s.status === 'read' : s.status === f)).length;

async function load() {
  await attempt(async () => {
    all.value = await suggestions();
    notes.value = Object.fromEntries(all.value.map((s) => [s.suggestionId, s.note]));
    emit('unread', all.value.filter((s) => s.status === 'new').length);
  });
}

function replace(updated: SuggestionRecord) {
  all.value = (all.value ?? []).map((s) => (s.suggestionId === updated.suggestionId ? updated : s));
  emit('unread', all.value.filter((s) => s.status === 'new').length);
}

async function setStatus(s: SuggestionRecord, status: SuggestionStatus, quiet = false) {
  await attempt(async () => {
    replace(await triageSuggestion(s.suggestionId, { status, note: notes.value[s.suggestionId] ?? s.note }));
  }, quiet ? undefined : `Marked ${SUGGESTION_STATUS_LABELS[status].toLowerCase()}`);
}

function opened(s: SuggestionRecord) {
  if (s.status === 'new') void setStatus(s, 'read', true);
}

async function saveNote(s: SuggestionRecord) {
  await attempt(async () => {
    replace(await triageSuggestion(s.suggestionId, { status: s.status, note: notes.value[s.suggestionId] ?? '' }));
  }, 'Note saved');
}

async function remove(s: SuggestionRecord) {
  if (!(await confirmAction('Delete this suggestion?', 'It is gone for good, with any name and email it came with.', 'Delete'))) return;
  if (await attempt(() => deleteSuggestion(s.suggestionId), 'Deleted')) await load();
}

const replyLink = (s: SuggestionRecord) => `mailto:${s.email}?subject=${encodeURIComponent('Your suggestion to the US Transhumanist Party')}`;

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <p class="text-grey-7">
      Suggestions anyone sent with the <router-link to="/suggest">public form</router-link>. Only Communications Admins
      see them, and they are not in the audit ledger. Each is deleted {{ SUGGESTION_RETENTION_DAYS }} days after it
      arrives, with any name and email.
    </p>
    <div class="ustp-actions">
      <q-btn-toggle v-model="filter" no-caps unelevated toggle-color="primary" color="grey-3" text-color="black" :options="filters.map((f) => ({ value: f.value, label: `${f.label} (${countOf(f.value)})` }))" />
      <q-btn flat no-caps icon="refresh" label="Refresh" @click="load" />
    </div>
    <div v-if="all && shown.length === 0" class="text-grey-7">Nothing here.</div>
    <q-list v-else-if="all" bordered separator class="rounded-borders">
      <q-expansion-item v-for="s in shown" :key="s.suggestionId" @show="opened(s)">
        <template #header>
          <q-item-section>
            <q-item-label :class="{ 'text-weight-bold': s.status === 'new' }">{{ SUGGESTION_TOPIC_LABELS[s.topic] }} · {{ shortTime(s.receivedAt) }}</q-item-label>
            <q-item-label caption class="ellipsis">{{ s.message }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="ustp-actions">
              <q-badge v-if="s.flagged" color="orange-9" label="Many links" />
              <q-badge v-if="s.email" color="blue-8" label="Can reply" />
              <q-badge color="grey-7" :label="SUGGESTION_STATUS_LABELS[s.status]" />
            </div>
          </q-item-section>
        </template>
        <q-card flat>
          <q-card-section class="ustp-form">
            <div class="suggestion-message">{{ s.message }}</div>
            <div v-if="s.name || s.email" class="text-body2">
              From {{ s.name ?? 'someone' }}<template v-if="s.email">, <a :href="replyLink(s)">{{ s.email }}</a></template>
            </div>
            <div v-else class="text-caption text-grey-7">Sent anonymously.</div>
            <q-input
              v-model="notes[s.suggestionId]"
              outlined
              dense
              type="textarea"
              autogrow
              label="Team note (optional)"
              :maxlength="SUGGESTION_LIMITS.note"
            />
            <div class="ustp-actions">
              <q-btn flat no-caps color="primary" label="Save note" :disable="(notes[s.suggestionId] ?? '') === s.note" @click="saveNote(s)" />
              <q-btn v-if="s.email && s.status !== 'answered'" flat no-caps label="Mark answered" @click="setStatus(s, 'answered')" />
              <q-btn v-if="s.status !== 'archived'" flat no-caps label="Archive" @click="setStatus(s, 'archived')" />
              <q-btn v-if="s.status !== 'spam'" flat no-caps label="Spam" @click="setStatus(s, 'spam')" />
              <q-btn v-if="s.status === 'archived' || s.status === 'spam' || s.status === 'answered'" flat no-caps label="Back to handle" @click="setStatus(s, 'read')" />
              <q-btn flat no-caps color="negative" label="Delete" @click="remove(s)" />
            </div>
            <div v-if="s.handledAt" class="text-caption text-grey-7">Last handled {{ shortTime(s.handledAt) }}.</div>
          </q-card-section>
        </q-card>
      </q-expansion-item>
    </q-list>
  </div>
</template>

<style scoped>
.suggestion-message {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
