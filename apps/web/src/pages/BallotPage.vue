<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { VoterElection } from 'ustp-domain';
import { api } from '../api.js';
import { attempt } from '../dialogs.js';

const elections = ref<VoterElection[] | null>(null);

onMounted(() =>
  attempt(async () => {
    elections.value = await api<VoterElection[]>('GET', '/v1/elections');
  }),
);

const when = (iso: string) => new Date(iso).toLocaleString();

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
    <div class="text-h5 q-mb-md">Your ballots</div>
    <q-banner v-if="elections && elections.length === 0" class="bg-grey-3 text-black" rounded>
      You are not on the voter roll of any current election. Rolls are taken from Active members when an election is set
      up.
    </q-banner>
    <q-list v-else-if="elections" bordered separator style="max-width: 720px">
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
      <q-item v-if="e.state === 'closed' || e.state === 'certified'" clickable dense :inset-level="0.25" :to="`/results/${e.electionId}`">
        <q-item-section avatar><q-icon name="leaderboard" /></q-item-section>
        <q-item-section>Results of {{ e.title }}</q-item-section>
      </q-item>
      </template>
    </q-list>
  </q-page>
</template>
