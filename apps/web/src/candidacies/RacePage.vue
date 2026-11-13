<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { personMarks, raceGroups, seatName, STATE_FIPS, type AreaContact, type RaceView } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import ShareButtons from '../communications/ShareButtons.vue';
import PageShell from '../components/PageShell.vue';
import { raceView } from './api.js';
import { feedNote, profilesNote } from './candidacy-text.js';
import DistrictMap from './DistrictMap.vue';
import DistrictOutline from './DistrictOutline.vue';
import { mapsRefused } from './maps.js';
import OfficeGrid from './OfficeGrid.vue';
import PartyCandidates from './PartyCandidates.vue';
import { capitalized, checkedText, raceCredit, raceCrumbs, raceShareable, seatSummaryText, stateOffices } from './race-text.js';

/**
 * A race page (design §5.17), for everyone and listed in search: a state's races (President, the U.S. Senate, in
 * California the statewide offices, and every House seat, each linking to its own page) or one House seat's, with the
 * Transhumanist Party's own candidates first, then who holds the seats now and who runs, from public records.
 */
const route = useRoute();
const view = ref<RaceView | null>(null);
const error = ref<string | null>(null);
const missing = ref(false);
usePageTitle(() => view.value?.title ?? 'Races');

const place = computed(() => {
  const v = view.value;
  return v ? { state: v.state, seat: v.seat } : null;
});
const heading = computed(() => {
  const v = view.value;
  if (!v || !place.value) return '';
  const statewide = v.candidates.some((c) => c.office === 'statewide');
  return v.seat === null ? `The races for ${stateOffices(v.state, v.electionYear, statewide)}.` : `${capitalized(seatName(place.value))}.`;
});
const crumbs = computed(() => {
  const v = view.value;
  if (!v) return [];
  return raceCrumbs(v.state, v.seat === null ? null : { code: v.code, path: route.path });
});
const holderGroups = computed(() => (view.value ? raceGroups(view.value, 'holders') : []));
const runningGroups = computed(() => (view.value ? raceGroups(view.value, 'candidates') : []));
const marks = (p: AreaContact) => personMarks(p, [], view.value?.party ?? []);
const notes = computed(() => {
  const v = view.value;
  if (!v) return [];
  return [feedNote('fec', v.feeds.fec), feedNote('congress', v.feeds.congress), feedNote('sos', v.feeds.sos), profilesNote(v.profiles)].filter((n): n is string => n !== null);
});
const outline = computed(() => {
  const v = view.value;
  if (!v) return null;
  return v.seat === null ? { kind: 'state' as const, geoid: STATE_FIPS[v.state] ?? v.state } : { kind: 'congressional' as const, geoid: v.district?.geoid ?? '' };
});
const mapLabel = computed(() => (place.value ? `Map of ${seatName(place.value)}` : 'Map'));
const mapShown = ref(false);
const shareable = computed(() => (view.value ? raceShareable(view.value) : null));

