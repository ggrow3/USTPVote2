<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  CALENDAR_LIMITS,
  calendarItemOverdue,
  createCalendarItemSchema,
  NETWORK_NAMES,
  SHARE_LIMITS,
  SHARE_TARGETS,
  shareLength,
  shareUrl,
  SOCIAL_NETWORKS,
  updateCalendarItemSchema,
  type CalendarItemRecord,
  type ShareTarget,
  type SocialNetwork,
} from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import { attempt, dialog } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { confirmAction } from './admin-forms.js';
import { calendar, createCalendarItem, deleteCalendarItem, saveCalendarItem, setCalendarStatus, team } from './api.js';
import { CALENDAR_STATUS_LABELS, fromLocalInput, kitShareable, shortTime, siteIcon, toLocalInput } from './comms-text.js';

/**
 * The social media calendar (design §10.9): what the party's own accounts post, and when. "Open composer" opens the
 * site with the post filled in, for whoever is signed in to the party's account there; then mark it posted with its
 * link. The team's own planning: not ledgered.
 */
const items = ref<CalendarItemRecord[] | null>(null);
const people = ref<{ accountId: string; name: string }[]>([]);
const now = ref(new Date().toISOString());

interface Form {
  network: SocialNetwork;
  account: string;
  when: string;
  text: string;
  url: string;
  assignee: string | null;
  notes: string;
}
/** The editor: whether it is open, the item it edits (null for a new one), and the form. */
const editing = ref(false);
const current = ref<CalendarItemRecord | null>(null);
const form = ref<Form>({ network: 'x', account: '', when: '', text: '', url: '', assignee: null, notes: '' });
const errors = ref<FieldErrors>({});

const networks = SOCIAL_NETWORKS.map((value) => ({ value, label: NETWORK_NAMES[value] }));
const assignees = computed(() => [{ value: null, label: 'Anyone on the team' }, ...people.value.map((p) => ({ value: p.accountId, label: p.name }))]);
const nameOf = (accountId: string | null) => (accountId ? (people.value.find((p) => p.accountId === accountId)?.name ?? 'someone') : null);

async function load() {
  now.value = new Date().toISOString();
  await attempt(async () => {
    [items.value, people.value] = await Promise.all([calendar(), team()]);
  });
}

/** Overdue first, then what is coming by day, then what is done (newest first). */
const groups = computed(() => {
  const all = items.value ?? [];
  const overdue = all.filter((i) => calendarItemOverdue(i, now.value));
  const upcoming = all.filter((i) => i.status === 'planned' && !calendarItemOverdue(i, now.value));
  const done = all.filter((i) => i.status !== 'planned').reverse();
  const byDay = new Map<string, CalendarItemRecord[]>();
  for (const i of upcoming) {
    const day = new Date(i.scheduledFor).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    byDay.set(day, [...(byDay.get(day) ?? []), i]);
  }
  return [
    ...(overdue.length ? [{ title: 'Overdue', list: overdue, tone: 'text-negative' }] : []),
    ...[...byDay].map(([title, list]) => ({ title, list, tone: '' })),
    ...(done.length ? [{ title: 'Done', list: done, tone: 'text-grey-7' }] : []),
  ];
});

function startNew() {
  const at = new Date(Date.now() + 86_400_000);
  at.setMinutes(0, 0, 0);
  current.value = null;
  form.value = { network: 'x', account: '', when: toLocalInput(at.toISOString()), text: '', url: '', assignee: null, notes: '' };
  editing.value = true;
  errors.value = {};
}

function open(i: CalendarItemRecord) {
  current.value = i;
  form.value = { network: i.network, account: i.account, when: toLocalInput(i.scheduledFor), text: i.text, url: i.url, assignee: i.assignee, notes: i.notes };
  editing.value = true;
  errors.value = {};
}

const isTarget = (n: SocialNetwork): n is Extract<SocialNetwork, ShareTarget> => (SHARE_TARGETS as readonly string[]).includes(n);
const shareable = (i: Pick<CalendarItemRecord, 'text' | 'url'>) => kitShareable({ title: '', text: i.text, url: i.url, hashtags: [] });
/** The composer for an item's network, where it has one that takes text. */
const composer = (i: CalendarItemRecord) => (isTarget(i.network) && i.text ? shareUrl(i.network, shareable(i)) : null);

const length = computed(() => {
  const f = form.value;
  if (!editing.value || !isTarget(f.network) || SHARE_LIMITS[f.network] === null) return null;
  return { count: shareLength(f.network, shareable(f)), limit: SHARE_LIMITS[f.network]! };
});

async function save() {
  if (!editing.value) return;
  const item = current.value;
  const f = form.value;
  const body = { network: f.network, account: f.account, scheduledFor: fromLocalInput(f.when), text: f.text, url: f.url, assignee: f.assignee, notes: f.notes };
  const checked = item ? validate(updateCalendarItemSchema, { ...body, basedOn: item.version }) : validate(createCalendarItemSchema, body);
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  const ok = await attempt(async () => {
    try {
      if (item) await saveCalendarItem(item.itemId, checked.data as Parameters<typeof saveCalendarItem>[1]);
      else await createCalendarItem(checked.data as Parameters<typeof createCalendarItem>[0]);
    } catch (err) {
      errors.value = apiFieldErrors(err);
      throw err;
    }
  }, 'Saved');
  if (ok) {
    editing.value = false;
    await load();
  }
}

