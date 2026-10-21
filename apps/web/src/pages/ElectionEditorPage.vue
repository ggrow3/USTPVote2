<script setup lang="ts">
import { useQuasar } from 'quasar';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  candidateInputSchema,
  updateElectionSchema,
  type ContestRecord,
  type ElectionDetail,
  type ProposalSnapshotRecord,
} from 'ustp-domain';
import { api } from '../api.js';
import ContestDialog from '../components/admin/ContestDialog.vue';
import { attempt } from '../dialogs.js';
import { fromLocalInput, KIND_LABELS, rulesText, toLocalInput } from '../election-text.js';
import { validate } from '../forms.js';
import { hasRole } from '../session.js';

const $q = useQuasar();
const route = useRoute();
const electionId = String(route.params.id);
const url = `/v1/admin/elections/${electionId}`;

const detail = ref<ElectionDetail | null>(null);
const proposals = ref<ProposalSnapshotRecord[]>([]);
const dialogOpen = ref(false);
const editing = ref<ContestRecord | null>(null);
const details = reactive({ title: '', description: '', secrecy: 'secret' as 'secret' | 'open', opensAt: '', closesAt: '', kAnonymity: 10 });
const newCandidate = reactive<Record<string, string>>({});

const canEdit = computed(() => hasRole('election_admin') && detail.value?.election.state === 'draft');
const candidatesOf = (c: ContestRecord) =>
  c.spec.kind === 'proposal'
    ? []
    : c.spec.candidates.map((id) => detail.value!.candidates.find((k) => k.candidateId === id)).filter((k) => !!k);
const proposalOf = (c: ContestRecord) => detail.value?.proposals.find((p) => p.snapshotId === c.proposalSnapshotId);

async function load() {
  await attempt(async () => {
    const [d, p] = await Promise.all([
      api<ElectionDetail>('GET', url),
      api<ProposalSnapshotRecord[]>('GET', '/v1/admin/proposals'),
    ]);
    detail.value = d;
    proposals.value = p;
    const e = d.election;
    Object.assign(details, {
      title: e.title,
      description: e.description,
      secrecy: e.secrecy,
      opensAt: toLocalInput(e.opensAt),
      closesAt: toLocalInput(e.closesAt),
      kAnonymity: e.kAnonymity,
    });
  });
}

async function saveDetails() {
  const checked = validate(updateElectionSchema, {
    ...details,
    kAnonymity: Number(details.kAnonymity),
    opensAt: fromLocalInput(details.opensAt),
    closesAt: fromLocalInput(details.closesAt),
  });
  if (!checked.ok) {
    $q.notify({ type: 'negative', message: Object.values(checked.errors).join('; ') });
    return;
  }
  if (await attempt(() => api('PATCH', url, checked.data), 'Saved')) await load();
}

function openContest(contest: ContestRecord | null) {
  editing.value = contest;
  dialogOpen.value = true;
}

function removeContest(c: ContestRecord) {
  $q.dialog({ title: 'Remove contest', message: `Remove “${c.title}” and its candidates?`, cancel: true }).onOk(async () => {
    if (await attempt(() => api('DELETE', `${url}/contests/${c.contestId}`), 'Contest removed')) await load();
  });
}

async function addCandidate(c: ContestRecord) {
  const checked = validate(candidateInputSchema, { name: newCandidate[c.contestId] ?? '' });
  if (!checked.ok) {
    $q.notify({ type: 'negative', message: checked.errors.name ?? 'enter a name' });
    return;
  }
  if (await attempt(() => api('POST', `${url}/contests/${c.contestId}/candidates`, checked.data))) {
    newCandidate[c.contestId] = '';
    await load();
  }
}

async function removeCandidate(c: ContestRecord, candidateId: string) {
  if (await attempt(() => api('DELETE', `${url}/contests/${c.contestId}/candidates/${candidateId}`))) await load();
}

function copyHash() {
  void navigator.clipboard?.writeText(detail.value?.definitionHash ?? '');
  $q.notify({ message: 'Definition hash copied' });
}

onMounted(load);
</script>

