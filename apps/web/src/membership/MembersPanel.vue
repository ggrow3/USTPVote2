<script setup lang="ts">
import { memberMailFlags } from '../notifications/api.js';
import { useQuasar } from 'quasar';
import { computed, onMounted, ref, watch } from 'vue';
import { adminStatusChanges, countryName, countryOf, DEFAULT_COUNTRY, type MemberRecord, type MemberStatus, type StatusHistoryRecord } from 'ustp-domain';
import { askReason, attempt } from '../dialogs.js';
import { offices as fetchOffices } from '../offices/api.js';
import { session } from '../session.js';
import AddMembersCard from './AddMembersCard.vue';
import { changeMemberStatus, memberHistory, members } from './api.js';
import { stateName } from './member-text.js';
import {
  CLASS_FILTERS,
  classCellText,
  filterRows,
  initials,
  mailFlagText,
  memberRows,
  membersCsv,
  membersCsvFileName,
  noOfficeText,
  placeKey,
  sinceText,
  sortRows,
  STATUS_LABELS,
  statusCounts,
  statusFilters,
  type ClassFilter,
  type MemberRow,
  type SortKey,
} from './members-list.js';

/** Rows per page of the table; the whole list is loaded, so the counts, search and sorting cover every member. */
const PAGE = 50;
/** The list endpoint's largest page. */
const FETCH = 500;

const $q = useQuasar();
const all = ref<MemberRow[]>([]);
/** An empty table only means "no members" once a load has succeeded. */
const listState = ref<'loading' | 'ready' | 'failed'>('loading');
const history = ref<{ member: MemberRecord; entries: StatusHistoryRecord[] } | null>(null);
/** The form and CSV import for adding members (design §5.13) is open. */
const adding = ref(false);

/** Null once the field's clear button is used. */
const search = ref<string | null>('');
/** A `placeKey`: a US state, or a country elsewhere; '' for everywhere. */
const place = ref('');
/** United States or Allied Members (design §5.2), or those never asked; '' for every class. */
const memberClass = ref<ClassFilter | ''>('');
const classOptions = [{ label: 'All classes', value: '' }, ...CLASS_FILTERS];
/** Members who cannot be emailed (design §10.12), or everyone. */
const mailFilter = ref<'unreachable' | ''>('');
const status = ref<MemberStatus | null>(null);
const sort = ref<{ key: SortKey; descending: boolean }>({ key: 'name', descending: false });
const page = ref(1);
/** Account IDs ticked for export; only rows the filters show are exported. */
const selected = ref(new Set<string>());

async function load() {
  const ok = await attempt(async () => {
    const found: MemberRecord[] = [];
    const offices = fetchOffices();
    // Membership Admins see who cannot be emailed; anyone else sees the table without it.
    const flags = memberMailFlags().catch(() => []);
    for (;;) {
      const batch = await members({ status: null, after: found.at(-1)?.accountId, limit: FETCH });
      found.push(...batch);
      if (batch.length < FETCH) break;
    }
    all.value = memberRows(found, await offices, await flags);
  });
  listState.value = ok ? 'ready' : 'failed';
}

const activeCount = computed(() => all.value.filter((r) => r.member.status === 'active').length);
/** The Location column: a US member's state code ("NY"), anyone else's country ("Canada"). */
const placeCell = (m: MemberRecord) => (countryOf(m) === DEFAULT_COUNTRY ? { code: m.state ?? '' } : { name: countryName(countryOf(m)) });
const placeOptions = computed(() => [
  { label: 'Everywhere', value: '' },
  ...[...new Map(all.value.map((r) => [placeKey(r.member), r.member])).entries()]
    .map(([key, m]) => ({ label: countryOf(m) === DEFAULT_COUNTRY ? stateName(m.state ?? '') : countryName(countryOf(m)), value: key }))
    .sort((a, b) => a.label.localeCompare(b.label)),
]);
/** Search, location and class first: the pills count within them. */
const scoped = computed(() =>
  filterRows(all.value, { search: search.value ?? '', place: place.value, memberClass: memberClass.value, mail: mailFilter.value }),
);
const counts = computed(() => statusCounts(scoped.value));
const pills = computed(() => statusFilters(counts.value, status.value));
const filtered = computed(() =>
  sortRows(
    status.value ? scoped.value.filter((r) => r.member.status === status.value) : scoped.value,
    sort.value.key,
    sort.value.descending,
  ),
);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE)));
const shown = computed(() => filtered.value.slice((page.value - 1) * PAGE, page.value * PAGE));
const now = new Date();
const shownRows = computed(() => shown.value.map((r) => ({ ...r, since: sinceText(r.member.memberSince, now) })));
const showing = computed(() => {
  const total = filtered.value.length;
  const range = pages.value > 1 ? `${(page.value - 1) * PAGE + 1}–${(page.value - 1) * PAGE + shown.value.length}` : `${total}`;
  return `Showing ${range} of ${total} ${total === 1 ? 'member' : 'members'}`;
});
const unreachable = computed(() => all.value.filter((r) => r.mail).length);
const mailOptions = computed(() => [
  { label: 'Everyone', value: '' },
  { label: `Can't be emailed (${unreachable.value})`, value: 'unreachable' },
]);
watch([search, place, memberClass, mailFilter, status, sort], () => (page.value = 1));
watch(pages, (n) => (page.value = Math.min(page.value, n)));

