<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  ADMIN_SECTIONS,
  AUDIENCES,
  checkNavigationSettings,
  DEFAULT_NAVIGATION,
  MEMBERSHIP_AUDIENCES,
  MENU_LINKS,
  menuLock,
  navigationChanges,
  resolveNavigation,
  ROLES,
  sectionLock,
  startPageOptions,
  type AdminSection,
  type Audience,
  type MenuLink,
  type NavigationRecord,
  type NavigationSettings,
  type Role,
  type SignedInAudience,
  type StartPage,
} from 'ustp-domain';
import { focusSoon } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { navigationSettings, saveNavigation } from './api.js';
import { cellRuns } from './navigation-matrix.js';
import { applyNavigation } from './navigation.js';
import {
  AUDIENCE_CAPTIONS,
  AUDIENCE_LABELS,
  cellName,
  describeChange,
  lockText,
  MENU_CAPTIONS,
  MENU_LABELS,
  SECTION_CAPTIONS,
  SECTION_LABELS,
  startPageLabel,
} from './navigation-text.js';

/** Who sees which link (design §10.5): System Admins edit the whole matrix, then save it in one go. */

type Draft = {
  menu: Record<Audience, Record<MenuLink, boolean>>;
  sections: Record<Role, Record<AdminSection, boolean>>;
  startsOn: Record<SignedInAudience, StartPage>;
};

const copy = ({ menu, sections, startsOn }: NavigationSettings): Draft => JSON.parse(JSON.stringify({ menu, sections, startsOn }));

const saved = ref<NavigationRecord | null>(null);
const draft = ref<Draft | null>(null);
/** What the draft amounts to: locked cells at their value, Admin links from sections, start pages still shown. */
const resolved = computed(() => draft.value && resolveNavigation(draft.value));
const changes = computed(() => (saved.value && resolved.value ? navigationChanges(saved.value, resolved.value) : []));
/** Why the API would refuse the draft, if it would (a locked cell cannot be switched here, so: visitors left no way to sign in). */
const refusal = computed(() => {
  const check = resolved.value && checkNavigationSettings(resolved.value);
  return check && !check.ok ? check.reason : null;
});
const isDefault = computed(() => !!resolved.value && navigationChanges(DEFAULT_NAVIGATION, resolved.value).length === 0);

const columns = ref<'all' | 'membership' | 'roles'>('all');
const COLUMN_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'membership', label: 'Membership' },
  { value: 'roles', label: 'Staff roles' },
];
const membershipColumns = computed(() => (columns.value === 'roles' ? [] : MEMBERSHIP_AUDIENCES));
const roleColumns = computed(() => (columns.value === 'membership' ? [] : ROLES));
const audiences = computed<Audience[]>(() => [...membershipColumns.value, ...roleColumns.value]);

/** Admin sections are only ever a role's, so their rows need the role columns; focus stays with the rows it brings. */
function showStaffRoles() {
  columns.value = 'roles';
  void focusSoon('#nav-sections');
}

/** A menu link's cells: Sign in for everyone signed in is one cell saying so, not a dash in each column. */
const menuRow = (l: MenuLink) => cellRuns(audiences.value, (a) => (menuLock(a, l) === 'signed_in' ? lockText('signed_in', a) : null));

async function load() {
  await attempt(async () => {
    saved.value = await navigationSettings();
    draft.value = copy(saved.value);
  });
}

async function save() {
  if (!saved.value || !resolved.value) return;
  const settings = resolved.value;
  await attempt(async () => {
    saved.value = await saveNavigation({ basedOn: saved.value!.version, ...settings });
    draft.value = copy(saved.value);
    applyNavigation(saved.value);
  }, 'Saved. Menus follow it as each person next opens the app.');
}

function restoreDefaults() {
  draft.value = copy(DEFAULT_NAVIGATION);
}

