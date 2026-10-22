<script setup lang="ts">
import { useQuasar } from 'quasar';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  candidateInputSchema,
  updateElectionSchema,
  type ApprovalRequestRecord,
  type ContestRecord,
  type ElectionDetail,
  type ProposalSnapshotRecord,
  type RollView,
} from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { api } from '../api.js';
import { aRole, describeRequest } from '../approval-text.js';
import ContestDialog from '../components/admin/ContestDialog.vue';
import { askReason, attempt, dialog } from '../dialogs.js';
import { fromLocalInput, KIND_LABELS, rulesText, toLocalInput } from '../election-text.js';
import { validate } from '../forms.js';
import { hasRole, session } from '../session.js';

const $q = useQuasar();
const route = useRoute();
const electionId = String(route.params.id);
const url = `/v1/admin/elections/${electionId}`;

const detail = ref<ElectionDetail | null>(null);
usePageTitle(() => detail.value?.election.title ?? 'Election');
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
  dialog({ title: 'Remove contest', message: `Remove “${c.title}” and its candidates?`, cancel: true, focus: 'cancel' }).onOk(async () => {
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

// --- roll, scheduling, cancellation -------------------------------------------------------------------------

const me = computed(() => session.me?.account?.accountId);
const state = computed(() => detail.value?.election.state);
const rollApproved = computed(() => detail.value?.roll?.status === 'approved' && !!detail.value.election.rollSnapshotId);
const canCancel = computed(() => hasRole('election_admin') && ['draft', 'scheduled', 'open'].includes(state.value ?? ''));
const roll = ref<RollView | null>(null);

async function loadRoll() {
  await attempt(async () => {
    roll.value = await api<RollView>('GET', `${url}/roll`);
  });
}

async function requestWithReason(path: string, title: string, message: string, success: string) {
  const reason = await askReason(title, message);
  if (reason === null) return;
  if (await attempt(() => api('POST', `${url}/${path}`, { reason }), success)) await load();
}

function requestRoll() {
  return requestWithReason(
    'roll',
    'Request a voter roll',
    'Snapshots every Active member now. An Auditor must approve it before the election can be scheduled.',
    'Roll requested; waiting for an Auditor',
  );
}

function requestSchedule() {
  return requestWithReason(
    'schedule',
    'Request scheduling',
    'Freezes this exact definition and roll once an Auditor approves. Any edit after this request voids it.',
    'Scheduling requested; waiting for an Auditor',
  );
}

async function cancelElection() {
  const reason = await askReason(
    'Cancel election',
    state.value === 'draft' ? 'The draft is cancelled immediately.' : 'An Auditor must approve cancelling a scheduled or open election.',
  );
  if (reason === null) return;
  let result: { cancelled: boolean } | null = null;
  const ok = await attempt(async () => {
    result = await api<{ cancelled: boolean }>('POST', `${url}/cancel`, { reason });
  });
  if (!ok || !result) return;
  $q.notify({
    type: 'positive',
    message: (result as { cancelled: boolean }).cancelled ? 'Election cancelled' : 'Cancellation requested; waiting for an Auditor',
  });
  await load();
}

/** An approver reviewing this page can decide pending requests here. */
function canDecide(r: ApprovalRequestRecord): boolean {
  return hasRole(r.approverRole) && r.requestedBy !== me.value;
}

async function decide(r: ApprovalRequestRecord, decision: 'approve' | 'reject') {
  const reason = await askReason(`${decision === 'approve' ? 'Approve' : 'Reject'}: ${describeRequest(r)}`, r.reason);
  if (reason === null) return;
  const ok = await attempt(
    () => api('POST', `/v1/admin/approvals/${r.id}/decision`, { decision, reason }),
    decision === 'approve' ? 'Approved' : 'Rejected',
  );
  if (ok) await load();
}

onMounted(load);
</script>

<template>
  <q-page padding>
    <div class="row items-center q-gutter-sm q-mb-md">
      <q-btn flat dense icon="arrow_back" aria-label="Back to administration" to="/admin" />
      <h1 class="text-h5">{{ detail?.election.title ?? 'Election' }}</h1>
      <q-badge v-if="detail" :label="detail.election.state" />
    </div>

    <div v-if="detail" class="column q-gutter-md" style="max-width: 900px">
      <template v-if="state === 'draft'">
        <q-banner v-if="detail.problems.length" class="bg-orange-2 text-black" rounded>
          <div class="text-weight-medium q-mb-xs">Not ready to schedule yet:</div>
          <ul class="q-my-none">
            <li v-for="p in detail.problems" :key="p">{{ p }}</li>
          </ul>
        </q-banner>
        <q-banner v-else-if="!rollApproved" class="bg-orange-2 text-black" rounded>
          The definition is complete. Next: get a voter roll approved, then request scheduling.
        </q-banner>
        <q-banner v-else class="bg-positive text-white" rounded>Ready to schedule.</q-banner>
      </template>
      <q-banner v-else-if="state === 'scheduled'" class="bg-primary text-white" rounded>
        Scheduled {{ new Date(detail.election.scheduledAt!).toLocaleString() }}. Voting opens
        {{ new Date(detail.election.opensAt).toLocaleString() }}. The definition and roll are frozen.
        <template v-if="detail.election.secrecy === 'secret'">
          {{ detail.election.poolKeyVersion ? 'The ballot encryption key is ready.' : 'The ballot encryption key is being prepared.' }}
        </template>
      </q-banner>
      <q-banner v-else-if="state === 'open'" class="bg-positive text-white" rounded>
        Voting is open until {{ new Date(detail.election.closesAt).toLocaleString() }} (opened
        {{ new Date(detail.election.openedAt!).toLocaleString() }}).
      </q-banner>
      <q-banner v-else-if="state === 'closed'" class="bg-grey-7 text-white" rounded>
        Voting closed {{ new Date(detail.election.closedAt!).toLocaleString() }}.
      </q-banner>
      <q-banner v-else-if="state === 'cancelled'" class="bg-grey-7 text-white" rounded>
        Cancelled {{ new Date(detail.election.cancelledAt!).toLocaleString() }}.
      </q-banner>
      <div class="text-caption text-grey-7">
        Definition hash <code>{{ detail.definitionHash.slice(0, 16) }}…</code>
        <q-btn flat dense round size="xs" icon="content_copy" aria-label="Copy definition hash" @click="copyHash" />
        <template v-if="state === 'draft'"> — changes with any edit; scheduling freezes exactly this.</template>
        <template v-else-if="detail.election.tieBreakSeedCommitment">
          · tie-break seed commitment <code>{{ detail.election.tieBreakSeedCommitment.slice(0, 16) }}…</code>
        </template>
      </div>

      <q-card v-if="detail.pending.length" flat bordered>
        <q-card-section><h2 class="text-subtitle1">Waiting for a decision</h2></q-card-section>
        <q-list separator>
          <q-item v-for="r in detail.pending" :key="r.id">
            <q-item-section>
              <q-item-label>{{ describeRequest(r) }}</q-item-label>
              <q-item-label caption>
                Requested {{ new Date(r.requestedAt).toLocaleString() }} · “{{ r.reason }}” · needs {{ aRole(r.approverRole) }}
              </q-item-label>
            </q-item-section>
            <q-item-section v-if="canDecide(r)" side>
              <div class="row q-gutter-xs">
                <q-btn dense color="positive" label="Approve" @click="decide(r, 'approve')">
                  <span class="sr-only"> {{ describeRequest(r) }}</span>
                </q-btn>
                <q-btn dense flat color="negative" label="Reject" @click="decide(r, 'reject')">
                  <span class="sr-only"> {{ describeRequest(r) }}</span>
                </q-btn>
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>

      <q-card flat bordered>
        <q-card-section class="row items-center">
          <div class="col">
            <h2 class="text-subtitle1">Voter roll</h2>
            <div v-if="detail.roll" class="text-caption text-grey-7">
              {{ detail.roll.count }} Active members as of {{ new Date(detail.roll.asOf).toLocaleString() }} · Merkle root
              <code>{{ detail.roll.merkleRoot.slice(0, 16) }}…</code>
              <template v-if="detail.roll.signature"> · signed by the audit key</template>
              <template v-else-if="detail.roll.status === 'approved'"> · signature follows within a minute</template>
            </div>
            <div v-else class="text-caption text-grey-7">No roll yet.</div>
          </div>
          <q-badge v-if="detail.roll" :label="detail.roll.status" class="q-mr-sm" />
          <q-badge v-if="detail.roll?.signature" color="positive" label="signed" class="q-mr-sm" />
          <q-btn v-if="canEdit" outline no-caps color="primary" label="Request roll snapshot" @click="requestRoll" />
        </q-card-section>
        <q-expansion-item v-if="detail.roll" dense label="Members on this roll" @show="loadRoll">
          <q-list v-if="roll" dense separator>
            <q-item v-for="e in roll.entries" :key="e.accountId">
              <q-item-section>{{ e.legalName }}</q-item-section>
              <q-item-section side>{{ e.state }}</q-item-section>
            </q-item>
          </q-list>
        </q-expansion-item>
      </q-card>

      <q-card v-if="hasRole('election_admin')" flat bordered>
        <q-card-section class="row items-center q-gutter-sm">
          <h2 class="col text-subtitle1">Scheduling</h2>
          <q-btn
            v-if="canEdit"
            color="primary"
            no-caps
            label="Request scheduling"
            :disable="detail.problems.length > 0 || !rollApproved"
            @click="requestSchedule"
          />
          <q-btn v-if="canCancel" flat no-caps color="negative" label="Cancel election" @click="cancelElection" />
        </q-card-section>
      </q-card>

      <q-card flat bordered>
        <q-card-section><h2 class="text-subtitle1">Details</h2></q-card-section>
        <q-card-section class="q-gutter-md q-pt-none">
          <q-input v-model="details.title" outlined dense label="Title" :readonly="!canEdit" />
          <q-input v-model="details.description" outlined dense autogrow label="Description" :readonly="!canEdit" />
          <q-btn-toggle
            v-model="details.secrecy"
            no-caps
            toggle-color="primary"
            role="group"
            aria-label="Ballot secrecy"
            :disable="!canEdit"
            :options="[
              { label: 'Secret ballot', value: 'secret' },
              { label: 'Open roll-call', value: 'open' },
            ]"
          />
          <div class="row q-gutter-md">
            <q-input v-model="details.opensAt" class="col-12 col-sm" outlined dense type="datetime-local" label="Voting opens" :readonly="!canEdit" />
            <q-input v-model="details.closesAt" class="col-12 col-sm" outlined dense type="datetime-local" label="Voting closes" :readonly="!canEdit" />
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
        <h2 class="text-h6 col">Contests</h2>
        <q-btn v-if="canEdit" color="primary" no-caps label="Add contest" @click="openContest(null)" />
      </div>
      <div v-if="!detail.contests.length" class="text-grey-7">No contests yet.</div>

      <q-card v-for="c in detail.contests" :key="c.contestId" tag="section" :aria-labelledby="`contest-${c.contestId}`" flat bordered>
        <q-card-section>
          <div class="row items-center">
            <div class="col">
              <h3 :id="`contest-${c.contestId}`" class="text-subtitle1">{{ c.order }}. {{ c.title }}</h3>
              <div class="text-caption text-grey-7">{{ KIND_LABELS[c.spec.kind] }}</div>
            </div>
            <template v-if="canEdit">
              <q-btn flat dense no-caps label="Edit" @click="openContest(c)">
                <span class="sr-only"> {{ c.title }}</span>
              </q-btn>
              <q-btn flat dense no-caps color="negative" label="Remove" @click="removeContest(c)">
                <span class="sr-only"> {{ c.title }}</span>
              </q-btn>
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
            <q-btn outline no-caps color="primary" label="Add candidate" @click="addCandidate(c)">
              <span class="sr-only"> to {{ c.title }}</span>
            </q-btn>
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
