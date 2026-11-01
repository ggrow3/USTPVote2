<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { currentContent, inCandidateArea, STATE_FIPS, type CandidateArea, type MyCandidacy, type PublicCandidacy } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { attempt, dialog } from '../dialogs.js';
import { session } from '../session.js';
import { myArea, myCandidacies, publicCandidacies, withdrawCandidacy } from './api.js';
import CandidacyDetails from './CandidacyDetails.vue';
import { areaText, districtText, electionText, localToday, stateName, STATUS_TEXT } from './candidacy-text.js';
import DistrictMap, { type MapMarker } from './DistrictMap.vue';

/**
 * Members running for public office (design §5.8): public, each candidacy as a Membership Admin approved it, on a map and
 * in a list, upcoming elections first. Signed-in members also see their own candidacies here, and declare new ones, and
 * the page opens on their own area, worked out from their membership record.
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

const active = computed(() => session.me?.member?.status === 'active');

/**
 * Which candidacies the page shows: `area`, the member's own (where it opens for members), `all`, or a state's code.
 * Kept in the address (`?state=`), so coming back from a candidacy keeps the choice.
 */
const where = computed<string>({
  get() {
    const asked = route.query.state;
    if (asked === 'all' || (typeof asked === 'string' && STATE_FIPS[asked] !== undefined)) return asked;
    return area.value ? 'area' : 'all';
  },
  set(value) {
    void router.replace({ query: { ...route.query, state: value === (area.value ? 'area' : 'all') ? undefined : value } });
  },
});
const whereText = computed(() => (where.value === 'area' ? ' in your area' : where.value === 'all' ? '' : ` in ${stateName(where.value)}`));
const shown = computed(() =>
  (all.value ?? []).filter((c) => {
    if (where.value === 'area') return area.value !== null && inCandidateArea(c.district, area.value);
    return where.value === 'all' || c.district.state === where.value || c.district.kind === 'nation';
  }),
);
const upcoming = computed(() => shown.value.filter((c) => c.electionDate >= today));
const past = computed(() => shown.value.filter((c) => c.electionDate < today));
const stateOptions = computed(() => {
  const codes = new Set((all.value ?? []).map((c) => c.district.state).filter((s): s is string => s !== null));
  if (area.value) codes.add(area.value.state);
  return [
    ...(area.value ? [{ label: 'Your area', value: 'area' }] : []),
    { label: 'All states', value: 'all' },
    ...[...codes].map((code) => ({ label: stateName(code), value: code })).sort((a, b) => a.label.localeCompare(b.label)),
  ];
});
const areaNote = computed(() => (area.value ? areaText(area.value) : null));

const markers = computed<MapMarker[]>(() =>
  upcoming.value.flatMap((c) =>
    c.district.point
      ? [{ id: c.candidacyId, point: c.district.point, title: c.name, caption: `${c.officeTitle} · ${districtText(c)}`, to: `/candidates/${c.candidacyId}` }]
      : [],
  ),
);

async function loadMine() {
  mine.value = session.user ? await myCandidacies() : [];
}

// Read again whenever the member changes: signing in or out, or acting as a test persona.
watch(
  () => session.me?.member?.accountId ?? null,
  async (accountId) => {
    area.value = null;
    areaPending.value = accountId !== null;
    if (accountId === null) return;
    const found = await myArea().catch(() => null);
    if ((session.me?.member?.accountId ?? null) !== accountId) return;
    area.value = found;
    areaPending.value = false;
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
          before it appears here; being listed is not an endorsement.
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
          <span class="text-grey-7">{{ upcoming.length }} upcoming {{ upcoming.length === 1 ? 'candidacy' : 'candidacies' }}{{ whereText }}</span>
        </div>
        <div v-if="where === 'area' && area && areaNote">
          <div class="text-grey-7">
            {{ areaNote.text }}
            <router-link v-if="areaNote.link" to="/account">{{ areaNote.link }}</router-link>
          </div>
          <q-btn
            flat
            no-caps
            color="primary"
            icon="how_to_vote"
            label="Your districts, who holds each office and who is running, and emails to them"
            to="/candidates/area"
            class="q-mt-xs"
          />
        </div>
        <DistrictMap :markers="markers" label="Map of members’ candidacies for upcoming elections" />
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
      </template>
    </div>
  </PageShell>
</template>

<style scoped>
.candidates-state {
  min-width: 200px;
}
.candidates-mine {
  align-items: flex-start;
}
</style>