/** An audience's start pages: the menu pages, then its admin sections (grouped, so their names can be short). */
const pagesOf = (a: SignedInAudience) => startPageOptions(resolved.value!, a).filter((p) => !p.startsWith('admin/'));
const sectionsOf = (a: SignedInAudience) => startPageOptions(resolved.value!, a).filter((p) => p.startsWith('admin/'));

function setStart(audience: SignedInAudience, event: Event) {
  draft.value!.startsOn[audience] = (event.target as HTMLSelectElement).value as StartPage;
}

const savedAt = computed(() => (saved.value?.updatedAt ? new Date(saved.value.updatedAt).toLocaleString() : null));

onMounted(load);
</script>

<template>
  <div class="ustp-content nav-panel" :class="{ 'nav-panel--dark': $q.dark.isActive }">
    <div>
      <h2 class="text-subtitle1">Who sees which link</h2>
      <div class="text-caption text-grey-7">
        <template v-if="saved?.version">Version {{ saved.version }}, saved {{ savedAt }}.</template>
        <template v-else-if="saved">The defaults: nobody has changed these settings yet.</template>
      </div>
    </div>
    <p>
      Choose which menu links and admin sections each membership state and staff role sees, and the page each starts on
      after signing in. A person sees everything their membership state and each of their roles is given: roles add to
      membership, never take away. This changes what is shown, not what is allowed: the API still checks every
      request, and pages reached by their address still explain themselves.
    </p>

    <q-card v-if="draft && resolved" flat bordered>
      <q-card-section class="ustp-header">
        <div>
          <h3 class="text-subtitle2">The matrix</h3>
          <ul class="nav-legend text-caption">
            <li><span class="nav-check nav-check--sample" aria-hidden="true" data-on></span> Shown</li>
            <li><span class="nav-check nav-check--sample" aria-hidden="true"></span> Hidden</li>
            <template v-if="roleColumns.length">
              <li>
                <span class="nav-fixed" aria-hidden="true">—</span> Not available: each role only gets the admin sections
                the API lets it use
              </li>
              <li>
                <span class="nav-fixed nav-fixed--on" aria-hidden="true">✓</span> Always shown: People and Navigation
                stay with System Admins, and a role's Admin link follows its sections
              </li>
            </template>
          </ul>
        </div>
        <q-btn-toggle
          v-model="columns"
          :options="COLUMN_OPTIONS"
          no-caps
          dense
          unelevated
          toggle-color="primary"
          aria-label="Columns to show"
        />
      </q-card-section>
      <div class="nav-scroll" role="region" aria-labelledby="nav-matrix-caption" tabindex="0">
        <table class="nav-matrix">
          <caption id="nav-matrix-caption" class="sr-only">
            Who sees which link: links and admin sections by membership state and staff role
          </caption>
          <colgroup>
            <col class="nav-matrix__head-col" />
          </colgroup>
          <colgroup v-if="membershipColumns.length" :span="membershipColumns.length" />
          <colgroup v-if="roleColumns.length" :span="roleColumns.length" />
          <thead>
            <tr>
              <td class="nav-sticky"></td>
              <th v-if="membershipColumns.length" scope="colgroup" :colspan="membershipColumns.length" class="nav-group">
                Membership
              </th>
              <th v-if="roleColumns.length" scope="colgroup" :colspan="roleColumns.length" class="nav-group nav-group--staff">
                Staff roles · added to membership
              </th>
            </tr>
            <tr>
              <th scope="col" class="nav-sticky nav-kind">Link</th>
              <th v-for="a in audiences" :key="a" scope="col" class="nav-audience">
                <span class="nav-audience__name">{{ AUDIENCE_LABELS[a] }}</span>
                <span class="nav-caption">{{ AUDIENCE_CAPTIONS[a] }}</span>
              </th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <th scope="rowgroup" :colspan="audiences.length + 1" class="nav-rowgroup"><span class="nav-sticky-inner">Main menu</span></th>
            </tr>
            <tr v-for="l in MENU_LINKS" :key="l">
              <th scope="row" class="nav-sticky nav-item">
                <span class="nav-item__name">{{ MENU_LABELS[l] }}</span>
                <span class="nav-caption">{{ MENU_CAPTIONS[l] }}</span>
              </th>
              <template v-for="run in menuRow(l)" :key="'audience' in run ? run.audience : run.audiences[0]">
                <td v-if="'audience' in run" class="nav-cell">
                  <input
                    v-if="!menuLock(run.audience, l)"
                    v-model="draft.menu[run.audience][l]"
                    type="checkbox"
                    class="nav-check"
                    :aria-label="cellName(l, run.audience, 'link')"
                  />
                  <span
                    v-else
                    class="nav-fixed"
                    :class="{ 'nav-fixed--on': resolved.menu[run.audience][l] }"
                    :title="lockText(menuLock(run.audience, l)!, run.audience, undefined, resolved.menu[run.audience][l])"
                  >
                    <span aria-hidden="true">{{ resolved.menu[run.audience][l] ? '✓' : '—' }}</span>
                    <span class="sr-only">{{ lockText(menuLock(run.audience, l)!, run.audience, undefined, resolved.menu[run.audience][l]) }}</span>
                  </span>
                </td>
                <td v-else :colspan="run.audiences.length" class="nav-merged">
                  <span class="nav-merged__text nav-caption">{{ run.reason }}</span>
                </td>
              </template>
            </tr>
          </tbody>

          <tbody>
            <tr>
              <th id="nav-sections" scope="rowgroup" :colspan="audiences.length + 1" class="nav-rowgroup">
                <span class="nav-sticky-inner">Admin sections</span>
              </th>
            </tr>
            <!-- Membership columns only: nothing here could be switched, so one line says where the sections are. -->
            <tr v-if="!roleColumns.length">
              <td :colspan="audiences.length + 1" class="nav-merged nav-merged--note">
                <span class="nav-merged__text">
                  Admin sections are given to staff roles, never to a membership state alone.
                  <q-btn flat dense no-caps color="primary" label="Switch to Staff roles" @click="showStaffRoles" />
                </span>
              </td>
            </tr>
            <template v-else>
              <tr v-for="(s, i) in ADMIN_SECTIONS" :key="s">
                <th scope="row" class="nav-sticky nav-item">
                  <span class="nav-item__name">{{ SECTION_LABELS[s] }}</span>
                  <span class="nav-caption">{{ SECTION_CAPTIONS[s] }}</span>
                </th>
                <!-- Beside the role columns, the membership columns are one cell for the whole group, saying why once. -->
                <td
                  v-if="i === 0 && membershipColumns.length"
                  :rowspan="ADMIN_SECTIONS.length"
                  :colspan="membershipColumns.length"
                  class="nav-merged nav-merged--block"
                >
                  <span class="nav-merged__text">
                    <span class="nav-item__name">Staff roles only</span>
                    <span class="nav-caption">
                      A membership state alone has no admin sections: each role's are in its column, to the right.
                    </span>
                    <q-btn flat dense no-caps color="primary" label="Switch to Staff roles" align="left" class="q-mt-xs" @click="showStaffRoles" />
                  </span>
                </td>
                <td v-for="a in roleColumns" :key="a" class="nav-cell">
                  <input
                    v-if="!sectionLock(a, s)"
                    v-model="draft.sections[a][s]"
                    type="checkbox"
                    class="nav-check"
                    :aria-label="cellName(s, a, 'section')"
                  />
                  <span
                    v-else
                    class="nav-fixed"
                    :class="{ 'nav-fixed--on': sectionLock(a, s) === 'guarded' }"
                    :title="lockText(sectionLock(a, s)!, a, s)"
                  >
                    <span aria-hidden="true">{{ sectionLock(a, s) === 'guarded' ? '✓' : '—' }}</span>
                    <span class="sr-only">{{ lockText(sectionLock(a, s)!, a, s) }}</span>
                  </span>
                </td>
              </tr>
            </template>
          </tbody>

          <tbody>
            <tr>
              <th scope="rowgroup" :colspan="audiences.length + 1" class="nav-rowgroup"><span class="nav-sticky-inner">After sign-in</span></th>
            </tr>
            <tr>
              <th scope="row" class="nav-sticky nav-item">
                <span class="nav-item__name">Starts on</span>
                <span class="nav-caption">The page that opens first</span>
              </th>
              <td v-for="a in audiences" :key="a" class="nav-cell">
                <span v-if="a === 'signed_out'" class="nav-caption">Public home</span>
                <select
                  v-else
                  class="nav-select"
                  :aria-label="`${AUDIENCE_LABELS[a]} starts on`"
                  :value="resolved.startsOn[a]"
                  @change="setStart(a, $event)"
                >
                  <option v-for="page in pagesOf(a)" :key="page" :value="page">{{ startPageLabel(page) }}</option>
                  <optgroup v-if="sectionsOf(a).length" label="Admin sections">
                    <option v-for="page in sectionsOf(a)" :key="page" :value="page">{{ SECTION_LABELS[page.slice(6) as AdminSection] }}</option>
                  </optgroup>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <q-card-section v-if="changes.length">
        <h3 class="text-subtitle2">Not saved yet: {{ changes.length === 1 ? '1 change' : `${changes.length} changes` }}</h3>
        <ul class="q-mt-sm q-mb-none">
          <li v-for="(c, i) in changes" :key="i">{{ describeChange(c) }}</li>
        </ul>
      </q-card-section>
      <q-card-section v-if="refusal">
        <q-banner class="bg-orange-2 text-black" rounded>Cannot save: {{ refusal }}.</q-banner>
      </q-card-section>
      <q-card-section class="ustp-actions">
        <q-btn color="primary" label="Save changes" :disable="!changes.length || !!refusal" @click="save" />
        <q-btn flat color="primary" label="Discard changes" :disable="!changes.length" @click="load" />
        <q-btn flat color="primary" label="Restore defaults" :disable="isDefault" @click="restoreDefaults" />
      </q-card-section>
    </q-card>
  </div>
