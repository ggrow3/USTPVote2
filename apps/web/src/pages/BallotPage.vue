<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { VoterElection } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { api } from '../api.js';
import { attempt } from '../dialogs.js';

usePageTitle('Your ballots');
const elections = ref<VoterElection[] | null>(null);
const failed = ref(false);

onMounted(async () => {
  failed.value = !(await attempt(async () => {
    elections.value = await api<VoterElection[]>('GET', '/v1/elections');
  }));
});

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
    <h1 class="text-h5 q-mb-md">Your ballots</h1>
    <q-banner v-if="elections && elections.length === 0" class="bg-grey-3 text-black" rounded>
      You are not on the voter roll of any current election. Rolls are taken from Active members when an election is set
      up.
    </q-banner>
    <q-list v-else-if="elections" bordered separator style="max-width: 720px" aria-label="Elections you can vote in">
      <q-item v-for="e in elections" :key="e.electionId" clickable :to="`/ballot/${e.electionId}`">
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
    </q-list>
    <div v-else-if="failed" class="text-grey-7">Could not load your ballots.</div>
    <div v-else class="text-grey-7">Loading…</div>
  </q-page>
</template>
