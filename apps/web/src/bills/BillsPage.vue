<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  BILL_RECENT_SORTS,
  BILL_SEARCH_SORTS,
  BILL_WATCH_SORTS,
  congressLabel,
  ordinal,
  parseBillReference,
  STAGE_LABELS,
  type BillRecentPage,
  type BillRecentSort,
  type BillRef,
  type BillSearchPage,
  type BillSearchSort,
  type BillWatchEntry,
  type BillWatchSort,
} from 'ustp-domain';
import { announce, focusSoon, usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { billsState } from './access.js';
import { getWatchlist, recentBills, searchBills } from './api.js';
import {
  congressOptions,
  day,
  keySourceText,
  latestActionLine,
  RECENT_SORT_LABELS,
  SEARCH_SORT_LABELS,
  STAGE_OPTIONS,
  STATUS_COLORS,
  statusLabel,
  totalLine,
  TYPE_OPTIONS,
  WATCH_SORT_LABELS,
} from './bill-text.js';

/**
 * The legislative team's Bills page (design §5.14): bills in Congress found by words in their text, number, member,
 * how far they have gone and date, sorted; the latest activity; and the watchlist the team shares. The search is in the
 * address, so a link or the back button keeps it.
 */
usePageTitle('Bills');
const route = useRoute();
const router = useRouter();

const TABS = ['search', 'recent', 'watchlist'] as const;
type Tab = (typeof TABS)[number];
const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);
const tab = computed<Tab>({
  get: () => pick(route.query.tab, TABS, 'search'),
  set: (t) => void router.replace({ query: { ...route.query, tab: t } }),
});

const access = computed(() => billsState.access);
const latest = computed(() => access.value?.currentCongress ?? 119);
const allowed = computed(() => access.value?.allowed === true);
const refused = ref(false);
const congresses = computed(() => congressOptions(latest.value));
const routeLink = (ref: BillRef) => `/bills/${ref.congress}/${ref.type}/${ref.number}`;

/* Go to a bill by number or congress.gov address. */
const goText = ref('');
const goCongress = ref<number | null>(null);
const goError = ref('');
function go() {
  const ref = parseBillReference(goText.value, goCongress.value ?? latest.value, latest.value);
  if (!ref) {
    goError.value = 'Type a bill such as H.R. 10538, S. 12 or H.Res. 5, or paste its congress.gov address.';
    void focusSoon('#bill-go');
    return;
  }
  goError.value = '';
  void router.push(routeLink(ref));
}

/* The search, kept in the address. */
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const form = reactive({
  q: str(route.query.q),
  congress: Number(route.query.congress) || null,
  type: str(route.query.type) || null,
  stage: str(route.query.stage) || null,
  member: str(route.query.member),
  from: str(route.query.from),
  to: str(route.query.to),
  sort: (BILL_SEARCH_SORTS as readonly string[]).includes(str(route.query.sort)) ? (str(route.query.sort) as BillSearchSort) : (null as BillSearchSort | null),
});
const sortOptions = computed(() =>
  BILL_SEARCH_SORTS.map((s) => ({ label: SEARCH_SORT_LABELS[s], value: s, disable: s === 'relevance' && !form.q.trim() })),
);
const results = ref<BillSearchPage | null>(null);
const searching = ref(false);
const searchError = ref('');
/** The cursors of the pages before this one, for Previous. */
const cursors = ref<(string | null)[]>([]);
const cursor = ref<string | null>(null);

function searchQuery() {
  return {
    q: form.q.trim() || undefined,
    congress: form.congress ?? undefined,
    type: form.type,
    stage: form.stage,
    member: form.member.trim() || undefined,
    from: form.from || undefined,
    to: form.to || undefined,
    sort: form.sort === 'relevance' && !form.q.trim() ? null : form.sort,
  };
}

async function runSearch(at: string | null = null) {
  searching.value = true;
  searchError.value = '';
  try {
    const page = await searchBills({ ...searchQuery(), cursor: at });
    results.value = page;
    cursor.value = at;
    announce(totalLine(page.total, page.hits.length));
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) refused.value = true;
    searchError.value = errorMessage(e);
  } finally {
    searching.value = false;
  }
}

function submitSearch() {
  const q = searchQuery();
  void router.replace({
    query: {
      tab: 'search',
      ...Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])),
    },
  });
  cursors.value = [];
  void runSearch(null);
}

function nextPage() {
  if (!results.value?.next) return;
  cursors.value = [...cursors.value, cursor.value];
  void runSearch(results.value.next).then(() => focusSoon('#bill-results'));
}