</template>

<style scoped>
/* As wide as the page: the matrix has 13 columns. Its text keeps the usual measure. */
.nav-panel {
  max-width: none;
}
.nav-panel > p {
  max-width: 860px;
}
.nav-panel {
  /* The row headers' narrowest width, which they have whenever the table is wider than the card. */
  --nav-head: 11rem;
  --nav-bg: #fff;
  --nav-line: rgba(0, 0, 0, 0.12);
  --nav-off: #757575;
  --nav-strong: #000;
}
.nav-panel--dark {
  --nav-bg: #1d1d1d;
  --nav-line: rgba(255, 255, 255, 0.28);
  --nav-off: #b0b0b0;
  --nav-strong: #fff;
}

.nav-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
.nav-legend li {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.nav-legend :is(.nav-check, .nav-fixed) {
  flex: none;
}
.nav-legend .nav-fixed {
  width: 20px;
  height: 20px;
}

/* The table scrolls sideways inside the card when it is wider than the screen; the row headers stay in view, and a
   control reached with Tab is scrolled clear of them (WCAG 2.4.11). It is a size container, so merged cells' words can
   be kept as narrow as the part of the table in view (cqw). */
.nav-scroll {
  overflow-x: auto;
  scroll-padding-left: calc(var(--nav-head) + 8px);
  container-type: inline-size;
}
.nav-matrix {
  border-collapse: separate;
  border-spacing: 0;
  min-width: 100%;
}
.nav-matrix__head-col {
  width: 14rem;
}
.nav-matrix th,
.nav-matrix td {
  padding: 8px;
  border-bottom: 1px solid var(--nav-line);
  font-weight: normal;
  vertical-align: middle;
}
.nav-sticky,
.nav-sticky-inner {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--nav-bg);
}
.nav-sticky {
  padding-left: 16px !important;
  text-align: left;
}
.nav-group {
  padding: 16px 8px 6px !important;
  border-bottom: 2px solid var(--nav-strong) !important;
  font-size: 12px;
  font-weight: 500 !important;
  letter-spacing: 0.08em;
  text-align: left;
  text-transform: uppercase;
}
.nav-group--staff {
  border-bottom-color: var(--q-primary) !important;
}
.nav-kind,
.nav-rowgroup {
  color: var(--nav-off);
  font-size: 12px;
  font-weight: 500 !important;
  letter-spacing: 0.08em;
  text-align: left;
  text-transform: uppercase;
}
.nav-rowgroup {
  padding: 20px 16px 8px !important;
}
.nav-sticky-inner {
  display: inline-block;
}
.nav-audience {
  min-width: 5.5rem;
  text-align: center;
  vertical-align: bottom !important;
}
.nav-audience__name,
.nav-item__name {
  display: block;
  font-weight: 500;
}
.nav-caption {
  display: block;
  color: var(--nav-off);
  font-size: 12px;
  line-height: 1.3;
}
.nav-item {
  min-width: var(--nav-head);
}
/* Positioned (as the sticky headers are), so a cell's hidden text (absolute, .sr-only) stays inside the scrolling
   table instead of widening the admin panel around it. */
