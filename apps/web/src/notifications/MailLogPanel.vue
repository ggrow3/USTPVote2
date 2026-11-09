<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { MAIL_CAUSED_BY_SYSTEM, MAIL_KINDS, MAIL_STATUSES, type MailKind, type MailLogQuery, type MailLogRow, type MailStatus } from 'ustp-domain';
import { announce } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { accountsByEmail, browserTimeZone, mailLog, searchMembersToEmail } from './api.js';
import { LOG_KIND_LABELS, LOG_STATUS_COLOURS, LOG_STATUS_LABELS, logBounce, logCause, logKind, logRecipient, logStatus } from './mail-log-text.js';

/**
 * The email log (design §10.12), for System and Site Admins: every email the site sent, newest first, with whom and which
 * address it went to, who caused it and what its delivery report said. Never its words: a group email's are on Email
 * members. Kept 180 days. Its days are in the admin's time zone; Daily counts opens it narrowed to a person and a day.
 */
interface Person {
  readonly accountId: string;
  readonly label: string;
}

const props = defineProps<{
  /** A narrowing to apply, from Daily counts; a new object each time, so the same person and day can come again. */
  preset?: { readonly accountId: string | null; readonly label: string | null; readonly day: string } | null;
}>();

const SYSTEM: Person = { accountId: MAIL_CAUSED_BY_SYSTEM, label: 'The site, by itself' };

const to = ref<Person | null>(null);
const causedBy = ref<Person | null>(null);
const kind = ref<MailKind | null>(null);
const status = ref<MailStatus | null>(null);
const from = ref('');
const until = ref('');

const rows = ref<MailLogRow[]>([]);
const next = ref<string | null>(null);
const scanLimited = ref(false);
const loading = ref(false);
const loaded = ref(false);

const kindOptions = MAIL_KINDS.map((k) => ({ value: k, label: LOG_KIND_LABELS[k] }));
const statusOptions = MAIL_STATUSES.map((s) => ({ value: s, label: LOG_STATUS_LABELS[s] }));

const query = computed<MailLogQuery>(() => ({
  account: to.value?.accountId,
  causedBy: causedBy.value?.accountId,
  kind: kind.value ?? undefined,
  status: status.value ?? undefined,
  from: from.value || undefined,
  to: until.value || undefined,
}));
const filtered = computed(() => Object.values(query.value).some(Boolean));
const rangeError = computed(() => (from.value && until.value && from.value > until.value ? 'The first day comes after the last.' : ''));

async function load(more = false) {
  if (rangeError.value) return;
  loading.value = true;
  await attempt(async () => {
    const page = await mailLog({ ...query.value, tz: browserTimeZone(), after: more ? (next.value ?? undefined) : undefined });
    rows.value = more ? [...rows.value, ...page.rows] : [...page.rows];
    next.value = page.next;
    scanLimited.value = page.scanLimited;
    loaded.value = true;
    announce(`${rows.value.length} ${rows.value.length === 1 ? 'email' : 'emails'} shown${page.next ? ', more to load' : ''}.`);
  });
  loading.value = false;
}

watch(query, () => void load(), { deep: true });

/** Narrows the log to a person (or everyone) on one day, as Daily counts asks. */
function applyPreset() {
  const p = props.preset;
  if (!p) return;
  to.value = p.accountId ? { accountId: p.accountId, label: p.label ?? 'This account' } : null;
  causedBy.value = null;
  kind.value = null;
  status.value = null;
  from.value = p.day;
  until.value = p.day;
}
watch(() => props.preset, applyPreset);
onMounted(() => {
  // Set before the first load, which the watch on the query then makes.
  if (props.preset) applyPreset();
  else void load();
});

// --- finding a person by name or address ----------------------------------------------------------------------------

const SEARCH_DELAY_MS = 300;
const found = ref<Person[]>([]);
let timer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(timer));

/** Quasar's filter: by address when it has an @, else Active members by name; a later search supersedes this one. */
function searchPeople(withSystem: boolean) {
  return (text: string, update: (fn: () => void) => void, abort: () => void) => {
    clearTimeout(timer);
    const q = text.trim();
    if (!q) {
      update(() => (found.value = withSystem ? [SYSTEM] : []));
      return;
    }
    timer = setTimeout(async () => {
      try {
        const people: Person[] = q.includes('@')
          ? (await accountsByEmail(q)).map((a) => ({ accountId: a.accountId, label: a.displayName ? `${a.displayName} (${a.primaryEmail})` : (a.primaryEmail ?? a.accountId) }))
          : (await searchMembersToEmail(q)).map((m) => ({ accountId: m.accountId, label: m.preferredName ? `${m.preferredName} (${m.legalName})` : m.legalName }));
        update(() => (found.value = people));
        announce(people.length ? `${people.length} found. Use the down arrow to choose.` : 'Nobody found.');
      } catch {
        abort();
        announce('The search failed. Try again.');
      }
    }, SEARCH_DELAY_MS);
  };
}

