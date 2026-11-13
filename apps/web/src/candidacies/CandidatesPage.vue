<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  CONTACT_FEEDS,
  areaSections,
  currentContent,
  inCandidateArea,
  personMarks,
  raceCode,
  racePath,
  seatOfGeoid,
  STATE_FIPS,
  type AreaCandidatesView,
  type AreaContact,
  type CandidateArea,
  type ContactDistrict,
  type MyCandidacy,
  type PublicCandidacy,
} from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { attempt, dialog } from '../dialogs.js';
import { session } from '../session.js';
import { myArea, myAreaCandidates, myCandidacies, publicCandidacies, withdrawCandidacy, zipCandidates } from './api.js';
import BallotContests from './BallotContests.vue';
import CandidacyDetails from './CandidacyDetails.vue';
import {
  areaText,
  CIVIC_CREDIT,
  districtPeopleText,
  districtText,
  electionText,
  feedNote,
  recordsCredit,
  localToday,
  profilesNote,
  stateName,
  STATUS_TEXT,
} from './candidacy-text.js';
import DistrictMap, { type MapMarker } from './DistrictMap.vue';
import { mapsRefused } from './maps.js';
import OfficeGrid from './OfficeGrid.vue';
import PartyCandidates from './PartyCandidates.vue';

/**
 * The Transhumanist Party's candidates: members running for public office (design §5.8), public, each candidacy as a
 * Membership Admin approved it, on a map and in a list, upcoming elections first. Signed-in members also see their own
 * candidacies here, and declare new ones, and the page opens on their own area, worked out from their membership
 * record. Anyone can type a ZIP code instead. For an area, the page puts its people in three groups, each its own
 * section: the party's candidates first, then, in the member's own area, their representatives (who holds each office
 * now), then everyone else running there (design §5.12): every office of the area, each with its district's outline
 * and its people from public records (in the member's own area, the party's communications team's too), with a ring on
 * the map at each district and the outline of the one chosen.
 */
usePageTitle('Candidates');
const route = useRoute();
const router = useRouter();
const all = ref<PublicCandidacy[] | null>(null);
const mine = ref<MyCandidacy[]>([]);
const error = ref<string | null>(null);
const mineError = ref<string | null>(null);
/** The signed-in member's own area; null for visitors, or when it could not be read (the page then opens on all states). */
const area = ref<CandidateArea | null>(null);
const areaPending = ref(false);
const today = localToday();

/** A ZIP code someone typed, and who runs there. Kept in the page only: never in the address or the browser's storage. */
const zipInput = ref('');
const typed = ref<{ readonly zip: string; readonly view: AreaCandidatesView } | null>(null);
const zipError = ref<string | null>(null);
const zipPending = ref(false);
const useZip = ref(false);
/** Who runs in the member's own area, from public records, read once the page shows that area. */
const ownRunning = ref<AreaCandidatesView | null>(null);
const ownRunningError = ref<string | null>(null);

const active = computed(() => session.me?.member?.status === 'active');

/**
 * Which candidacies the page shows: `area`, the member's own (where it opens for members), `zip`, a typed ZIP code's,
 * `all`, or a state's code. Kept in the address (`?state=`), except a typed ZIP code, so coming back from a candidacy
 * keeps the choice.
 */