.nav-cell {
  position: relative;
  text-align: center;
}

/* A switchable cell: a filled circle with a tick when shown, an empty one with a dash when hidden (as in the mock-up). */
.nav-check {
  display: inline-grid;
  place-content: center;
  width: 28px;
  height: 28px;
  margin: 0;
  border: 2px solid var(--nav-off);
  border-radius: 50%;
  background: transparent;
  appearance: none;
  cursor: pointer;
  vertical-align: middle;
}
.nav-check::before {
  content: '';
  width: 10px;
  height: 2px;
  background: var(--nav-off);
}
.nav-check:checked,
.nav-check[data-on] {
  border-color: var(--q-primary);
  background: var(--q-primary);
}
.nav-check:checked::before,
.nav-check[data-on]::before {
  width: 14px;
  height: 14px;
  background: #fff;
  clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
}
.nav-check:hover {
  box-shadow: 0 0 0 4px var(--nav-line);
}
.nav-check--sample {
  width: 20px;
  height: 20px;
  cursor: default;
}
.nav-check--sample::before {
  width: 8px;
}
.nav-check--sample[data-on]::before {
  width: 10px;
  height: 10px;
}

/* A fixed cell: no circle, so it does not look like something to press. */
.nav-fixed {
  display: inline-grid;
  place-content: center;
  width: 28px;
  height: 28px;
  color: var(--nav-off);
  font-size: 16px;
}
.nav-fixed--on {
  color: var(--ustp-link);
  font-weight: 700;
}

/* Merged cells (nothing in them can be set): their words start beside the row headers and stay there, in view, while
   the table scrolls under them. The Membership columns' note spans the row header's column too, so it starts at 0. */
.nav-merged {
  text-align: left;
}
.nav-merged--block {
  vertical-align: top !important;
}
.nav-merged--note {
  padding-left: 16px !important;
}
.nav-merged__text {
  position: sticky;
  left: calc(var(--nav-head) + 8px);
  display: block;
  width: fit-content;
  max-width: min(32rem, 100cqw - var(--nav-head) - 16px);
}
.nav-merged--block :deep(.q-btn__content) {
  text-align: left;
}
.nav-merged--note .nav-merged__text {
  left: 16px;
  max-width: calc(100cqw - 32px);
}

.nav-select {
  max-width: 7.5rem;
  padding: 4px;
  border: 1px solid var(--nav-off);
  border-radius: 4px;
  background: var(--nav-bg);
  color: var(--nav-strong);
  font: inherit;
  font-size: 13px;
}

/* Phones: a narrower row header, so more of the matrix shows beside it. */
@media (max-width: 599.98px) {
  .nav-panel {
    --nav-head: 8rem;
  }
  .nav-matrix__head-col {
    width: 9rem;
  }
}
</style>