const COLUMNS: readonly { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Member' },
  { key: 'position', label: 'Position' },
  { key: 'state', label: 'Location' },
  { key: 'class', label: 'Class' },
  { key: 'status', label: 'Status' },
  { key: 'since', label: 'Member since' },
];

function sortBy(key: SortKey) {
  sort.value = { key, descending: sort.value.key === key && !sort.value.descending };
}

const ariaSort = (key: SortKey) => (sort.value.key !== key ? 'none' : sort.value.descending ? 'descending' : 'ascending');

// Selection: the header box ticks or clears the rows on this page.
const isSelected = (r: MemberRow) => selected.value.has(r.member.accountId);
const pageSelection = computed<boolean | null>(() => {
  const ticked = shown.value.filter(isSelected).length;
  return ticked === 0 ? false : ticked === shown.value.length ? true : null;
});

function select(r: MemberRow, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(r.member.accountId);
  else next.delete(r.member.accountId);
  selected.value = next;
}

function selectPage() {
  const on = pageSelection.value !== true;
  const next = new Set(selected.value);
  for (const r of shown.value) {
    if (on) next.add(r.member.accountId);
    else next.delete(r.member.accountId);
  }
  selected.value = next;
}

const exported = computed(() => {
  const ticked = filtered.value.filter(isSelected);
  return { rows: ticked.length ? ticked : filtered.value, ticked: ticked.length > 0 };
});