<template>
  <q-page padding>
    <div class="row items-center q-gutter-sm q-mb-md">
      <q-btn flat dense icon="arrow_back" aria-label="Back to administration" to="/admin" />
      <div class="text-h5">{{ detail?.election.title ?? 'Election' }}</div>
      <q-badge v-if="detail" :label="detail.election.state" />
    </div>

    <div v-if="detail" class="column q-gutter-md" style="max-width: 900px">
      <q-banner v-if="detail.problems.length" class="bg-orange-2 text-black" rounded>
        <div class="text-weight-medium q-mb-xs">Not ready to schedule yet:</div>
        <ul class="q-my-none">
          <li v-for="p in detail.problems" :key="p">{{ p }}</li>
        </ul>
      </q-banner>
      <q-banner v-else class="bg-positive text-white" rounded>
        Ready to schedule. Scheduling (two-person: Election Admin request, Auditor approval) arrives next.
      </q-banner>
      <div class="text-caption text-grey-7">
        Definition hash <code>{{ detail.definitionHash.slice(0, 16) }}…</code>
        <q-btn flat dense round size="xs" icon="content_copy" aria-label="Copy definition hash" @click="copyHash" />
        — changes with any edit; scheduling freezes exactly this.
      </div>

      <q-card flat bordered>
        <q-card-section class="text-subtitle1">Details</q-card-section>
        <q-card-section class="q-gutter-md q-pt-none">
          <q-input v-model="details.title" outlined dense label="Title" :readonly="!canEdit" />
          <q-input v-model="details.description" outlined dense autogrow label="Description" :readonly="!canEdit" />
          <q-btn-toggle
            v-model="details.secrecy"
            no-caps
            toggle-color="primary"
            :disable="!canEdit"
            :options="[
              { label: 'Secret ballot', value: 'secret' },
              { label: 'Open roll-call', value: 'open' },
            ]"
          />
          <div class="row q-gutter-md">
            <q-input v-model="details.opensAt" class="col" outlined dense type="datetime-local" label="Voting opens" :readonly="!canEdit" />
            <q-input v-model="details.closesAt" class="col" outlined dense type="datetime-local" label="Voting closes" :readonly="!canEdit" />
          </div>
          <q-input
            v-if="details.secrecy === 'secret'"
            v-model.number="details.kAnonymity"
            outlined
            dense
            type="number"
            min="2"
            label="Anonymity threshold (minimum ballots per sealed block)"
            :readonly="!canEdit"
          />
        </q-card-section>
        <q-card-actions v-if="canEdit">
          <q-btn color="primary" label="Save details" @click="saveDetails" />
        </q-card-actions>
      </q-card>

      <div class="row items-center">
        <div class="text-h6 col">Contests</div>
        <q-btn v-if="canEdit" color="primary" no-caps label="Add contest" @click="openContest(null)" />
      </div>
      <div v-if="!detail.contests.length" class="text-grey-7">No contests yet.</div>

      <q-card v-for="c in detail.contests" :key="c.contestId" flat bordered>
        <q-card-section>
          <div class="row items-center">
            <div class="col">
              <div class="text-subtitle1">{{ c.order }}. {{ c.title }}</div>
              <div class="text-caption text-grey-7">{{ KIND_LABELS[c.spec.kind] }}</div>
            </div>
            <template v-if="canEdit">
              <q-btn flat dense no-caps label="Edit" @click="openContest(c)" />
              <q-btn flat dense no-caps color="negative" label="Remove" @click="removeContest(c)" />
            </template>
          </div>
          <div v-if="c.description" class="q-mt-sm" style="white-space: pre-wrap">{{ c.description }}</div>
          <div v-for="line in rulesText(c.spec)" :key="line" class="q-mt-xs">{{ line }}</div>
        </q-card-section>

        <q-expansion-item v-if="c.spec.kind === 'proposal'" dense :label="proposalOf(c) ? `Text: ${proposalOf(c)!.title}` : 'No text attached'">
          <q-card-section v-if="proposalOf(c)">
            <div style="white-space: pre-wrap">{{ proposalOf(c)!.body }}</div>
            <div class="text-caption text-grey-7 q-mt-sm">Content hash <code>{{ proposalOf(c)!.contentHash }}</code></div>
          </q-card-section>
        </q-expansion-item>

        <template v-else>
          <q-separator />
          <q-list dense>
            <q-item v-for="k in candidatesOf(c)" :key="k!.candidateId">
              <q-item-section>{{ k!.name }}</q-item-section>
              <q-item-section v-if="canEdit" side>
                <q-btn flat dense round size="sm" icon="close" :aria-label="`Remove ${k!.name}`" @click="removeCandidate(c, k!.candidateId)" />
              </q-item-section>
            </q-item>
            <q-item v-if="!candidatesOf(c).length"><q-item-section class="text-grey-7">No candidates yet.</q-item-section></q-item>
          </q-list>
          <q-card-section v-if="canEdit" class="row q-gutter-sm q-pt-none">
            <q-input v-model="newCandidate[c.contestId]" class="col" outlined dense label="Candidate name" @keyup.enter="addCandidate(c)" />
            <q-btn outline no-caps color="primary" label="Add candidate" @click="addCandidate(c)" />
          </q-card-section>
        </template>
      </q-card>
    </div>

    <ContestDialog
      v-model="dialogOpen"
      :election-id="electionId"
      :contest="editing"
      :proposals="proposals"
      @saved="load"
      @proposal-created="(p) => proposals.unshift(p)"
    />
  </q-page>
</template>
