<script setup lang="ts">
import { computed } from 'vue';
import { HOUSE_SEATS, nextFederalElectionYear, racePath, raceStateName, US_STATES } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import PageShell from '../components/PageShell.vue';
import { localToday } from './candidacy-text.js';
import { capitalized } from './race-text.js';

/**
 * Every state's races (design §5.17): a link to each state's page, which lists its races for President, the U.S. Senate
 * and the U.S. House and links to each House seat's. Nothing is read to draw it.
 */
usePageTitle('Races');
const year = nextFederalElectionYear(localToday());
const states = computed(() =>
  US_STATES.filter((s) => HOUSE_SEATS[s.code] !== undefined).map((s) => ({
    code: s.code,
    name: capitalized(raceStateName(s.code)),
    to: racePath({ state: s.code, seat: null }),
    seats: HOUSE_SEATS[s.code]!,
  })),
);
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <div>
        <h1 class="text-h5 q-mb-xs">{{ year }} races</h1>
        <div class="text-grey-7">
          Who is running in {{ year }}, and who holds each seat now: every state’s races for
          <template v-if="year % 4 === 0">President, </template>the U.S. Senate and the U.S. House, and each House seat’s,
          from public records, with the Transhumanist Party’s own candidates first. Choose a state.
        </div>
        <q-btn flat no-caps color="primary" icon="travel_explore" label="Look up a ZIP code, for state and local races too" to="/candidates" class="q-mt-xs" />
      </div>
      <nav aria-label="States" class="races-states">
        <router-link v-for="s in states" :key="s.code" :to="s.to" class="races-states__item">
          <span class="text-weight-medium">{{ s.name }}</span>
          <span class="text-caption text-grey-7">{{ s.seats === 1 ? '1 House seat' : `${s.seats} House seats` }}</span>
        </router-link>
      </nav>
    </div>
  </PageShell>
</template>

<style scoped>
.races-states {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
  gap: 8px;
}
.races-states__item {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  border: 1px solid rgba(127, 127, 127, 0.3);
  border-radius: 6px;
  color: inherit;
  text-decoration: none;
}
.races-states__item:hover,
.races-states__item:focus-visible {
  border-color: var(--q-primary);
  background: rgba(127, 127, 127, 0.08);
}
</style>