function exportCsv() {
  // A byte-order mark, so Excel reads accented names as UTF-8.
  const url = URL.createObjectURL(new Blob(['\uFEFF', membersCsv(exported.value.rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = membersCsvFileName(new Date());
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function clearFilters() {
  search.value = '';
  place.value = '';
  memberClass.value = '';
  status.value = null;
}

async function change(member: MemberRecord, to: MemberStatus) {
  const reason = await askReason(`Change status to ${to}`, `${member.legalName}: ${member.status} → ${to}.`);
  if (reason === null) return;
  if (await attempt(() => changeMemberStatus(member.accountId, { to, reason }), 'Status changed')) {
    await load();
  }
}

async function showHistory(member: MemberRecord) {
  await attempt(async () => {
    history.value = { member, entries: await memberHistory(member.accountId) };
  });
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
  $q.notify({ message: 'Account ID copied' });
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

onMounted(() => load());
</script>

<template>
  <q-card flat bordered class="members">
    <q-card-section class="ustp-header">
      <div>
        <h2 class="text-h6">Members</h2>
        <div class="text-caption text-grey-7">
          <template v-if="listState === 'ready'">{{ plural(all.length, 'member') }} · {{ activeCount }} active</template>
          <template v-else-if="listState === 'loading'">Loading…</template>
        </div>
      </div>
      <div class="members-head-actions">
        <q-btn v-if="!adding" outline no-caps icon="person_add" class="members-outline" label="Add members" @click="adding = true" />
        <q-btn outline no-caps icon="file_download" class="members-outline" :disable="!exported.rows.length" @click="exportCsv">
          <template v-if="exported.ticked">Export {{ exported.rows.length }} selected</template>
          <template v-else>Export CSV<span class="sr-only">: {{ plural(exported.rows.length, 'member') }}</span></template>
        </q-btn>
      </div>
    </q-card-section>

    <q-card-section v-if="adding">
      <AddMembersCard @added="load" @close="adding = false" />
    </q-card-section>

    <q-card-section class="members-toolbar">
      <q-input
        v-model="search"
        class="members-search"
        outlined
        dense
        clearable
        placeholder="Search by name"
        aria-label="Search by name"
      >
        <template #prepend><q-icon name="search" size="20px" /></template>
      </q-input>
      <div class="members-state">
        <label for="members-state" class="members-muted">Location</label>
        <q-select v-model="place" for="members-state" outlined dense emit-value map-options :options="placeOptions" />
      </div>
      <div class="members-state">
        <label for="members-class" class="members-muted">Class</label>
        <q-select v-model="memberClass" for="members-class" outlined dense emit-value map-options :options="classOptions" />
      </div>
      <div class="members-state">
        <label for="members-email" class="members-muted">Email</label>
        <q-select v-model="mailFilter" for="members-email" outlined dense emit-value map-options :options="mailOptions" />
      </div>
      <div role="group" aria-label="Status" class="members-pills">
        <button type="button" class="members-pill" :aria-pressed="status === null" @click="status = null">
          All <span class="members-count">{{ scoped.length }}</span>
        </button>
        <button v-for="s in pills" :key="s" type="button" class="members-pill" :aria-pressed="status === s" @click="status = s">
          <span class="members-dot" :class="`members--${s}`" aria-hidden="true" />{{ STATUS_LABELS[s] }}
          <span class="members-count">{{ counts[s] }}</span>
        </button>
      </div>
    </q-card-section>

    <q-markup-table flat square class="members-table">
      <thead>
        <tr>
          <th class="members-check">
            <q-checkbox
              :model-value="pageSelection"
              :disable="!shown.length"
              aria-label="Select every member on this page"
              @update:model-value="selectPage"
            />
          </th>
          <th v-for="c in COLUMNS" :key="c.key" class="text-left" :aria-sort="ariaSort(c.key)">
            <button type="button" class="members-sort" :class="{ 'members-sort--on': sort.key === c.key }" @click="sortBy(c.key)">
              {{ c.label }}
              <q-icon :name="sort.key === c.key && sort.descending ? 'arrow_downward' : 'arrow_upward'" size="14px" />
            </button>
          </th>
          <th class="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in shownRows" :key="r.member.accountId">
          <td class="members-check">
            <q-checkbox
              :model-value="isSelected(r)"
              :aria-label="`Select ${r.member.legalName}`"
              @update:model-value="select(r, $event)"
            />
          </td>
          <td>
            <div class="members-name">
              <span class="members-avatar" aria-hidden="true">{{ initials(r.member.legalName) }}</span>
              <router-link :to="`/admin/members/${r.member.accountId}`">{{ r.member.legalName }}</router-link>
              <q-icon v-if="r.mail" name="unsubscribe" color="warning" size="18px" role="img" :aria-label="`Can't be emailed: ${mailFlagText(r.mail)}`">
                <q-tooltip>Can't be emailed: {{ mailFlagText(r.mail) }}</q-tooltip>
              </q-icon>
              <q-btn
                flat
                dense
                round
                size="sm"
                icon="content_copy"
                class="members-muted"
                :aria-label="`Copy account ID of ${r.member.legalName}`"
                @click="copy(r.member.accountId)"
              />
            </div>
          </td>
          <td class="members-position">
            <div v-for="o in r.offices" :key="o.title">
              <div class="text-weight-medium">{{ o.title }}</div>
              <div v-if="o.description" class="text-caption members-muted members-clamp">{{ o.description }}</div>
            </div>
            <span v-if="!r.offices.length" class="members-muted">{{ noOfficeText(r.member.status) }}</span>
          </td>
          <td>
            <span v-if="placeCell(r.member).code !== undefined" class="members-code">{{ placeCell(r.member).code }}</span>
            <span v-else>{{ placeCell(r.member).name }}</span>
          </td>
          <td>
            <span v-if="classCellText(r.member)">{{ classCellText(r.member) }}</span>
            <span v-else class="members-muted">Not asked</span>
          </td>
          <td>
            <span class="members-status" :class="`members--${r.member.status}`">
              <span class="members-dot" aria-hidden="true" />{{ STATUS_LABELS[r.member.status] }}
            </span>
          </td>
          <td>
            <template v-if="r.since">
              <div>{{ r.since.date }}</div>
              <div class="text-caption members-muted">{{ r.since.ago }}</div>
            </template>
            <span v-else class="members-muted">—</span>
          </td>
          <td>
            <div class="members-actions">
              <q-btn flat dense no-caps icon="history" label="History" padding="4px 8px" @click="showHistory(r.member)">
                <span class="sr-only">&nbsp;of {{ r.member.legalName }}</span>
              </q-btn>
              <q-btn-dropdown
                v-if="adminStatusChanges(r.member.status).length > 0 && r.member.accountId !== session.me?.account?.accountId"
                outline
                no-caps
                dense
                padding="4px 12px"
                class="members-outline"
                dropdown-icon="expand_more"
                label="Change status"
                :aria-label="`Change status of ${r.member.legalName}`"
              >
                <q-list dense>
                  <q-item v-for="to in adminStatusChanges(r.member.status)" :key="to" v-close-popup clickable @click="change(r.member, to)">
                    <q-item-section>{{ STATUS_LABELS[to] }}</q-item-section>
                  </q-item>
                </q-list>
              </q-btn-dropdown>
            </div>
          </td>
        </tr>
        <tr v-if="listState === 'loading'">
          <td colspan="8" class="members-muted">Loading members…</td>
        </tr>
        <tr v-else-if="listState === 'failed'">
          <td colspan="8" class="members-muted">
            Could not load members.
            <q-btn flat dense no-caps color="primary" label="Try again" @click="load()" />
          </td>
        </tr>
        <tr v-else-if="!all.length">
          <td colspan="8" class="members-muted">No members yet.</td>
        </tr>
        <tr v-else-if="!filtered.length">
          <td colspan="8" class="members-muted">
            No members match.
            <q-btn flat dense no-caps color="primary" label="Clear search and filters" @click="clearFilters" />
          </td>
        </tr>
      </tbody>
    </q-markup-table>

    <q-card-section class="members-footer">
      <div class="members-muted" role="status">{{ listState === 'ready' ? showing : '' }}</div>
      <nav aria-label="Pages of members" class="members-pager">
        <q-btn outline dense icon="chevron_left" class="members-outline" aria-label="Previous page" :disable="page <= 1" @click="page--" />
        <span class="members-muted">Page {{ page }} of {{ pages }}</span>
        <q-btn outline dense icon="chevron_right" class="members-outline" aria-label="Next page" :disable="page >= pages" @click="page++" />
      </nav>
    </q-card-section>

    <q-dialog :model-value="!!history" aria-labelledby="history-title" @update:model-value="history = null">
      <q-card v-if="history" class="ustp-dialog">
        <q-card-section>
          <h2 id="history-title" class="text-h6">{{ history.member.legalName }} — status history</h2>
        </q-card-section>
        <q-list separator>
          <q-item v-for="h in history.entries" :key="h.ledgerSeq">
            <q-item-section>
              <q-item-label>{{ h.from ?? 'none' }} → {{ h.to }}</q-item-label>
              <q-item-label caption>
                {{ new Date(h.at).toLocaleString() }} · ledger #{{ h.ledgerSeq }}<span v-if="h.reason"> · {{ h.reason }}</span>
              </q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>
    </q-dialog>
  </q-card>
</template>

<style scoped>
/*
 * Colours on top of the theme: lines and control borders as Quasar draws a card's (black or white at low opacity), the
 * selected status pill in the menu bar's black (white in the dark theme), and a light and a dark tone for each status.
 * docs/ACCESSIBILITY.md has the contrast figures.
 */
.members {
  --members-line: rgba(0, 0, 0, 0.12);
  --members-control: rgba(0, 0, 0, 0.24);
  --members-head: rgba(0, 0, 0, 0.03);
  --members-hover: rgba(0, 0, 0, 0.05);
  --members-pressed-bg: #121212;
  --members-pressed-fg: #fff;
  --members-avatar-bg: #f6e6db;
  --members-avatar-fg: #aa4600;
  /* Darker than text-grey-7, so captions keep 4.5:1 on a row under Quasar's hover tint. */
  --members-muted: #616161;
}
.body--dark .members {
  --members-line: rgba(255, 255, 255, 0.28);
  --members-control: rgba(255, 255, 255, 0.36);
  --members-head: rgba(255, 255, 255, 0.04);
  --members-hover: rgba(255, 255, 255, 0.08);
  --members-pressed-bg: #fff;
  --members-pressed-fg: #121212;
  --members-avatar-bg: #4a2a14;
  --members-avatar-fg: #ffb68a;
  --members-muted: #b0b0b0;
}

/* Status tones: text and background of the row's pill, and the dot (pill and filter). */
.members--active {
  --tone: #2e7d32;
  --tone-bg: #e8f5e9;
}
.members--suspended {
  --tone: #c62828;
  --tone-bg: #ffebee;
}
.members--lapsed {
  --tone: #616161;
  --tone-bg: #eeeeee;
}
.members--resigned {
  --tone: #1565c0;
  --tone-bg: #e3f2fd;
}
.members--applicant {
  --tone: #9a4d00;
  --tone-bg: #fff3e0;
}
.members--rejected {
  --tone: #6a1b9a;
  --tone-bg: #f3e5f5;
}
.body--dark .members--active {
  --tone: #81c784;
  --tone-bg: #1e3320;
}
.body--dark .members--suspended {
  --tone: #ef9a9a;
  --tone-bg: #3d1e1e;
}
.body--dark .members--lapsed {
  --tone: #bdbdbd;
  --tone-bg: #2e2e2e;
}
.body--dark .members--resigned {
  --tone: #90caf9;
  --tone-bg: #1a2c3d;
}
.body--dark .members--applicant {
  --tone: #ffb74d;
  --tone-bg: #3a2a12;
}
.body--dark .members--rejected {
  --tone: #ce93d8;
  --tone-bg: #33203a;
}

.members-muted {
  color: var(--members-muted);
}

/* Neutral outlined buttons (Export CSV, Change status, the pager): Quasar's outline is the text colour itself. */
.members-outline.q-btn--outline::before {
  border-color: var(--members-control);
}

.members-head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.members-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
}
.members-search {
  flex: 1 1 240px;
  max-width: 360px;
}
.members-state {
  display: flex;
  align-items: center;
  gap: 8px;
}
.members-state > .q-select {
  width: 220px;
}
.members-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}
.members-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--members-control);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.members-pill:hover {
  background: var(--members-hover);
}
.members-pill[aria-pressed='true'] {
  border-color: var(--members-pressed-bg);
  background: var(--members-pressed-bg);
  color: var(--members-pressed-fg);
}
.members-count {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}
.members-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tone, currentColor);
}

.members-table {
  border-top: 1px solid var(--members-line);
  border-bottom: 1px solid var(--members-line);
}
.members-table thead tr {
  background: var(--members-head);
}
.members-table :is(th, td) {
  border-color: var(--members-line);
}
.members-table th {
  color: var(--members-muted);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}
.members-table td {
  padding-top: 10px;
  padding-bottom: 10px;
}
.members-check {
  width: 56px;
  padding-right: 0 !important;
}
.members-sort {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}
.members-sort > .q-icon {
  opacity: 0.35;
}
.members-sort--on > .q-icon,
.members-sort:hover > .q-icon {
  opacity: 1;
}

.members-name {
  display: flex;
  align-items: center;
  gap: 4px 10px;
  white-space: nowrap;
}
.members-name > a {
  font-weight: 500;
  text-decoration: none;
}
.members-name > a:hover,
.members-name > a:focus-visible {
  text-decoration: underline;
}
.members-name > .q-btn {
  margin-left: -6px;
}
.members-avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--members-avatar-bg);
  color: var(--members-avatar-fg);
  font-size: 13px;
  font-weight: 600;
}
.members-position {
  min-width: 160px;
  max-width: 260px;
  white-space: normal;
}
.members-position > div + div {
  margin-top: 4px;
}
.members-clamp {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
.members-code {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid var(--members-control);
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.members-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--tone-bg);
  color: var(--tone);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}
.members-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  white-space: nowrap;
}

.members-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  padding-top: 12px !important;
  padding-bottom: 12px;
}
.members-pager {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Phones: the search and state take the whole row, the pills wrap under them, and the table scrolls inside the card. */
@media (max-width: 599.98px) {
  .members-search {
    max-width: none;
    flex-basis: 100%;
  }
  .members-state {
    flex: 1 1 100%;
  }
  .members-state > .q-select {
    flex: 1;
    width: auto;
  }
  .members-pills {
    margin-left: 0;
  }
}
</style>
