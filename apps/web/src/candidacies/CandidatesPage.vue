<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  contactDistricts,
  currentContent,
  groupAreaContacts,
  inCandidateArea,
  STATE_FIPS,
  type AreaCandidatesView,
  type CandidateArea,
  type MyCandidacy,
  type PublicCandidacy,
} from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { attempt, dialog } from '../dialogs.js';
import { session } from '../session.js';
import { myArea, myAreaCandidates, myCandidacies, publicCandidacies, withdrawCandidacy, zipCandidates } from './api.js';
import AreaPerson from './AreaPerson.vue';
import BallotContests from './BallotContests.vue';
import CandidacyDetails from './CandidacyDetails.vue';
import {
  areaText,
  CIVIC_CREDIT,
  districtPeopleText,
  districtText,
  electionText,
  feedNote,
  localToday,
  OFFICE_HEADINGS,
  profilesNote,
  stateName,
  STATUS_TEXT,
} from './candidacy-text.js';
import DistrictMap, { type MapMarker } from './DistrictMap.vue';

/**
 * Members running for public office (design §5.8): public, each candidacy as a Membership Admin approved it, on a map and
 * in a list, upcoming elections first. Signed-in members also see their own candidacies here, and declare new ones, and
 * the page opens on their own area, worked out from their membership record. Anyone can type a ZIP code instead. For
 * an area, the page also lists everyone running there from public records (design §5.12), apart from the members'
 * candidacies and never reviewed by the party, with a ring on the map at each district.
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
const areaNote = computed(() => {
  if (where.value === 'zip') return areaText(typed.value!.view.area, typed.value!.zip);
  return where.value === 'area' && area.value ? areaText(area.value) : null;
});

/** Everyone running in the area the page is narrowed to, from public records; none for a state or all states. */
const running = computed<AreaCandidatesView | null>(() => (where.value === 'zip' ? typed.value!.view : where.value === 'area' ? ownRunning.value : null));
/** A heading per district with someone running, each with its offices. */
const runningSections = computed(() => {
  const v = running.value;
  if (!v) return [];
  const groups = groupAreaContacts(v.area, v.candidates).filter((g) => g.candidates.length);
  return contactDistricts(v.area)
    .map((district) => ({ district, groups: groups.filter((g) => g.district.kind === district.kind && g.district.geoid === district.geoid) }))
    .filter((s) => s.groups.length);
});
const runningNotes = computed(() => {
  const v = running.value;
  return v ? [feedNote('fec', v.feeds.fec), feedNote('civic', v.feeds.civic), profilesNote(v.profiles)].filter((n): n is string => n !== null) : [];
});
const fromBallot = computed(() => !!running.value && (running.value.candidates.some((c) => c.source === 'civic') || running.value.ballot.length > 0));

const markers = computed<MapMarker[]>(() => [
  ...upcoming.value.flatMap((c) =>
    c.district.point
      ? [{ id: c.candidacyId, point: c.district.point, title: c.name, caption: `${c.officeTitle} · ${districtText(c)}`, to: `/candidates/${c.candidacyId}` }]
      : [],
  ),
  // A ring at each of the area's districts, saying who runs there.
  ...(running.value?.area.districts ?? []).flatMap((d) =>
    d.point ? [{ id: `district:${d.kind}:${d.geoid}`, point: d.point, title: d.name, caption: districtPeopleText(running.value!.candidates, d), hollow: true }] : [],
  ),
]);
const mapLabel = computed(() =>
  running.value ? `Map of members’ candidacies and of the districts${whereText.value}, with who runs in each` : 'Map of members’ candidacies for upcoming elections',
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
          Members of the party running for public office, in their own words. A Membership Admin reviews each candidacy
          before it appears here; being listed is not an endorsement. Choose your area, or type a ZIP code, to see
          everyone else running there too, from public records.
        </div>
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
        <div class="text-grey-7">{{ upcoming.length }} upcoming {{ upcoming.length === 1 ? 'candidacy' : 'candidacies' }} of members{{ whereText }}</div>
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
            label="Your districts, who holds each office and who is running, and emails to them"
            to="/candidates/area"
            class="q-mt-xs"
          />
        </div>
        <DistrictMap :markers="markers" :label="mapLabel" />
        <div v-if="!upcoming.length" class="text-grey-7">
          No candidacies for upcoming elections{{ whereText }} yet.
          <q-btn v-if="where !== 'all'" flat dense no-caps color="primary" label="Show all states" @click="where = 'all'" />
        </div>
        <q-list v-else bordered separator class="rounded-borders">
          <q-item v-for="c in upcoming" :key="c.candidacyId" clickable :to="`/candidates/${c.candidacyId}`">
            <q-item-section>
              <q-item-label class="text-weight-medium">{{ c.name }}</q-item-label>
              <q-item-label>{{ c.officeTitle }}<template v-if="c.ballotLabel"> · {{ c.ballotLabel }}</template></q-item-label>
              <q-item-label caption>{{ districtText(c) }} · {{ electionText(c) }}</q-item-label>
            </q-item-section>
            <q-item-section side><q-icon name="chevron_right" /></q-item-section>
          </q-item>
        </q-list>
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

        <section v-if="where === 'area' || where === 'zip'" class="candidates-running" aria-labelledby="candidates-running-heading">
          <h2 id="candidates-running-heading" class="text-h6 q-mb-xs">Everyone running{{ whereText }}</h2>
          <div class="text-grey-7 q-mb-sm">
            From public records: candidates for Congress and President who have filed with the FEC, and the contests on
            the ballot while Google has an election loaded, with biographies from Wikipedia and Wikidata where they have
            one. These are not the party’s: nobody here has been reviewed, and members’ own candidacies are listed above.
          </div>
          <q-banner v-if="ownRunningError" class="bg-orange-1 text-black" rounded>{{ ownRunningError }}</q-banner>
          <div v-else-if="!running" class="text-grey-7">Loading…</div>
          <template v-else>
            <q-banner v-for="n in runningNotes" :key="n" dense rounded class="bg-grey-3 text-black q-mb-sm">{{ n }}</q-banner>
            <div v-if="!runningSections.length && !running.ballot.length" class="text-grey-7">Nobody is listed{{ whereText }} yet.</div>
            <div v-for="s in runningSections" :key="`${s.district.kind}:${s.district.geoid}`" class="q-mb-md">
              <h3 class="text-subtitle1 text-weight-medium q-my-sm">{{ districtText(s) }}</h3>
              <q-card v-for="g in s.groups" :key="g.office" flat bordered class="q-mb-sm">
                <q-card-section class="q-pb-none">
                  <h4 class="text-body1 text-weight-medium q-my-none">{{ OFFICE_HEADINGS[g.office] }}</h4>
                </q-card-section>
                <q-list separator>
                  <AreaPerson v-for="c in g.candidates" :key="c.contactId" :person="c" show-email />
                </q-list>
              </q-card>
            </div>
            <BallotContests :contests="running.ballot" class="q-mb-md" />
            <div class="text-caption text-grey-7">
              Candidates for Congress and President from the FEC; biographies from Wikipedia and Wikidata, by FEC ID.
              <a v-if="fromBallot" :href="CIVIC_CREDIT.url" target="_blank" rel="noopener noreferrer">{{ CIVIC_CREDIT.text }}</a>
            </div>
          </template>
        </section>
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
