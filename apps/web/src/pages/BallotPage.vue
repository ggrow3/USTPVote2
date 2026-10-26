<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { VoterElection } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { api } from '../api.js';
import { attempt } from '../dialogs.js';
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

const when = (iso: string) => new Date(iso).toLocaleString();

/** Voting has not closed and the voter has not voted: the window is worth a calendar entry. */
const upcoming = (e: VoterElection) => (e.state === 'scheduled' || e.state === 'open') && !e.castAt;
/** The public calendar event (design §12): a plain link, the same file for everyone. */
const calendarPath = (electionId: string) => `/v1/public/elections/${encodeURIComponent(electionId)}/calendar.ics`;

function status(e: VoterElection): { label: string; color: string } {
  if (e.castAt) return { label: 'voted', color: 'positive' };
  switch (e.state) {
    case 'open':
      return { label: 'open — vote now', color: 'primary' };
    case 'scheduled':
      return { label: 'opens soon', color: 'grey-7' };
    default:
      return { label: 'closed', color: 'grey-7' };
  }
}
</script>

<template>
  <q-page padding>
    <div class="ustp-content">
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
      <q-list v-else-if="elections" bordered separator aria-label="Elections you can vote in">
        <template v-for="e in elections" :key="e.electionId">
          <q-item clickable :to="`/ballot/${e.electionId}`">
            <q-item-section>
              <q-item-label>{{ e.title }}</q-item-label>
              <q-item-label caption>
                Voting {{ when(e.opensAt) }} – {{ when(e.closesAt) }} ·
                {{ e.secrecy === 'secret' ? 'secret ballot' : 'roll-call (votes are public)' }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-badge :color="status(e).color" :label="status(e).label" />
            </q-item-section>
          </q-item>
          <q-item
            v-if="e.state === 'closed' || e.state === 'certified'"
            clickable
            dense
            :inset-level="0.25"
            :to="`/results/${e.electionId}`"
          >
            <q-item-section avatar><q-icon name="leaderboard" /></q-item-section>
            <q-item-section>Results of {{ e.title }}</q-item-section>
          </q-item>
          <q-item v-else-if="upcoming(e)" clickable dense :inset-level="0.25" :href="calendarPath(e.electionId)">
            <q-item-section avatar><q-icon name="event" /></q-item-section>
            <q-item-section>Add {{ e.title }} to your calendar</q-item-section>
          </q-item>
        </template>
      </q-list>
      <div v-else-if="failed" class="text-grey-7">Could not load your ballots.</div>
      <div v-else class="text-grey-7">Loading…</div>
    </div>
  </q-page>
</template>
