<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { PAGE_VISIT_LOG_MAX, PAGE_VISIT_PERIODS, PAGE_VISIT_RETENTION_DAYS, PAGE_VISITS_UNTRACKED, type PageVisitReport } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { pageVisitReport } from './api.js';
import {
  dailyHits,
  filterPages,
  pageLabel,
  people,
  personLabel,
  visitorsOf,
  visitsCsv,
  visitsCsvFileName,
  visitTotals,
} from './page-visits.js';
import VisitsChart from './VisitsChart.vue';
import VisitSourcesView from './VisitSourcesView.vue';

/**
 * Page visits (design §10.7): hits per page over time and who opened each page, and where visitors came from, for System
 * Admins and Auditors.
 */

const days = ref<number>(30);
const report = ref<PageVisitReport | null>(null);
const loading = ref(false);
const search = ref('');
const view = ref<'pages' | 'people' | 'sources'>('pages');
/** The page whose visitors are listed and charted; null charts every page. */
const selected = ref<string | null>(null);

const periodOptions = PAGE_VISIT_PERIODS.map((d) => ({ value: d, label: d === 1 ? 'Today (UTC)' : `Last ${d} days` }));
const pages = computed(() => (report.value ? filterPages(report.value, search.value) : []));
const totals = computed(() => (report.value ? visitTotals(report.value) : null));
const selectedPage = computed(() => report.value?.pages.find((p) => p.page === selected.value) ?? null);
const chartDays = computed(() =>
  report.value ? dailyHits(report.value.dayList, selectedPage.value ? [selectedPage.value] : report.value.pages) : [],
);
const visitors = computed(() => (report.value && selected.value ? visitorsOf(report.value, selected.value, search.value) : []));
const everyone = computed(() => (report.value ? people(report.value, search.value) : []));

async function load() {
  loading.value = true;
  await attempt(async () => {
    report.value = await pageVisitReport(days.value);
    if (selected.value && !report.value.pages.some((p) => p.page === selected.value)) selected.value = null;
  });
  loading.value = false;
}
watch(days, load);
onMounted(load);

