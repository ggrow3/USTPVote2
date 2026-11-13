<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { absoluteUrl, CHAMBER_LABELS, memberLabel, memberPlace, type ScorecardRow, type ScorecardView } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import ShareButtons from '../communications/ShareButtons.vue';
import PageShell from '../components/PageShell.vue';
import { publicScorecard } from './api.js';
import LegislationNav from './LegislationNav.vue';
import { filterRows, scoreColor, scorePercent } from './legislation-text.js';

/**
 * The scorecard (design §5.14, "Legislation and the scorecard"): every member of Congress in a roll call the party
 * took a position on, on the bills on the Legislation page, with how often they voted with it and how many they missed.
 */
usePageTitle('Scorecard');
const route = useRoute();
const card = ref<ScorecardView | null>(null);
const error = ref<string | null>(null);
const words = ref('');
const state = ref<string | null>(null);
const chamber = ref<'house' | 'senate' | null>(route.query.chamber === 'house' || route.query.chamber === 'senate' ? route.query.chamber : null);

onMounted(async () => {
  try {
    card.value = await publicScorecard();
  } catch (e) {
    error.value = errorMessage(e);
  }
});

const states = computed(() => [...new Set((card.value?.rows ?? []).map((r) => r.state))].sort());
const rows = computed(() => filterRows(card.value?.rows ?? [], words.value, state.value, chamber.value));

const columns = [
  { name: 'member', label: 'Member', field: (r: ScorecardRow) => r.name, align: 'left' as const, sortable: true },
  { name: 'place', label: 'Seat', field: (r: ScorecardRow) => `${CHAMBER_LABELS[r.chamber]} ${memberPlace(r)}`, align: 'left' as const, sortable: true },
  { name: 'party', label: 'Party', field: (r: ScorecardRow) => r.party ?? '', align: 'left' as const, sortable: true },
  {
    name: 'score',
    label: 'With the party',
    field: (r: ScorecardRow) => r.score,
    align: 'right' as const,
    sortable: true,
    sort: (a: number | null, b: number | null) => (a ?? -1) - (b ?? -1),
  },
  { name: 'with', label: 'With', field: 'with', align: 'right' as const, sortable: true },
  { name: 'against', label: 'Against', field: 'against', align: 'right' as const, sortable: true },
  { name: 'missed', label: 'Missed', field: 'missed', align: 'right' as const, sortable: true },
];

const page = computed(() => ({
  text: 'How each member of Congress voted on the science, AI and longevity bills the U.S. Transhumanist Party follows.',
  url: absoluteUrl('/scorecard', location.origin),
  hashtags: [],
  title: 'Congress scorecard: science, AI and longevity',
}));
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <LegislationNav />
      <div>
        <h1 class="text-h5 q-mb-xs">Congress scorecard: science, AI and longevity</h1>
        <p class="text-grey-7 q-mb-xs">
          How each member of Congress voted on the roll calls the party took a position on, on
          <router-link to="/legislation">the bills it follows</router-link>. A member's score is the share of their yeas and nays
          that went the party's way; votes they missed, or answered only Present, are counted apart and do not lower it.
        </p>
        <p v-if="card" class="text-caption text-grey-7 q-mb-none">
          {{ card.votes === 1 ? '1 roll call' : `${card.votes} roll calls` }} scored on {{ card.bills === 1 ? '1 bill' : `${card.bills} bills` }}.
        </p>
      </div>

      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!card" class="text-grey-7">Loading…</div>
      <p v-else-if="card.rows.length === 0" class="text-grey-7">
        No roll call on the party's bills has been scored yet. The legislative team marks the party's position on each vote as it
        happens.
      </p>
      <template v-else>
        <div class="ustp-toolbar">
          <q-input v-model="words" outlined dense clearable type="search" label="Find a member by name" class="scorecard-search" />
          <q-select v-model="state" outlined dense clearable :options="states" label="State" class="ustp-field--short" />
          <q-select
            v-model="chamber"
            outlined
            dense
            emit-value
            map-options
            :options="[
              { label: 'Both chambers', value: null },
              { label: 'House', value: 'house' },
              { label: 'Senate', value: 'senate' },
            ]"
            label="Chamber"
            class="scorecard-chamber"
          />
        </div>
        <q-table
          flat
          bordered
          :rows="rows"
          :columns="columns"
          row-key="memberId"
          :pagination="{ rowsPerPage: 50, sortBy: null }"
          :rows-per-page-options="[25, 50, 100, 0]"
          no-data-label="No member matches."
          title="Members of Congress"
        >
          <template #body-cell-member="props">
            <q-td :props="props">
              <router-link :to="`/scorecard/${props.row.memberId}`">{{ memberLabel(props.row) }}</router-link>
            </q-td>
          </template>
          <template #body-cell-score="props">
            <q-td :props="props">
              <span :class="`text-${scoreColor(props.row.score)} text-weight-bold`">{{ scorePercent(props.row.score) }}</span>
            </q-td>
          </template>
        </q-table>
      </template>

      <q-separator />
      <div>
        <h2 class="text-subtitle1">Share the scorecard</h2>
        <ShareButtons :item="page" />
      </div>
      <p class="text-caption text-grey-7">
        Members' votes from the Clerk of the House by way of
        <a href="https://www.congress.gov/" target="_blank" rel="noopener noreferrer">Congress.gov</a>, and from the
        <a href="https://www.senate.gov/legislative/votes_new.htm" target="_blank" rel="noopener noreferrer">Senate</a>; the
        party's positions marked by its legislative team.
      </p>
    </div>
  </PageShell>
</template>

<style scoped>
.scorecard-search {
  flex: 1 1 16rem;
}
.scorecard-chamber {
  min-width: 11rem;
}
</style>
