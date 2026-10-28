<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { VoterElection } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { api } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { attempt } from '../dialogs.js';
import { ballotCard, secrecyText, votingWindow } from '../elections/ballot-list.js';
import { session } from '../session.js';

usePageTitle('Your ballots');
const elections = ref<VoterElection[] | null>(null);
const failed = ref(false);
/** Anyone signed in can open this page; an empty list means something different for each membership status. */
const memberStatus = computed(() => session.me?.member?.status ?? null);

onMounted(async () => {
  failed.value = !(await attempt(async () => {
    elections.value = await api<VoterElection[]>('GET', '/v1/elections');
  }));
});

/** A card per election, in the voting home's style (design §10.5): when, how secret, where the voter stands, what next. */
const cards = computed(() => (elections.value ?? []).map((e) => ({ e, card: ballotCard(e) })));
</script>

<template>
  <PageShell>
    <div class="ustp-content ustp-touch">
      <h1 class="text-h5">Your ballots</h1>
      <q-banner v-if="elections && elections.length === 0" class="bg-grey-3 text-black" rounded>
        <template v-if="memberStatus === 'active'">
          You are not on the voter roll of any current election. Rolls are taken from Active members when an election is
          set up.
        </template>
        <template v-else-if="memberStatus === 'applicant'">
          Your membership application is still being reviewed. Voter rolls are taken from Active members when an election
          is set up, so once you are admitted you can vote in the elections that follow.
        </template>
        <template v-else-if="memberStatus === 'lapsed' || memberStatus === 'suspended'">
          Your membership is {{ memberStatus }}, so you are not on the voter roll of any current election. Rolls are
          taken from Active members when an election is set up.
        </template>
        <template v-else>
          Voting is for USTP members. <router-link to="/register">Register as a member</router-link> to vote in the
          elections set up after you are admitted.
        </template>
      </q-banner>
      <ul v-else-if="elections" class="ustp-ballots" aria-label="Your elections">
        <li v-for="{ e, card } in cards" :key="e.electionId">
          <q-card flat bordered>
            <q-card-section>
              <h2 class="text-subtitle1">{{ e.title }}</h2>
              <p class="q-mb-none">{{ votingWindow(e.opensAt, e.closesAt) }}</p>
              <p class="q-mb-none">{{ secrecyText(e.secrecy) }}</p>
              <p class="ustp-ballots__status q-mb-none q-mt-sm text-weight-medium" :class="`text-${card.tone}`">
                <q-icon :name="card.icon" size="24px" />
                <span>{{ card.status }}</span>
              </p>
            </q-card-section>
            <q-card-section class="ustp-actions">
              <q-btn
                v-for="(a, i) in card.actions"
                :key="a.to"
                color="primary"
                no-caps
                :unelevated="a.main"
                :outline="!a.main && i === 0"
                :flat="!a.main && i > 0"
                :to="a.to"
                :label="a.label"
              >
                <span class="sr-only">: {{ e.title }}</span>
              </q-btn>
            </q-card-section>
          </q-card>
        </li>
      </ul>
      <div v-else-if="failed" class="text-grey-7">Could not load your ballots.</div>
      <div v-else class="text-grey-7">Loading…</div>
    </div>
  </PageShell>
</template>

<style scoped>
/* One election per row: the card spans the page's column, so the dates fit on a line on a laptop. */
.ustp-ballots {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* The icon beside the status's first line, the text wrapping beside it. */
.ustp-ballots__status {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
</style>