/** Narrows the log to one person from a row. */
function only(field: 'to' | 'causedBy', row: MailLogRow) {
  if (field === 'to' && row.accountId) to.value = { accountId: row.accountId, label: row.accountName ?? row.accountEmail ?? 'This account' };
  if (field === 'causedBy' && row.causedBy) causedBy.value = row.causedBy === MAIL_CAUSED_BY_SYSTEM ? SYSTEM : { accountId: row.causedBy, label: row.causedByName ?? 'This account' };
}

function clear() {
  to.value = null;
  causedBy.value = null;
  kind.value = null;
  status.value = null;
  from.value = '';
  until.value = '';
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function what(row: MailLogRow): string {
  return row.electionTitle ? `${logKind(row)}: ${row.electionTitle}` : logKind(row);
}

function reported(row: MailLogRow): string | null {
  const bounce = logBounce(row);
  if (bounce) return bounce;
  if (row.complainedAt) return `Marked as spam ${when(row.complainedAt)}`;
  if (row.deliveredAt) return `Delivered ${when(row.deliveredAt)}`;
  return null;
}
</script>

<template>
  <div class="ustp-content">
    <div>
      <h2 class="text-subtitle1">Email log</h2>
      <p class="q-mb-none">
        Every email the site sent in the last 180 days, newest first: whom and which address it went to, who caused it, and
        what the recipient’s mail server did with it. It never keeps an email’s words. Emails sent before 9 November 2026
        did not keep their address: theirs show the account’s address now. Days are in your time zone. Whether anyone
        opened an email is never known.
      </p>
    </div>

    <q-card flat bordered tag="section" aria-labelledby="log-filters">
      <q-card-section class="q-pb-none">
        <h3 id="log-filters" class="text-subtitle2 q-my-none">Find emails</h3>
      </q-card-section>
      <q-card-section class="row q-col-gutter-sm">
        <q-select
          v-model="to"
          class="col-12 col-sm-6"
          outlined
          dense
          clearable
          use-input
          input-debounce="0"
          label="Sent to"
          hint="A member’s name, or the start of an address"
          :options="found"
          option-value="accountId"
          option-label="label"
          @filter="searchPeople(false)"
        />
        <q-select
          v-model="causedBy"
          class="col-12 col-sm-6"
          outlined
          dense
          clearable
          use-input
          input-debounce="0"
          label="Caused by"
          hint="An admin’s or member’s name, an address, or the site itself"
          :options="found"
          option-value="accountId"
          option-label="label"
          @filter="searchPeople(true)"
        />
        <q-select v-model="kind" class="col-12 col-sm-6" outlined dense clearable emit-value map-options label="Kind of email" :options="kindOptions" />
        <q-select v-model="status" class="col-12 col-sm-6" outlined dense clearable emit-value map-options label="What became of it" :options="statusOptions" />
        <q-input v-model="from" class="col-6" outlined dense type="date" label="From" stack-label :error="!!rangeError" :error-message="rangeError" />
        <q-input v-model="until" class="col-6" outlined dense type="date" label="Until" stack-label />
      </q-card-section>
      <q-card-actions v-if="filtered" class="q-pt-none">
        <q-btn flat no-caps color="primary" icon="filter_alt_off" label="Show every email" @click="clear" />
      </q-card-actions>
    </q-card>

    <q-list v-if="rows.length" separator bordered class="rounded-borders" aria-label="Emails sent">
      <q-item v-for="row in rows" :key="row.messageId">
        <q-item-section>
          <q-item-label class="text-weight-medium">{{ what(row) }}</q-item-label>
          <q-item-label caption>
            To
            <button v-if="row.accountId && !to" type="button" class="mail-log__only" :title="`Show only emails to ${logRecipient(row)}`" @click="only('to', row)">{{ logRecipient(row) }}</button>
            <template v-else>{{ logRecipient(row) }}</template>
            · caused by
            <button v-if="row.causedBy && !causedBy" type="button" class="mail-log__only" :title="`Show only emails caused by ${logCause(row)}`" @click="only('causedBy', row)">{{ logCause(row) }}</button>
            <template v-else>{{ logCause(row) }}</template>
          </q-item-label>
          <q-item-label caption>
            Sent {{ when(row.sentAt) }}<template v-if="row.delivery === 'outbox'"> to the test outbox, not by mail</template><template v-if="reported(row)"> · {{ reported(row) }}</template>
          </q-item-label>
        </q-item-section>
        <q-item-section side top>
          <q-chip dense square :color="LOG_STATUS_COLOURS[row.status]" text-color="white" :label="logStatus(row)" />
        </q-item-section>
      </q-item>
    </q-list>
    <p v-else-if="loaded && !loading" class="text-grey-7 q-my-none" role="status">
      {{ filtered ? 'No email matches these choices.' : 'The site has sent no email in the last 180 days.' }}
    </p>
    <p v-if="scanLimited" class="text-grey-7 q-my-none">
      Only part of the log was searched this time, as few emails match. Load more to search further back, or choose a
      narrower range of days.
    </p>
    <div v-if="next" class="ustp-actions">
      <q-btn outline no-caps color="primary" icon="expand_more" label="Load more" :loading="loading" @click="load(true)" />
    </div>
  </div>
</template>

<style scoped>
/* A name in a row narrows the log to it: a button, written like a link in the text. */
.mail-log__only {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--ustp-link);
  text-decoration: underline;
  cursor: pointer;
}
</style>