watch(
  () => [route.params.state, route.params.district] as const,
  async ([state, district]) => {
    view.value = null;
    error.value = null;
    missing.value = false;
    mapShown.value = false;
    try {
      view.value = await raceView(String(state), district === undefined ? undefined : String(district));
    } catch (e) {
      missing.value = e instanceof ApiError && e.status === 404;
      error.value = errorMessage(e);
    }
  },
  { immediate: true },
);
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <nav v-if="crumbs.length" aria-label="Breadcrumbs" class="race-crumbs">
        <template v-for="(c, i) in crumbs" :key="c.to">
          <span v-if="i" aria-hidden="true" class="text-grey-6">›</span>
          <router-link v-if="i < crumbs.length - 1" :to="c.to">{{ c.label }}</router-link>
          <span v-else aria-current="page">{{ c.label }}</span>
        </template>
      </nav>
      <div v-else><router-link to="/races">← Every state’s races</router-link></div>

      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>
        {{ missing ? 'There is no race page at this address.' : error }}
        <template v-if="missing" #action><q-btn flat no-caps color="primary" label="Every state’s races" to="/races" /></template>
      </q-banner>
      <div v-else-if="!view" class="text-grey-7">Loading…</div>
      <template v-else>
        <div>
          <h1 class="text-h5 q-mb-xs">{{ view.title }}</h1>
          <div class="text-grey-7">
            {{ heading }} Who runs and who holds {{ view.seat === null ? 'the seats' : 'the seat' }} now, from public records, with the Transhumanist
            Party’s own candidates first.
          </div>
        </div>

        <div class="race-map">
          <DistrictMap v-if="outline && outline.geoid" optional :outline="outline" :label="mapLabel" height="280px" @ready="mapShown = true" />
          <div v-if="outline && outline.geoid && (!mapShown || mapsRefused)" class="race-map__outline">
            <DistrictOutline :district="outline" :size="180" />
          </div>
        </div>

        <div v-if="shareable">
          <div class="text-caption text-grey-7 q-mb-xs">Share this page</div>
          <ShareButtons :item="shareable" />
        </div>

        <q-banner v-for="n in notes" :key="n" dense rounded class="bg-grey-3 text-black">{{ n }}</q-banner>

        <section aria-labelledby="race-party-heading">
          <h2 id="race-party-heading" class="text-h6 q-mb-xs">Transhumanist Party candidates</h2>
          <div v-if="!view.party.length" class="text-grey-7">
            No Transhumanist Party candidate here yet.
            <router-link to="/candidates">Every party candidate</router-link> ·
            <router-link to="/register">Join the party</router-link>
          </div>
          <template v-else>
            <div class="text-grey-7 q-mb-sm">Members of the party running here. A Membership Admin reviews each candidacy; being listed is not an endorsement.</div>
            <PartyCandidates :candidacies="view.party" />
          </template>
        </section>

        <section aria-labelledby="race-holders-heading">
          <h2 id="race-holders-heading" class="text-h6 q-mb-xs">{{ view.seat === null ? 'Who holds the seats now' : 'Who holds the seat now' }}</h2>
          <OfficeGrid :groups="holderGroups" part="holders" every :election-year="view.electionYear" :not-up="view.notUp" :marks="marks" :mappable="() => false" />
        </section>

        <section aria-labelledby="race-running-heading">
          <h2 id="race-running-heading" class="text-h6 q-mb-xs">Who is running in {{ view.electionYear }}</h2>
          <div class="text-grey-7 q-mb-sm">
            From public records: candidates who have filed with the FEC and reported raising money<template v-if="view.feeds.sos === 'ok'">, and
            California’s list of who is on its ballot</template>. None of them has been reviewed or endorsed by the party. Choose a person’s
            <q-icon name="badge" size="16px" aria-label="page" /> for their own page.
          </div>
          <OfficeGrid :groups="runningGroups" part="candidates" every :election-year="view.electionYear" :not-up="view.notUp" :marks="marks" :mappable="() => false" />
        </section>

        <section v-if="view.seats.length" aria-labelledby="race-seats-heading">
          <h2 id="race-seats-heading" class="text-h6 q-mb-xs">{{ view.seats.length === 1 ? 'The House seat' : `The ${view.seats.length} House seats` }}</h2>
          <q-list bordered separator class="rounded-borders">
            <q-item v-for="s in view.seats" :key="s.code" clickable :to="s.path">
              <q-item-section avatar class="race-seat__code text-weight-medium">{{ s.code }}</q-item-section>
              <q-item-section>
                <q-item-label>{{ seatSummaryText(s) }}</q-item-label>
                <q-item-label v-if="s.party" caption class="text-primary">
                  {{ s.party === 1 ? 'A Transhumanist Party candidate' : `${s.party} Transhumanist Party candidates` }}
                </q-item-label>
              </q-item-section>
              <q-item-section side><q-icon name="chevron_right" /></q-item-section>
            </q-item>
          </q-list>
        </section>

        <div class="text-caption text-grey-7">
          {{ raceCredit(view.feeds) }}
          <template v-if="view.checkedAt"> Records read {{ checkedText(view.checkedAt) }}, once a day.</template>
          For state and local races, <router-link to="/candidates">look up a ZIP code</router-link>.
        </div>
      </template>
    </div>
  </PageShell>
</template>

<style scoped>
.race-crumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.race-map {
  max-width: 720px;
}
.race-map__outline {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}
.race-seat__code {
  min-width: 72px;
}
</style>
