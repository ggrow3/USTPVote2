<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { currentContent, type MyCandidacy, type PublicCandidacy } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { attempt, dialog } from '../dialogs.js';
import { session } from '../session.js';
import { myCandidacies, publicCandidacies, withdrawCandidacy } from './api.js';
import CandidacyDetails from './CandidacyDetails.vue';
import { districtText, electionText, localToday, stateName, STATUS_TEXT } from './candidacy-text.js';
import DistrictMap, { type MapMarker } from './DistrictMap.vue';

/**
 * Members running for public office (design §5.8): public, each candidacy as a Membership Admin approved it, on a map and
 * in a list, upcoming elections first. Signed-in members also see their own candidacies here, and declare new ones.
 */
usePageTitle('Candidates');
const all = ref<PublicCandidacy[] | null>(null);
const mine = ref<MyCandidacy[]>([]);
const error = ref<string | null>(null);
const mineError = ref<string | null>(null);
const state = ref<string | null>(null);
const today = localToday();

const active = computed(() => session.me?.member?.status === 'active');
const inState = computed(() => (all.value ?? []).filter((c) => state.value === null || c.district.state === state.value || c.district.kind === 'nation'));
const upcoming = computed(() => inState.value.filter((c) => c.electionDate >= today));
const past = computed(() => inState.value.filter((c) => c.electionDate < today));
const stateOptions = computed(() => {
  const codes = [...new Set((all.value ?? []).map((c) => c.district.state).filter((s): s is string => s !== null))];
  return [{ label: 'All states', value: null }, ...codes.map((code) => ({ label: stateName(code), value: code })).sort((a, b) => a.label.localeCompare(b.label))];
});

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
      <div v-else-if="!all" class="text-grey-7">Loading…</div>
      <template v-else>
        <div class="row items-center q-gutter-sm">
          <q-select
            v-model="state"
            :options="stateOptions"
            emit-value
            map-options
            outlined
            dense
            label="State"
            class="candidates-state"
          />
          <span class="text-grey-7">{{ upcoming.length }} upcoming {{ upcoming.length === 1 ? 'candidacy' : 'candidacies' }}</span>
        </div>
        <DistrictMap :markers="markers" label="Map of members’ candidacies for upcoming elections" />
        <div v-if="!upcoming.length" class="text-grey-7">No candidacies for upcoming elections{{ state ? ` in ${stateName(state)}` : '' }} yet.</div>
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