function markPosted(i: CalendarItemRecord) {
  dialog({
    title: 'Posted',
    message: 'Paste the address of the post, so the team can find it (optional).',
    prompt: { model: i.postedUrl, type: 'url', label: 'https://…' },
    cancel: true,
  }).onOk(async (postedUrl: string) => {
    if (await attempt(() => setCalendarStatus(i.itemId, { basedOn: i.version, status: 'posted', postedUrl: postedUrl.trim() }), 'Marked posted')) await load();
  });
}

async function setStatus(i: CalendarItemRecord, status: 'planned' | 'skipped') {
  if (await attempt(() => setCalendarStatus(i.itemId, { basedOn: i.version, status, postedUrl: '' }), status === 'skipped' ? 'Skipped' : 'Planned again')) await load();
}

async function remove(i: CalendarItemRecord) {
  if (!(await confirmAction('Delete this item?', 'It leaves the calendar for good.', 'Delete'))) return;
  if (await attempt(() => deleteCalendarItem(i.itemId), 'Deleted')) {
    editing.value = false;
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <p class="text-grey-7">
      Plan what the party's own accounts post, and when. When it is time, open the composer (signed in as the party's
      account there), post, then mark it posted. Times are in your time zone.
    </p>
    <div class="ustp-actions">
      <q-btn v-if="!editing" unelevated no-caps color="primary" icon="add" label="Plan a post" @click="startNew" />
      <q-btn flat no-caps icon="refresh" label="Refresh" @click="load" />
    </div>

    <q-card v-if="editing" flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1">{{ current ? 'Planned post' : 'Plan a post' }}</h2>
      </q-card-section>
      <q-card-section>
        <q-form class="ustp-form" novalidate @submit.prevent="save">
          <div class="ustp-row">
            <q-select v-model="form.network" outlined dense emit-value map-options :options="networks" label="Site" />
            <q-input v-model="form.account" outlined dense label="Account (optional)" placeholder="@USTranshumanist" :maxlength="CALENDAR_LIMITS.account" />
          </div>
          <q-input
            v-model="form.when"
            outlined
            dense
            type="datetime-local"
            label="When"
            stack-label
            :error="!!errors.scheduledFor"
            :error-message="errors.scheduledFor ? 'choose a date and time' : undefined"
          />
          <q-input
            v-model="form.text"
            outlined
            type="textarea"
            autogrow
            label="The post"
            :maxlength="CALENDAR_LIMITS.text"
            :hint="length ? `${length.count}/${length.limit} as ${NETWORK_NAMES[form.network]} counts it` : undefined"
            :error="!!length && length.count > length.limit"
            :error-message="length && length.count > length.limit ? `${length.count}/${length.limit}: too long for ${NETWORK_NAMES[form.network]}` : undefined"
          />
          <q-input v-model="form.url" outlined dense label="Link (optional)" placeholder="/news/… or https://…" :error="!!errors.url" :error-message="errors.url" />
          <q-select v-model="form.assignee" outlined dense emit-value map-options :options="assignees" label="Who posts it" :error="!!errors.assignee" :error-message="errors.assignee" />
          <q-input v-model="form.notes" outlined type="textarea" autogrow label="Notes for the team (optional)" :maxlength="CALENDAR_LIMITS.notes" />
          <div class="ustp-actions">
            <q-btn type="submit" unelevated no-caps color="primary" label="Save" />
            <q-btn v-if="current" flat no-caps color="negative" label="Delete" @click="remove(current)" />
            <q-btn flat no-caps label="Close" @click="editing = false" />
          </div>
        </q-form>
      </q-card-section>
    </q-card>

    <div v-if="items && items.length === 0 && !editing" class="text-grey-7">Nothing planned.</div>
    <section v-for="g in groups" :key="g.title">
      <h3 class="text-body1 text-weight-medium q-my-sm" :class="g.tone">{{ g.title }}</h3>
      <q-list bordered separator class="rounded-borders">
        <q-item v-for="i in g.list" :key="i.itemId">
          <q-item-section avatar><q-icon :name="siteIcon(i.network)" :aria-label="NETWORK_NAMES[i.network]" /></q-item-section>
          <q-item-section>
            <q-item-label>
              {{ shortTime(i.scheduledFor) }} · {{ NETWORK_NAMES[i.network] }}{{ i.account ? ` ${i.account}` : '' }}
            </q-item-label>
            <q-item-label caption class="calendar-text">{{ i.text || '(no text yet)' }}</q-item-label>
            <q-item-label caption>
              {{ CALENDAR_STATUS_LABELS[i.status] }}<template v-if="nameOf(i.assignee)"> · {{ nameOf(i.assignee) }} posts it</template>
              <template v-if="i.postedUrl">
                · <a :href="i.postedUrl" target="_blank" rel="noopener noreferrer">the post</a>
              </template>
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="ustp-actions">
              <q-btn
                v-if="i.status === 'planned' && composer(i)"
                flat
                dense
                no-caps
                color="primary"
                icon="open_in_new"
                label="Open composer"
                :href="composer(i)!"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="`Open the ${NETWORK_NAMES[i.network]} composer with this post (new tab)`"
              />
              <q-btn v-if="i.status === 'planned'" flat dense no-caps label="Posted…" @click="markPosted(i)" />
              <q-btn v-if="i.status === 'planned'" flat dense no-caps label="Skip" @click="setStatus(i, 'skipped')" />
              <q-btn v-else flat dense no-caps label="Plan again" @click="setStatus(i, 'planned')" />
              <q-btn flat dense round icon="edit" :aria-label="`Edit the post for ${shortTime(i.scheduledFor)}`" @click="open(i)" />
            </div>
          </q-item-section>
        </q-item>
      </q-list>
    </section>
  </div>
</template>

<style scoped>
.calendar-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 4.5em;
  overflow: hidden;
}
</style>