function previousPage() {
  const back = cursors.value.at(-1);
  if (back === undefined) return;
  cursors.value = cursors.value.slice(0, -1);
  void runSearch(back).then(() => focusSoon('#bill-results'));
}

function clearSearch() {
  Object.assign(form, { q: '', congress: null, type: null, stage: null, member: '', from: '', to: '', sort: null });
  results.value = null;
  cursors.value = [];
  void router.replace({ query: { tab: 'search' } });
}

/* Latest activity. */
const recentForm = reactive({ congress: null as number | null, type: null as string | null, from: '', to: '', sort: 'updated' as BillRecentSort });
const recent = ref<BillRecentPage | null>(null);
const recentPage = ref(1);
const recentLoading = ref(false);
const recentError = ref('');
async function loadRecent(page = 1) {
  recentLoading.value = true;
  recentError.value = '';
  try {
    recent.value = await recentBills({
      congress: recentForm.congress ?? undefined,
      type: recentForm.type,
      from: recentForm.from || undefined,
      to: recentForm.to || undefined,
      sort: recentForm.sort,
      page,
    });
    recentPage.value = page;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) refused.value = true;
    recentError.value = errorMessage(e);
  } finally {
    recentLoading.value = false;
  }
}

/* The watchlist. */
const watchSort = ref<BillWatchSort>('latest_action');
const watchTag = ref<string | null>(null);
const watchlist = ref<BillWatchEntry[] | null>(null);
const watchError = ref('');
const allTags = ref<string[]>([]);
async function loadWatchlist() {
  watchError.value = '';
  try {
    const list = await getWatchlist(watchSort.value, watchTag.value);
    watchlist.value = list;
    if (!watchTag.value) {
      const seen = new Map<string, string>();
      for (const e of list) for (const t of e.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
      allTags.value = [...seen.values()].sort((a, b) => a.localeCompare(b));
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) refused.value = true;
    watchError.value = errorMessage(e);
  }
}
watch([watchSort, watchTag], () => void loadWatchlist());

const loadedTabs = new Set<Tab>();
function openTab(t: Tab) {
  if (loadedTabs.has(t) || !allowed.value) return;
  loadedTabs.add(t);
  if (t === 'recent') void loadRecent(1);
  if (t === 'watchlist') void loadWatchlist();
  if (t === 'search' && Object.keys(route.query).some((k) => k !== 'tab')) void runSearch(null);
}
watch([tab, allowed], () => openTab(tab.value));
onMounted(() => openTab(tab.value));

const recentSortOptions = BILL_RECENT_SORTS.map((s) => ({ label: RECENT_SORT_LABELS[s], value: s }));
const watchSortOptions = BILL_WATCH_SORTS.map((s) => ({ label: WATCH_SORT_LABELS[s], value: s }));
const tagOptions = computed(() => allTags.value.map((t) => ({ label: t, value: t })));
const versionsLine = (others: readonly string[]) => (others.length ? `Also on this page: ${others.map((v) => v.toUpperCase()).join(', ')}` : '');
const stageChip = (stage: string | null) => (stage ? STAGE_LABELS[stage as keyof typeof STAGE_LABELS] : null);
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <div>
        <h1 class="text-h5 q-mb-xs">Bills in Congress</h1>
        <div class="text-grey-7">
          Find bills in Congress by words in their text, by number, by a member who sponsored or cosponsored them, by how
          far they have gone or by date. Open one for its actions, summary and text, and keep it on the team's watchlist.
        </div>
      </div>

      <div v-if="!billsState.loadedFor" class="text-grey-7">Loading…</div>
      <q-banner v-else-if="!allowed || refused" class="bg-blue-1 text-black" rounded>
        The Bills page is for the party's legislative team: the teams a System or Site Admin names under Admin › Bills, and
        System and Site Admins. To use it, ask a lead of the legislative team to add you.
      </q-banner>

      <template v-else>
        <form class="ustp-row bill-go" novalidate role="search" aria-label="Go to a bill" @submit.prevent="go">
          <q-input
            id="bill-go"
            v-model="goText"
            class="ustp-row__wide"
            outlined
            dense
            label="Go to a bill"
            hint="H.R. 10538, S. 12, H.Res. 5, or a congress.gov address"
            :error="!!goError"
            :error-message="goError"
            autocomplete="off"
          />
          <q-select
            v-model="goCongress"
            outlined
            dense
            emit-value
            map-options
            :options="congresses"
            :label="goCongress ? 'Congress' : `Congress: the ${ordinal(latest)}`"
            clearable
          />
          <q-btn type="submit" color="primary" no-caps label="Open" />
        </form>

        <q-tabs v-model="tab" dense align="left" no-caps active-color="primary" indicator-color="primary" class="text-grey-8">
          <q-tab name="search" label="Search" />
          <q-tab name="recent" label="Latest activity" />
          <q-tab name="watchlist" :label="watchlist ? `Watchlist (${watchlist.length})` : 'Watchlist'" />
        </q-tabs>

        <!-- Search -->
        <section v-if="tab === 'search'" class="ustp-stack" aria-label="Search">
          <form class="ustp-form" novalidate @submit.prevent="submitSearch">
            <q-input v-model="form.q" outlined dense label="Words in the text" hint="A phrase in double quotes, as “artificial superintelligence”" />
            <div class="ustp-row">
              <q-select v-model="form.congress" outlined dense emit-value map-options clearable :options="congresses" :label="form.congress ? 'Congress' : `Congress: the ${ordinal(latest)}`" />
              <q-select v-model="form.type" outlined dense emit-value map-options :options="TYPE_OPTIONS" label="Type" />
              <q-select v-model="form.stage" outlined dense emit-value map-options :options="STAGE_OPTIONS" label="How far it has gone" />
            </div>
            <div class="ustp-row">
              <q-input v-model="form.member" outlined dense label="Member's last name" hint="Sponsor or cosponsor" autocomplete="off" />
              <q-input v-model="form.from" outlined dense type="date" label="Text published from" stack-label />
              <q-input v-model="form.to" outlined dense type="date" label="to" stack-label />
              <q-select
                v-model="form.sort"
                outlined
                dense
                emit-value
                map-options
                :options="sortOptions"
                :label="form.sort ? 'Sort' : form.q.trim() ? 'Sort: best match' : 'Sort: newest first'"
              />
            </div>
            <div class="ustp-actions">
              <q-btn type="submit" color="primary" no-caps label="Search" :loading="searching" />
              <q-btn flat no-caps label="Clear" @click="clearSearch" />
            </div>
          </form>

          <q-banner v-if="searchError" class="bg-orange-1 text-black" rounded>{{ searchError }}</q-banner>
          <div v-else-if="searching && !results" class="text-grey-7">Searching GovInfo…</div>
          <div v-if="results" id="bill-results" tabindex="-1" class="ustp-stack">
            <p class="text-grey-8">{{ totalLine(results.total, results.hits.length) }}</p>
            <p v-if="results.hits.length" class="text-caption text-grey-7">
              GovInfo lists each printed version of a bill, so a bill whose versions fall on different pages shows again later.
            </p>
            <q-list bordered separator class="rounded-borders">
              <q-item v-for="hit in results.hits" :key="hit.id" :to="routeLink(hit)" class="bill-item">
                <q-item-section>
                  <q-item-label class="bill-item__title">
                    <strong>{{ hit.label }}</strong> · {{ hit.title }}
                  </q-item-label>
                  <q-item-label caption>
                    {{ congressLabel(hit.congress) }} · {{ hit.chamber ?? '' }} · {{ hit.versionLabel }}<template v-if="hit.date">, {{ day(hit.date) }}</template>
                  </q-item-label>
                  <q-item-label v-if="hit.otherVersions.length" caption>{{ versionsLine(hit.otherVersions) }}</q-item-label>
                </q-item-section>
                <q-item-section v-if="stageChip(hit.stage)" side top>
                  <q-chip dense square :label="stageChip(hit.stage)!" />
                </q-item-section>
              </q-item>
            </q-list>
            <div class="ustp-actions">
              <q-btn v-if="cursors.length" outline no-caps icon="chevron_left" label="Previous page" :disable="searching" @click="previousPage" />
              <q-btn v-if="results.next" outline no-caps icon-right="chevron_right" label="Next page" :disable="searching" @click="nextPage" />
            </div>
          </div>
        </section>

        <!-- Latest activity -->
        <section v-else-if="tab === 'recent'" class="ustp-stack" aria-label="Latest activity">
          <form class="ustp-form" novalidate @submit.prevent="loadRecent(1)">
            <div class="ustp-row">
              <q-select v-model="recentForm.congress" outlined dense emit-value map-options clearable :options="congresses" :label="recentForm.congress ? 'Congress' : `Congress: the ${ordinal(latest)}`" />
              <q-select v-model="recentForm.type" outlined dense emit-value map-options :options="TYPE_OPTIONS" label="Type" />
              <q-select
                v-model="recentForm.sort"
                outlined
                dense
                emit-value
                map-options
                :options="recentSortOptions"
                label="Sort"
              />
            </div>
            <div class="ustp-row">
              <q-input v-model="recentForm.from" outlined dense type="date" label="Updated from" stack-label />
              <q-input v-model="recentForm.to" outlined dense type="date" label="to" stack-label />
              <q-btn type="submit" color="primary" no-caps label="Show" :loading="recentLoading" />
            </div>
          </form>
          <q-banner v-if="recentError" class="bg-orange-1 text-black" rounded>{{ recentError }}</q-banner>
          <div v-else-if="recentLoading && !recent" class="text-grey-7">Loading the latest activity from Congress.gov…</div>
          <template v-if="recent">
            <p class="text-grey-8">{{ recent.total.toLocaleString('en-US') }} bills in the {{ congressLabel(recent.congress) }} match. Page {{ recent.page }}.</p>
            <q-list bordered separator class="rounded-borders">
              <q-item v-for="item in recent.items" :key="item.id" :to="routeLink(item)" class="bill-item">
                <q-item-section>
                  <q-item-label class="bill-item__title"><strong>{{ item.label }}</strong> · {{ item.title }}</q-item-label>
                  <q-item-label caption>{{ latestActionLine(item.latestAction) }}</q-item-label>
                </q-item-section>
                <q-item-section side top class="text-caption text-grey-7">Updated {{ day(item.updatedAt) }}</q-item-section>
              </q-item>
            </q-list>
            <div class="ustp-actions">
              <q-btn v-if="recentPage > 1" outline no-caps icon="chevron_left" label="Previous page" :disable="recentLoading" @click="loadRecent(recentPage - 1)" />
              <q-btn v-if="recent.hasMore" outline no-caps icon-right="chevron_right" label="Next page" :disable="recentLoading" @click="loadRecent(recentPage + 1)" />
            </div>
          </template>
        </section>

        <!-- Watchlist -->
        <section v-else class="ustp-stack" aria-label="Watchlist">
          <div class="ustp-toolbar">
            <q-select
              v-model="watchSort"
              outlined
              dense
              emit-value
              map-options
              :options="watchSortOptions"
              label="Sort"
            />
            <q-select v-model="watchTag" outlined dense emit-value map-options clearable :options="tagOptions" label="Tag" />
          </div>
          <q-banner v-if="watchError" class="bg-orange-1 text-black" rounded>{{ watchError }}</q-banner>
          <div v-else-if="!watchlist" class="text-grey-7">Loading…</div>
          <p v-else-if="watchlist.length === 0" class="text-grey-7">
            {{ watchTag ? 'No bill on the watchlist has this tag.' : 'The watchlist is empty. Open a bill and add it, with tags, for the whole team.' }}
          </p>
          <q-list v-else bordered separator class="rounded-borders">
            <q-item v-for="e in watchlist" :key="e.billId" :to="routeLink(e)" class="bill-item">
              <q-item-section>
                <q-item-label class="bill-item__title"><strong>{{ e.label }}</strong> · {{ e.title }}</q-item-label>
                <q-item-label caption>{{ congressLabel(e.congress) }}<template v-if="e.sponsor"> · {{ e.sponsor }}</template></q-item-label>
                <q-item-label caption>{{ latestActionLine(e.latestAction) }}</q-item-label>
                <q-item-label v-if="e.stale" caption class="text-orange-10">Congress.gov could not be reached; as read {{ day(e.checkedAt) }}.</q-item-label>
                <div class="bill-tags">
                  <q-chip v-for="t in e.tags" :key="t" dense size="sm" color="primary" text-color="white" :label="t" />
                  <q-chip v-if="e.notes" dense size="sm" icon="sticky_note_2" :label="e.notes === 1 ? '1 note' : `${e.notes} notes`" />
                  <q-chip v-if="e.public" dense size="sm" icon="public" color="teal-9" text-color="white" label="On the Legislation page" />
                </div>
              </q-item-section>
              <q-item-section side top>
                <q-chip dense square :color="STATUS_COLORS[e.status]" text-color="white" :label="statusLabel(e.status)" />
              </q-item-section>
            </q-item>
          </q-list>
        </section>

        <p v-if="access?.keySource" class="text-caption text-grey-7">
          Data retrieved from <a href="https://www.congress.gov/" target="_blank" rel="noopener noreferrer">Congress.gov</a> and
          <a href="https://www.govinfo.gov/" target="_blank" rel="noopener noreferrer">GovInfo</a>.
          {{ keySourceText(access.keySource) }}
        </p>
      </template>
    </div>
  </PageShell>
</template>

<style scoped>
.bill-item__title {
  line-height: 1.4;
}
.bill-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.bill-tags .q-chip {
  margin: 0;
}
</style>
