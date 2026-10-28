<script setup lang="ts">
import { computed } from 'vue';
import { amendmentText, type CandidateRecord, type ContestRecord, type ProposalSnapshotRecord, type PublicElectionCheck } from 'ustp-domain';
import BylawsCheckNotes from '../election-check/BylawsCheckNotes.vue';
import { KIND_LABELS, rulesText } from '../election-text.js';

/**
 * A question of the ballot as stored, read only: for an election past its draft, or for an Auditor, who reads what
 * they will be asked to approve (design §6.1). Drafts are built in the ballot builder instead.
 */
const props = defineProps<{
  contest: ContestRecord;
  number: number;
  candidates: readonly CandidateRecord[];
  proposals: readonly ProposalSnapshotRecord[];
  checkNotes: Pick<PublicElectionCheck, 'findings' | 'quotedLines' | 'checker'> | null;
}>();

const c = computed(() => props.contest);
const listed = computed(() =>
  c.value.spec.kind === 'proposal' ? [] : c.value.spec.candidates.flatMap((id) => props.candidates.filter((k) => k.candidateId === id)),
);
const proposal = computed(() => props.proposals.find((p) => p.snapshotId === c.value.proposalSnapshotId) ?? null);
</script>

<template>
  <q-card tag="section" :aria-labelledby="`contest-${contest.contestId}`" flat bordered>
    <q-card-section>
      <h3 :id="`contest-${contest.contestId}`" class="text-subtitle1">{{ number }}. {{ contest.title }}</h3>
      <div class="text-caption text-grey-7">{{ KIND_LABELS[contest.spec.kind] }}</div>
    </q-card-section>
    <q-card-section>
      <div v-if="contest.description" class="q-mb-xs" style="white-space: pre-wrap">{{ contest.description }}</div>
      <div v-for="line in rulesText(contest.spec)" :key="line">{{ line }}</div>
      <BylawsCheckNotes :check="checkNotes" :contest-id="contest.contestId" :subject="contest.title" />
    </q-card-section>

    <q-expansion-item v-if="contest.spec.kind === 'proposal'" dense :label="proposal ? `Text: ${proposal.title}` : 'No text attached'">
      <q-card-section v-if="proposal">
        <div style="white-space: pre-wrap">{{ proposal.body }}</div>
        <div v-if="proposal.amendment" class="q-mt-sm">
          <div class="text-weight-medium">Changes to the bylaws, version {{ proposal.amendment.base.version }}</div>
          <div class="ustp-amendment q-mt-xs">{{ amendmentText(proposal.amendment) }}</div>
        </div>
        <div class="text-caption text-grey-7 q-mt-sm">Content hash <code>{{ proposal.contentHash }}</code></div>
      </q-card-section>
    </q-expansion-item>

    <template v-else>
      <q-separator />
      <q-list dense>
        <q-item v-for="k in listed" :key="k.candidateId">
          <q-item-section>
            <q-item-label>{{ k.name }}</q-item-label>
            <q-item-label v-if="k.statement" caption style="white-space: pre-wrap">{{ k.statement }}</q-item-label>
            <q-item-label v-if="k.accountId" caption>
              <q-icon name="link" size="14px" aria-hidden="true" /> Linked to a member account
            </q-item-label>
          </q-item-section>
        </q-item>
        <q-item v-if="!listed.length"><q-item-section class="text-grey-7">No candidates yet.</q-item-section></q-item>
      </q-list>
    </template>
  </q-card>
</template>