function select(page: string) {
  selected.value = selected.value === page ? null : page;
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;
const when = (iso: string) => new Date(iso).toLocaleString();

function exportCsv() {
  if (!report.value) return;
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob(['﻿', visitsCsv(report.value)], { type: 'text/csv;charset=utf-8' }));
  link.href = url;
  link.download = visitsCsvFileName(new Date());
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <section class="ustp-content" aria-labelledby="page-visits-title">
    <div>
      <h2 id="page-visits-title" class="text-subtitle1">Page visits</h2>
      <div class="text-caption text-grey-7">
        Names kept {{ PAGE_VISIT_RETENTION_DAYS }} days, then deleted; counts kept. Never in the ledger.
      </div>
    </div>
    <p>
      Each page of the app is counted as it is opened, except {{ PAGE_VISITS_UNTRACKED.join(' and ') }} and the pages
      under them, so no visit sits beside a ballot. A visit by someone signed in is recorded with their account; someone
      signed out is only counted, and no address, cookie or device of theirs is kept. Anyone can reload a page, so hits
      are a guide, not a record. Days are UTC days.
    </p>

    <div class="row q-col-gutter-sm items-end">
      <div class="col-12 col-sm-4">
        <q-select v-model="days" :options="periodOptions" emit-value map-options outlined dense label="Period" />
      </div>
      <div class="col-12 col-sm-5">
        <q-input v-model="search" outlined dense clearable label="Search pages, names or emails" />
      </div>
      <div class="col-12 col-sm-3 row q-gutter-sm justify-end">
        <q-btn flat round icon="refresh" aria-label="Reload the page visits" :loading="loading" @click="load" />
        <q-btn outline no-caps icon="file_download" :disable="!report?.visitors.length" @click="exportCsv">Export CSV</q-btn>
      </div>
    </div>

    <div v-if="totals" class="row q-gutter-md text-body2" role="status">
      <span>{{ plural(totals.hits, 'hit') }}</span>
      <span>{{ totals.signedIn }} signed in</span>
      <span>{{ totals.signedOut }} signed out</span>
      <span>{{ totals.people === 1 ? '1 person' : `${totals.people} people` }}</span>
    </div>
    <q-banner v-if="report?.truncated" class="bg-orange-2 text-black" rounded>
      More than {{ PAGE_VISIT_LOG_MAX }} visits by people signed in during this period: the oldest are left out of who
      visited, though hits are complete. Pick a shorter period.
    </q-banner>

    <q-card v-if="report" flat bordered>
      <q-card-section>
        <VisitsChart :days="chartDays" :title="selectedPage ? `Hits per day: ${selectedPage.label}` : 'Hits per day: every page'" />
      </q-card-section>
    </q-card>

    <q-btn-toggle
      v-if="report"
      v-model="view"
      no-caps
      unelevated
      toggle-color="primary"
      :options="[
        { label: 'By page', value: 'pages' },
        { label: 'By person', value: 'people' },
        { label: 'Where from', value: 'sources' },
      ]"
      aria-label="Show the visits by page, by person, or where visitors came from"
    />

    <VisitSourcesView v-if="report?.sources && view === 'sources'" :sources="report.sources" />

    <template v-if="report && view === 'pages'">
      <q-markup-table flat bordered dense wrap-cells class="visits">
        <caption class="sr-only">Pages, busiest first. Pick a page to chart it and see who opened it.</caption>
        <thead>
          <tr>
            <th scope="col" class="text-left">Page</th>
            <th scope="col" class="text-right">Hits</th>
            <th scope="col" class="text-right">Signed in</th>
            <th scope="col" class="text-right">Signed out</th>
            <th scope="col" class="text-right">People</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in pages" :key="p.page" :class="{ 'visits__selected': selected === p.page }">
            <td>
              <q-btn
                flat
                dense
                no-caps
                align="left"
                class="text-left"
                :aria-pressed="selected === p.page"
                :label="p.label"
                @click="select(p.page)"
              />
              <div v-if="p.pattern" class="text-caption text-grey-7"><code>{{ p.pattern }}</code></div>
            </td>
            <td class="text-right">{{ p.hits }}</td>
            <td class="text-right">{{ p.signedIn }}</td>
            <td class="text-right">{{ p.hits - p.signedIn }}</td>
            <td class="text-right">{{ p.visitors }}</td>
          </tr>
          <tr v-if="!pages.length">
            <td colspan="5" class="text-grey-7">No visits {{ search ? 'match the search' : 'in this period' }}.</td>
          </tr>
        </tbody>
      </q-markup-table>

      <div v-if="selectedPage" class="ustp-content">
        <h3 class="text-subtitle2 q-my-none">Who opened {{ selectedPage.label }}</h3>
        <q-markup-table flat bordered dense wrap-cells class="visits">
          <caption class="sr-only">People signed in who opened {{ selectedPage.label }}, most visits first</caption>
          <thead>
            <tr>
              <th scope="col" class="text-left">Person</th>
              <th scope="col" class="text-right">Visits</th>
              <th scope="col" class="text-left">Last visit</th>
              <th v-if="selectedPage.pattern.includes(':')" scope="col" class="text-left">Which</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in visitors" :key="v.accountId">
              <td>
                {{ personLabel(v) }}
                <div v-if="v.name && v.email" class="text-caption text-grey-7">{{ v.email }}</div>
              </td>
              <td class="text-right">{{ v.visits }}</td>
              <td>{{ when(v.lastAt) }}</td>
              <td v-if="selectedPage.pattern.includes(':')">
                <div v-for="path in v.paths" :key="path.path">
                  <router-link :to="path.path">{{ path.path }}</router-link>
                  <span v-if="path.visits > 1" class="text-grey-7"> ×{{ path.visits }}</span>
                </div>
              </td>
            </tr>
            <tr v-if="!visitors.length">
              <td :colspan="selectedPage.pattern.includes(':') ? 4 : 3" class="text-grey-7">
                Only people signed out opened it in this period.
              </td>
            </tr>
          </tbody>
        </q-markup-table>
      </div>
    </template>

    <q-markup-table v-if="report && view === 'people'" flat bordered dense wrap-cells class="visits">
      <caption class="sr-only">People signed in who opened pages, most visits first</caption>
      <thead>
        <tr>
          <th scope="col" class="text-left">Person</th>
          <th scope="col" class="text-right">Visits</th>
          <th scope="col" class="text-left">Pages</th>
          <th scope="col" class="text-left">Last visit</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="person in everyone" :key="person.accountId">
          <td>
            {{ personLabel(person) }}
            <div v-if="person.name && person.email" class="text-caption text-grey-7">{{ person.email }}</div>
          </td>
          <td class="text-right">{{ person.visits }}</td>
          <td>
            <span v-for="(r, i) in person.pages" :key="r.page">{{ i ? ', ' : '' }}{{ pageLabel(r.page) }} ×{{ r.visits }}</span>
          </td>
          <td>{{ when(person.lastAt) }}</td>
        </tr>
        <tr v-if="!everyone.length">
          <td colspan="4" class="text-grey-7">Nobody signed in {{ search ? 'matches the search' : 'opened a page in this period' }}.</td>
        </tr>
      </tbody>
    </q-markup-table>
  </section>
</template>

<style scoped>
.visits {
  max-height: 70vh;
  overflow: auto;
}
.visits code {
  font-size: 0.9em;
}
.visits__selected {
  background: rgba(189, 78, 0, 0.08);
}
</style>