const where = computed<string>({
  get() {
    if (useZip.value && typed.value) return 'zip';
    const asked = route.query.state;
    if (asked === 'all' || (typeof asked === 'string' && STATE_FIPS[asked] !== undefined)) return asked;
    return area.value ? 'area' : 'all';
  },
  set(value) {
    useZip.value = value === 'zip';
    if (value === 'zip') return;
    void router.replace({ query: { ...route.query, state: value === (area.value ? 'area' : 'all') ? undefined : value } });
  },
});
const whereText = computed(() => {
  if (where.value === 'zip') return ` in ZIP code ${typed.value!.zip}`;
  return where.value === 'area' ? ' in your area' : where.value === 'all' ? '' : ` in ${stateName(where.value)}`;
});
/** The area the page is narrowed to: the member's own or a typed ZIP code's; null for a state or all states. */
const shownArea = computed<CandidateArea | null>(() => (where.value === 'zip' ? typed.value!.view.area : where.value === 'area' ? area.value : null));
const shown = computed(() =>
  (all.value ?? []).filter((c) => {
    if (where.value === 'area' || where.value === 'zip') return shownArea.value !== null && inCandidateArea(c.district, shownArea.value);
    return where.value === 'all' || c.district.state === where.value || c.district.kind === 'nation';
  }),
);
const upcoming = computed(() => shown.value.filter((c) => c.electionDate >= today));
const past = computed(() => shown.value.filter((c) => c.electionDate < today));
const stateOptions = computed(() => {
  const codes = new Set((all.value ?? []).map((c) => c.district.state).filter((s): s is string => s !== null));
  if (area.value) codes.add(area.value.state);
  return [
    ...(typed.value ? [{ label: `ZIP code ${typed.value.zip}`, value: 'zip' }] : []),
    ...(area.value ? [{ label: 'Your area', value: 'area' }] : []),
    { label: 'All states', value: 'all' },
    ...[...codes].map((code) => ({ label: stateName(code), value: code })).sort((a, b) => a.label.localeCompare(b.label)),
  ];
});
/** The race pages of the area or state the page is narrowed to (design §5.17): its state's, and its House seats'. */
const racePages = computed(() => {
  const state = shownArea.value?.state ?? (where.value !== 'all' && where.value !== 'zip' && where.value !== 'area' ? where.value : null);
  if (!state) return [];
  const seats = (shownArea.value?.districts ?? []).filter((d) => d.kind === 'congressional').flatMap((d) => seatOfGeoid(d.geoid) ?? []);
  return [{ state, seat: null }, ...seats].map((p) => ({ label: p.seat === null ? stateName(p.state) : raceCode(p), to: racePath(p) }));
});
const areaNote = computed(() => {
  if (where.value === 'zip') return areaText(typed.value!.view.area, typed.value!.zip);
  return where.value === 'area' && area.value ? areaText(area.value) : null;
});

/**
 * The people of the area the page is narrowed to: in the member's own area who holds and who runs for each office, for
 * a typed ZIP code who runs; none for a state or all states.
 */
const running = computed<AreaCandidatesView | null>(() => (where.value === 'zip' ? typed.value!.view : where.value === 'area' ? ownRunning.value : null));
const people = computed(() => (running.value ? [...running.value.holders, ...running.value.candidates] : []));
/** The area's party candidates, representatives (in the member's own area) and others running, each office with its people. */
const sections = computed(() => (running.value ? areaSections(running.value.area, people.value, all.value ?? [], today) : null));
const marks = (p: AreaContact) => personMarks(p, sections.value?.holders ?? [], sections.value?.party ?? []);
/** Who holds the offices is listed too: in the member's own area. */
const withHolders = computed(() => where.value === 'area');
/** Whether the party's communications team listed anyone here: only in the member's own area. */
const fromAdmins = computed(() => people.value.some((c) => c.source === 'admin'));
const runningNotes = computed(() => {
  const v = running.value;
  // A typed ZIP code is not asked who holds office, so those records have nothing to say there.
  const feeds = withHolders.value ? CONTACT_FEEDS : CONTACT_FEEDS.filter((f) => f !== 'congress' && f !== 'openstates');
  return v ? [...feeds.map((f) => feedNote(f, v.feeds[f])), profilesNote(v.profiles)].filter((n): n is string => n !== null) : [];
});
const fromBallot = computed(() => !!running.value && (people.value.some((c) => c.source === 'civic') || running.value.ballot.length > 0));

const markers = computed<MapMarker[]>(() => {
  const s = sections.value;
  // A ring at each of the area's districts names the party's candidates, the representatives and the others there.
  const ringPeople = s ? { party: s.party, holders: s.holders, others: s.running.flatMap((g) => g.candidates) } : null;
  return [
    ...upcoming.value.flatMap((c) =>
      c.district.point
        ? [{ id: c.candidacyId, point: c.district.point, title: c.name, caption: `${c.officeTitle} · ${districtText(c)}`, to: `/candidates/${c.candidacyId}` }]
        : [],
    ),
    ...(running.value?.area.districts ?? []).flatMap((d) =>
      d.point && ringPeople ? [{ id: `district:${d.kind}:${d.geoid}`, point: d.point, title: d.name, caption: districtPeopleText(ringPeople, d), hollow: true }] : [],
    ),
  ];
});

// The outline of one of the area's districts, or its state: the first district (the state, when the area is all of
// it) until another is chosen.
const districtKey = (d: Pick<ContactDistrict, 'kind' | 'geoid'>) => `${d.kind}:${d.geoid}`;
const mapLoaded = ref(false);
/** Google can refuse the key after the map has loaded; then nothing offers to show a district on it. */
const mapReady = computed(() => mapLoaded.value && !mapsRefused.value);
const chosen = ref<ContactDistrict | null>(null);
const outlined = computed<ContactDistrict | null>(() => {
  const v = running.value;
  if (!v) return null;
  const c = chosen.value;
  if (c && (c.kind === 'state' ? c.state === v.area.state : v.area.districts.some((d) => districtKey(d) === districtKey(c)))) return c;
  return v.area.districts[0] ?? { kind: 'state', geoid: STATE_FIPS[v.area.state] ?? v.area.state, state: v.area.state, name: v.area.state };
});
const outline = computed(() => (outlined.value ? { kind: outlined.value.kind, geoid: outlined.value.geoid } : null));

/** Whether the map can outline a district: any but the nation, once it has loaded. */
const mappable = (d: ContactDistrict) => mapReady.value && d.kind !== 'nation';

/** Outlines a district on the map, and brings the map into view. */
function showOnMap(d: ContactDistrict) {
  chosen.value = d;
  document.getElementById('candidates-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** A ring was clicked: its district is outlined. */
function selectMarker(id: string) {
  const [kind, geoid] = id.startsWith('district:') ? id.slice('district:'.length).split(':') : [];
  const d = running.value?.area.districts.find((x) => x.kind === kind && x.geoid === geoid);
  if (d) chosen.value = d;
}

const mapLabel = computed(() =>
  running.value
    ? `Map of the Transhumanist Party’s candidates and of the districts${whereText.value}, with who represents and who runs in each${outlined.value ? `, outlining ${districtText({ district: outlined.value })}` : ''}`
    : 'Map of the Transhumanist Party’s candidates for upcoming elections',
);

/** Looks up who runs where the typed ZIP code is, and narrows the page to it. */
async function lookUp() {
  const zip = zipInput.value.trim();
  if (!/^[0-9]{5}$/.test(zip)) {
    zipError.value = 'Enter a five-digit ZIP code.';
    return;
  }
  zipError.value = null;
  zipPending.value = true;
  try {
    typed.value = { zip, view: await zipCandidates(zip) };
    where.value = 'zip';
  } catch (e) {
    zipError.value = errorMessage(e);
  } finally {
    zipPending.value = false;
  }
}

async function loadMine() {
  mine.value = session.user ? await myCandidacies() : [];
}

// Read again whenever the member changes: signing in or out, or acting as a test persona.
watch(
  () => session.me?.member?.accountId ?? null,
  async (accountId) => {
    area.value = null;
    ownRunning.value = null;
    areaPending.value = accountId !== null;
    if (accountId === null) return;
    const found = await myArea().catch(() => null);
    if ((session.me?.member?.accountId ?? null) !== accountId) return;
    area.value = found;
    areaPending.value = false;
  },
  { immediate: true },
);

// Who runs in the member's own area, once the page shows it.
watch(
  () => (where.value === 'area' && area.value ? (session.me?.member?.accountId ?? null) : null),
  async (accountId) => {
    if (accountId === null || ownRunning.value) return;
    ownRunningError.value = null;
    try {
      const found = await myAreaCandidates();
      if ((session.me?.member?.accountId ?? null) === accountId) ownRunning.value = found;
    } catch (e) {
      ownRunningError.value = errorMessage(e);
    }
  },
  { immediate: true },
);

onMounted(() => {
  publicCandidacies().then(
    (list) => (all.value = list),
    (e) => (error.value = errorMessage(e)),
  );
  loadMine().catch((e) => (mineError.value = errorMessage(e)));
});

function withdraw(c: MyCandidacy) {
  dialog({
    title: 'Withdraw this candidacy?',
    message: `${currentContent(c).officeTitle}, ${districtText(currentContent(c))}. It leaves the Candidates page at once, and cannot be sent again; you can declare anew.`,
    cancel: true,
    ok: { label: 'Withdraw', color: 'negative' },
  }).onOk(async () => {
    if (await attempt(() => withdrawCandidacy(c.candidacyId), 'Withdrawn')) {
      await loadMine();
      all.value = await publicCandidacies();
    }
  });
}
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <div>
        <h1 class="text-h5 q-mb-xs">Candidates</h1>
        <div class="text-grey-7">
          The Transhumanist Party’s candidates: members of the party running for public office, in their own words. Choose
          your area, or type a ZIP code, to see everyone else running there too, from public records, and in your own area
          who represents you.
        </div>
        <q-btn flat no-caps color="primary" icon="ballot" label="Every state’s races for Congress, a page each" to="/races" class="q-mt-xs" />
      </div>

      <q-card v-if="session.user && (active || mine.length)" flat bordered>
        <q-card-section class="row items-center q-gutter-sm">
          <h2 class="text-subtitle1 col">Your candidacies</h2>
          <q-btn v-if="active" color="primary" unelevated icon="campaign" label="Declare a candidacy" to="/candidates/declare" />
        </q-card-section>
        <q-banner v-if="mineError" class="bg-orange-1 text-black q-mx-md q-mb-md" rounded>{{ mineError }}</q-banner>
        <q-card-section v-else-if="!mine.length" class="text-grey-7 q-pt-none">
          Running for office? Declare it here, with your platform, and it will appear on this page once a Membership Admin
          has reviewed it.
        </q-card-section>
        <q-list v-else separator>
          <q-item v-for="c in mine" :key="c.candidacyId" class="candidates-mine">
            <q-item-section>
              <div class="row items-center q-gutter-sm q-mb-sm">
                <q-chip dense square :color="STATUS_TEXT[c.stage].color" text-color="white">{{ STATUS_TEXT[c.stage].label }}</q-chip>
                <span class="text-caption text-grey-7">{{ STATUS_TEXT[c.stage].hint }}</span>
              </div>
              <q-banner v-if="c.declined && c.status === 'open'" dense rounded class="bg-orange-1 text-black q-mb-sm">
                What to change: {{ c.declined.note }}
              </q-banner>
              <q-banner v-if="c.status === 'removed' && c.ended?.reason" dense rounded class="bg-grey-3 text-black q-mb-sm">
                Why: {{ c.ended.reason }}
              </q-banner>
              <CandidacyDetails :content="currentContent(c)" />
              <div v-if="c.status === 'open'" class="row q-gutter-sm q-mt-sm">
                <q-btn v-if="active" outline color="primary" icon="edit" label="Edit" :to="`/candidates/${c.candidacyId}/edit`" />
                <q-btn v-if="c.public" flat color="primary" label="See it as the public does" :to="`/candidates/${c.candidacyId}`" />
                <q-btn flat color="negative" label="Withdraw" @click="withdraw(c)" />
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>

      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!all || areaPending" class="text-grey-7">Loading…</div>
      <template v-else>
        <div class="row items-center q-gutter-sm">
          <q-select
            v-model="where"
            :options="stateOptions"
            emit-value
            map-options
            outlined
            dense
            label="Where"
            class="candidates-state"
          />
          <form class="row items-start no-wrap q-gutter-x-sm candidates-zip" @submit.prevent="lookUp">
            <q-input
              v-model="zipInput"
              outlined
              dense
              label="ZIP code"
              inputmode="numeric"
              autocomplete="postal-code"
              maxlength="5"
              :error="zipError !== null"
              :error-message="zipError ?? undefined"
              hide-bottom-space
              class="candidates-zip__input"
            />
            <q-btn type="submit" outline no-caps color="primary" label="Who runs there" :loading="zipPending" />
          </form>
        </div>
        <div v-if="areaNote">
          <div class="text-grey-7">
            {{ areaNote.text }}
            <router-link v-if="areaNote.link" to="/account">{{ areaNote.link }}</router-link>
          </div>
          <q-btn
            v-if="where === 'area'"
            flat
            no-caps
            color="primary"
            icon="how_to_vote"
            label="Your districts, your representatives and who is running, and emails to them"
            to="/candidates/area"
            class="q-mt-xs"
          />
        </div>
        <div v-if="racePages.length" class="row items-center q-gutter-xs">
          <span class="text-grey-7">Race pages to share:</span>
          <q-btn v-for="r in racePages" :key="r.to" outline dense no-caps color="primary" icon="ballot" :label="r.label" :to="r.to" />
        </div>
        <div id="candidates-map">
          <DistrictMap :markers="markers" :outline="outline" :label="mapLabel" @ready="mapLoaded = true" @select="selectMarker" />
          <div v-if="mapReady && outlined" class="text-caption text-grey-7 q-mt-xs">
            Outlined: {{ districtText({ district: outlined }) }}. Choose an office’s <strong>Map</strong>, or a ring, to outline its district.
          </div>
        </div>

        <section aria-labelledby="candidates-party-heading">
          <h2 id="candidates-party-heading" class="text-h6 q-mb-xs">Transhumanist Party candidates{{ whereText }}</h2>
          <div class="text-grey-7 q-mb-sm">
            Members of the party running for public office. A Membership Admin reviews each candidacy before it appears
            here; being listed is not an endorsement.
          </div>
          <div v-if="!upcoming.length" class="text-grey-7">
            No Transhumanist Party candidates for upcoming elections{{ whereText }} yet.
            <q-btn v-if="where !== 'all'" flat dense no-caps color="primary" label="Show all states" @click="where = 'all'" />
          </div>
          <PartyCandidates v-else :candidacies="upcoming" :holders="sections?.holders ?? []" />
          <q-expansion-item v-if="past.length" :label="`Past elections (${past.length})`" header-class="text-grey-7">
            <q-list separator>
              <q-item v-for="c in past" :key="c.candidacyId" clickable :to="`/candidates/${c.candidacyId}`">
                <q-item-section>
                  <q-item-label>{{ c.name }} · {{ c.officeTitle }}</q-item-label>
                  <q-item-label caption>{{ districtText(c) }} · {{ electionText(c) }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-expansion-item>
        </section>

        <template v-if="where === 'area' || where === 'zip'">
          <q-banner v-if="ownRunningError" class="bg-orange-1 text-black" rounded>{{ ownRunningError }}</q-banner>
          <div v-else-if="!running || !sections" class="text-grey-7">Loading…</div>
          <template v-else>
            <q-banner v-for="n in runningNotes" :key="n" dense rounded class="bg-grey-3 text-black">{{ n }}</q-banner>

            <section v-if="withHolders" aria-labelledby="candidates-representatives-heading">
              <h2 id="candidates-representatives-heading" class="text-h6 q-mb-xs">Your representatives</h2>
              <div class="text-grey-7 q-mb-sm">
                Who holds each office where you vote, now: members of Congress, and state legislators from Open States,
                with biographies from Wikipedia and Wikidata where they have one. Choose a person’s photo or name to see
                them with the area they represent.
              </div>
              <OfficeGrid
                :groups="sections.representatives"
                part="holders"
                every
                show-email
                :election-year="running.electionYear"
                :not-up="running.notUp"
                :marks="marks"
                :mappable="mappable"
                @map="showOnMap"
              />
            </section>

            <section class="candidates-running" aria-labelledby="candidates-running-heading">
              <h2 id="candidates-running-heading" class="text-h6 q-mb-xs">Others running{{ whereText }}</h2>
              <div class="text-grey-7 q-mb-sm">
                Everyone else running for the area’s offices, with the area each is elected from. From public records:
                candidates for Congress and President who have filed with the FEC, the contests on the ballot while Google
                has an election loaded, and in California the Secretary of State’s list of who is on the ballot, with
                biographies from Wikipedia and Wikidata where they have one.
                <template v-if="fromAdmins">Those marked “Added by the communications team” were listed by the party’s communications team.</template>
                None of them has been reviewed or endorsed by the party.
                <template v-if="!withHolders">Who holds each office is listed for a signed-in member’s own area.</template>
              </div>
              <OfficeGrid
                :groups="sections.running"
                part="candidates"
                :every="!withHolders"
                show-email
                :election-year="running.electionYear"
                :not-up="running.notUp"
                :marks="marks"
                :mappable="mappable"
                @map="showOnMap"
              />
              <BallotContests :contests="running.ballot" class="q-mt-md" />
              <div class="text-caption text-grey-7 q-mt-md">
                {{ recordsCredit(withHolders, running.feeds.sos === 'ok') }}
                <a v-if="fromBallot" :href="CIVIC_CREDIT.url" target="_blank" rel="noopener noreferrer">{{ CIVIC_CREDIT.text }}</a>
              </div>
            </section>
          </template>
        </template>
      </template>
    </div>
  </PageShell>
</template>

<style scoped>
.candidates-state {
  min-width: 200px;
}
.candidates-zip__input {
  width: 120px;
}
.candidates-mine {
  align-items: flex-start;
}
</style>
