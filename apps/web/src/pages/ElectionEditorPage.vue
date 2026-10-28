<script setup lang="ts">
import { useQuasar } from 'quasar';
import { computed, onMounted, ref } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import {
  buildDefinition,
  checkElectionDeletable,
  consistencyMaterial,
  isRehearsalRoll,
  type ApprovalRequestRecord,
  type ElectionDetail,
  type ElectionPackage,
  type ProposalSnapshotRecord,
  type RollView,
} from 'ustp-domain';
import { focusElement, usePageTitle } from '../a11y.js';
import { api } from '../api.js';
import { aRole, describeRequest } from '../approval-text.js';
import PageShell from '../components/PageShell.vue';
import ConsistencyCheckCard from '../consistency-check/ConsistencyCheckCard.vue';
import { askReason, attempt, dialog } from '../dialogs.js';
import BylawsCheckNotes from '../election-check/BylawsCheckNotes.vue';
import ElectionCheckSection from '../election-check/ElectionCheckSection.vue';
import { pointerText } from '../election-check/election-check-text.js';
import { useElectionCheck } from '../election-check/use-election-check.js';
import { downloadElectionDocx, saveElectionPackage } from '../election-files.js';
import { electionDetail, proposalTexts } from '../elections/api.js';
import BallotBuilder from '../elections/BallotBuilder.vue';
import ElectionWorkflow from '../elections/ElectionWorkflow.vue';
import QuestionView from '../elections/QuestionView.vue';
import VotingNoticeCard from '../notifications/VotingNoticeCard.vue';
import { hasRole, session } from '../session.js';

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const electionId = String(route.params.id);
const url = `/v1/admin/elections/${electionId}`;

const detail = ref<ElectionDetail | null>(null);
usePageTitle(() => detail.value?.election.title ?? 'Election');
const proposals = ref<ProposalSnapshotRecord[]>([]);

const canEdit = computed(() => hasRole('election_admin') && detail.value?.election.state === 'draft');
const contests = computed(() => [...(detail.value?.contests ?? [])].sort((a, b) => a.order - b.order));
/** Whether the platform consistency check has anything to read (design §5.5): proposals or options, not only offices. */
const checkable = computed(() => {
  const d = detail.value;
  return !!d && consistencyMaterial(buildDefinition(d.election, d.contests, d.candidates, d.proposals), d.proposals).length > 0;
});

async function load() {
  await attempt(async () => {
    const [d, p] = await Promise.all([electionDetail(electionId), proposalTexts()]);
    detail.value = d;
    proposals.value = p;
  });
  // An edit can leave the election setup check out of date; the api says so.
  await electionCheck.load();
}

// --- the ballot builder (design §6.5) ------------------------------------------------------------------------

const builder = ref<InstanceType<typeof BallotBuilder> | null>(null);
/** A new key starts the builder again from what is stored. */
const builderKey = ref(0);

/** After the builder saves: the problems, the hash, the workflow and the checks, leaving what is being edited alone. */
async function refresh() {
  try {
    detail.value = await electionDetail(electionId);
  } catch {
    // The next save or a reload tries again; the builder keeps its own copy meanwhile.
  }
  await electionCheck.load();
}

/** Drops what the builder could not save and starts it again from the stored ballot. */
async function reloadBallot() {
  await load();
  builderKey.value += 1;
}

// Leaving the page saves what is waiting; if something cannot be saved, the admin decides.
onBeforeRouteLeave(async () => {
  if (!builder.value || (await builder.value.flush())) return true;
  return new Promise<boolean>((resolve) => {
    dialog({
      title: 'Leave without saving?',
      message: 'Some changes to the ballot are not saved. The bar at the bottom of the ballot says why.',
      cancel: { label: 'Stay', flat: true, noCaps: true },
      ok: { label: 'Leave anyway', color: 'negative', noCaps: true },
      focus: 'cancel',
      persistent: true,
    })
      .onOk(() => resolve(true))
      .onCancel(() => resolve(false));
  });
});

// --- the election setup check (design §6.9) ------------------------------------------------------------------

const electionCheck = useElectionCheck(electionId);
const canRunCheck = computed(
  () => hasRole('election_admin', 'auditor') && ['draft', 'scheduled', 'open'].includes(detail.value?.election.state ?? ''),
);
/** The finished check whose notes sit beside the contests. */
const checkNotes = computed(() => (electionCheck.state.check?.status === 'done' ? electionCheck.state.check : null));
/** A line at the top, so whoever decides on scheduling sees the check. */
const checkPointer = computed(() =>
  electionCheck.state.loading ? '' : pointerText(electionCheck.state.check, canRunCheck.value && electionCheck.state.enabled === true),
);

function goToCheck() {
  focusElement(document.getElementById('bylaws-check'));
}

function goToContest(contestId: string) {
  focusElement(document.getElementById(`contest-${contestId}`));
}

/**
 * The ballot as a Word file (design §9): the definition as it stands, the same one its hash names, with the proposal
 * texts. Built from the definition, so nothing else on this page (the roll, approvals) goes into it.
 */
const exporting = ref(false);
async function downloadWord() {
  const d = detail.value;
  if (!d) return;
  exporting.value = true;
  await attempt(() =>
    downloadElectionDocx({
      definition: buildDefinition(d.election, d.contests, d.candidates, d.proposals),
      state: d.election.state,
      proposals: d.proposals,
      results: null,
    }),
  );
  exporting.value = false;
}

/** The election as a `ustp.election` file (design §6.7), to import again here or elsewhere. */
async function downloadJson() {
  await attempt(async () => saveElectionPackage(await api<ElectionPackage>('GET', `${url}/package`)));
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

async function requestWithReason(path: string, title: string, message: string, success: string, extra: object = {}) {
  const reason = await askReason(title, message);
  if (reason === null) return;
  if (await attempt(() => api('POST', `${url}/${path}`, { reason, ...extra }), success)) await load();
}

function requestRoll() {
  return requestWithReason(
    'roll',
    'Request a voter roll',
    'Snapshots every Active member now. An Auditor must approve it before the election can be scheduled.',
    'Roll requested; waiting for an Auditor',
  );
}

/** Testing mode only (design §10.4): a roll of the test voter personas alone, so a rehearsal's turnout is its own. */
const testingMode = computed(() => !!session.me?.testing.enabled);
function requestRehearsalRoll() {
  return requestWithReason(
    'roll',
    'Request a rehearsal roll',
    'Snapshots only the Active test voters, for a rehearsal. The roll, its approval and its signature all say so. An Auditor must approve it before the election can be scheduled.',
    'Rehearsal roll requested; waiting for an Auditor',
    { voters: 'test_voters' },
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

/** Closed, with provisional results not yet sent for certification. */
const canCertify = computed(
  () =>
    hasRole('election_admin') &&
    state.value === 'closed' &&
    detail.value?.results?.status === 'provisional' &&
    !detail.value.pending.some((r) => r.action === 'election.certify'),
);

function requestCertify() {
  return requestWithReason(
    'certify',
    'Request certification',
    'An Auditor certifies exactly these provisional results. Winners of contests that fill an office then start their terms.',
    'Certification requested; waiting for an Auditor',
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

// --- permanent deletion (design §6.1) ----------------------------------------------------------------------

/** A rehearsal (test voters only) can also be deleted after voting, where testing mode is on (design §10.4). */
const rehearsal = computed(() => isRehearsalRoll(detail.value?.roll?.criteria));
const deletableRehearsal = computed(() => rehearsal.value && testingMode.value);
/** Cancelled and certified elections: whether this one can be deleted, by the API's own rule. */
const deletion = computed(() => {
  const d = detail.value;
  if (d?.ballotsCast == null) return null;
  return checkElectionDeletable(d.election, d.ballotsCast, { rehearsal: rehearsal.value, testingMode: testingMode.value, officeTerms: d.officeTerms ?? 0 });
});
const canDelete = computed(
  () => hasRole('election_admin') && deletion.value !== null && (state.value === 'cancelled' || deletableRehearsal.value),
);
const ballotsText = (n: number) => (n === 1 ? '1 ballot' : `${n} ballots`);

async function deleteElection() {
  const { election, ballotsCast } = detail.value!;
  const reason = await askReason('Delete election permanently', 'Why is it being deleted? The reason is published in the ledger.');
  if (reason === null) return;
  const what = ballotsCast
    ? `its contests, candidates, voter roll, ${ballotsText(ballotsCast)} and results`
    : 'its contests, candidates and voter rolls';
  dialog({
    title: 'Delete permanently?',
    message:
      `“${election.title}”, ${what} will be deleted permanently. This cannot be undone. ` +
      'The ledger keeps every entry about the election and records the deletion.',
    cancel: true,
    focus: 'cancel',
    ok: { label: 'Delete permanently', color: 'negative', noCaps: true },
  }).onOk(async () => {
    if (await attempt(() => api('POST', `${url}/delete`, { reason }), 'Election deleted')) {
      await router.replace({ path: '/admin', query: { tab: 'elections' } });
    }
  });
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
  <PageShell>
    <div class="ustp-content">
      <q-btn flat dense no-caps icon="arrow_back" label="Administration" to="/admin" class="ustp-back" />
      <div class="ustp-toolbar">
        <h1 class="text-h5">{{ detail?.election.title ?? 'Election' }}</h1>
        <q-badge v-if="detail" :label="detail.election.state" />
      </div>

      <template v-if="detail">
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
          <q-banner v-if="detail.advisories.length" class="bg-grey-3 text-black" rounded>
            <div class="text-weight-medium q-mb-xs">Worth a second look (these do not stop scheduling):</div>
            <ul class="q-my-none">
              <li v-for="a in detail.advisories" :key="a">{{ a }}</li>
            </ul>
          </q-banner>
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
          {{
            detail.results
              ? 'Provisional results are published; they need certifying.'
              : 'The results are computed once every ballot is sealed, usually within a minute.'
          }}
        </q-banner>
        <q-banner v-else-if="state === 'certified'" class="bg-positive text-white" rounded>
          Results certified {{ new Date(detail.election.certifiedAt!).toLocaleString() }}.
          {{ detail.election.poolKeyDestroyedAt ? 'The ballot encryption key has been destroyed.' : '' }}
        </q-banner>
        <q-banner v-else-if="state === 'cancelled'" class="bg-grey-7 text-white" rounded>
          Cancelled {{ new Date(detail.election.cancelledAt!).toLocaleString() }}.
        </q-banner>
        <div v-if="checkPointer" class="text-body2">
          <a href="#bylaws-check" @click.prevent="goToCheck">{{ checkPointer }}</a>
        </div>
        <div class="text-caption text-grey-7">
          Definition hash <code>{{ detail.definitionHash.slice(0, 16) }}…</code>
          <q-btn flat dense round size="sm" icon="content_copy" aria-label="Copy definition hash" @click="copyHash" />
          <template v-if="state === 'draft'"> — changes with any edit; scheduling freezes exactly this.</template>
          <template v-else-if="detail.election.tieBreakSeedCommitment">
            · tie-break seed commitment <code>{{ detail.election.tieBreakSeedCommitment.slice(0, 16) }}…</code>
          </template>
        </div>

        <ElectionWorkflow :detail="detail" />

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
                <div class="ustp-actions">
                  <q-btn dense color="positive" label="Approve" @click="decide(r, 'approve')">
                    <span class="sr-only">&nbsp;{{ describeRequest(r) }}</span>
                  </q-btn>
                  <q-btn dense flat color="negative" label="Reject" @click="decide(r, 'reject')">
                    <span class="sr-only">&nbsp;{{ describeRequest(r) }}</span>
                  </q-btn>
                </div>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>

        <template v-if="canEdit">
          <div class="ustp-header">
            <div>
              <h2 id="ballot-heading" class="text-h6">Ballot</h2>
              <div class="text-caption text-grey-7">
                Built as voters will read it. Changes save themselves; scheduling freezes the ballot.
              </div>
            </div>
            <div class="ustp-actions">
              <q-btn outline no-caps color="primary" icon="description" label="Download ballot as Word" :loading="exporting" @click="downloadWord">
                <span class="sr-only">: {{ detail.election.title }}</span>
              </q-btn>
              <q-btn outline no-caps color="primary" icon="data_object" label="Download as JSON" @click="downloadJson">
                <span class="sr-only">: {{ detail.election.title }}</span>
              </q-btn>
            </div>
          </div>
          <BallotBuilder
            ref="builder"
            :key="builderKey"
            :detail="detail"
            :texts="proposals"
            :check-notes="checkNotes"
            @saved="refresh"
            @text-captured="(t) => proposals.unshift(t)"
            @reload="reloadBallot"
          />
        </template>

        <q-card flat bordered>
          <q-card-section class="ustp-header">
            <div>
              <h2 class="text-subtitle1">Voter roll</h2>
              <div v-if="detail.roll" class="text-caption text-grey-7">
                {{ detail.roll.count }} Active {{ isRehearsalRoll(detail.roll.criteria) ? 'test voters' : 'members' }} as of
                {{ new Date(detail.roll.asOf).toLocaleString() }} · Merkle root
                <code>{{ detail.roll.merkleRoot.slice(0, 16) }}…</code>
                <template v-if="detail.roll.signature"> · signed by the audit key</template>
                <template v-else-if="detail.roll.status === 'approved'"> · signature follows within a minute</template>
              </div>
              <div v-else class="text-caption text-grey-7">No roll yet.</div>
            </div>
            <q-badge v-if="detail.roll" :label="detail.roll.status" />
            <q-badge v-if="detail.roll?.signature" color="positive" label="signed" />
            <q-badge v-if="isRehearsalRoll(detail.roll?.criteria)" color="orange-2" text-color="black" label="Rehearsal roll: test voters only" />
            <q-btn v-if="canEdit" outline no-caps color="primary" label="Request roll snapshot" @click="requestRoll" />
            <q-btn
              v-if="canEdit && testingMode"
              outline
              no-caps
              color="primary"
              label="Request rehearsal roll"
              aria-label="Request rehearsal roll: test voters only"
              @click="requestRehearsalRoll"
            />
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

        <VotingNoticeCard :detail="detail" />

        <q-card v-if="detail.results" flat bordered>
          <q-card-section class="ustp-header">
            <div>
              <h2 class="text-subtitle1">Results</h2>
              <div class="text-caption text-grey-7">
                {{ detail.results.status === 'certified' ? 'Certified' : 'Provisional' }} · results hash
                <code>{{ detail.results.resultsHash.slice(0, 16) }}…</code>
              </div>
            </div>
            <q-btn flat no-caps icon="leaderboard" label="View results" :to="`/results/${detail.election.electionId}`" />
            <q-btn v-if="canCertify" color="primary" no-caps label="Request certification" @click="requestCertify" />
          </q-card-section>
        </q-card>

        <q-card v-if="canEdit || canCancel" flat bordered>
          <q-card-section class="ustp-header">
            <h2 class="text-subtitle1">Scheduling</h2>
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

        <q-card v-if="canDelete" flat bordered>
          <q-card-section class="ustp-header">
            <div>
              <h2 class="text-subtitle1">Delete permanently</h2>
              <div class="text-caption text-grey-7">
                <template v-if="deletion?.ok && detail.ballotsCast">
                  A rehearsal with test voters only, so it can be deleted with its {{ ballotsText(detail.ballotsCast) }} and its
                  results. The ledger keeps its entries.
                </template>
                <template v-else-if="deletion?.ok">Nobody voted in it, so it can be deleted. The ledger keeps its entries.</template>
                <template v-else-if="deletion">Cannot be deleted: {{ deletion.reason }}.</template>
              </div>
            </div>
            <q-btn v-if="deletion?.ok" flat no-caps color="negative" label="Delete election" @click="deleteElection" />
          </q-card-section>
        </q-card>

        <q-card v-if="checkNotes && canEdit" flat bordered>
          <q-card-section>
            <BylawsCheckNotes :check="checkNotes" :contest-id="null" subject="this election" />
          </q-card-section>
        </q-card>
        <q-card v-if="!canEdit" flat bordered>
          <q-card-section><h2 class="text-subtitle1">Details</h2></q-card-section>
          <q-card-section v-if="checkNotes">
            <BylawsCheckNotes :check="checkNotes" :contest-id="null" subject="this election" />
          </q-card-section>
          <q-card-section>
            <dl class="ustp-facts">
              <dt>Title</dt>
              <dd>{{ detail.election.title }}</dd>
              <dt>Description</dt>
              <dd>{{ detail.election.description || 'None' }}</dd>
              <dt>Ballot</dt>
              <dd>{{ detail.election.secrecy === 'secret' ? 'Secret ballot' : 'Open roll-call' }}</dd>
              <dt>Voting opens</dt>
              <dd>{{ new Date(detail.election.opensAt).toLocaleString() }}</dd>
              <dt>Voting closes</dt>
              <dd>{{ new Date(detail.election.closesAt).toLocaleString() }}</dd>
              <template v-if="detail.election.secrecy === 'secret'">
                <dt>Anonymity threshold</dt>
                <dd>{{ detail.election.kAnonymity }} ballots per sealed block</dd>
              </template>
            </dl>
          </q-card-section>
        </q-card>

        <ElectionCheckSection
          :check="electionCheck.state.check"
          :enabled="electionCheck.state.enabled"
          :loading="electionCheck.state.loading"
          :requesting="electionCheck.state.requesting"
          :error="electionCheck.state.error"
          :gave-up="electionCheck.state.gaveUp"
          :state="detail.election.state"
          :contests="detail.contests"
          :can-run="canRunCheck"
          @run="electionCheck.start"
          @go-to-contest="goToContest"
        />

        <ConsistencyCheckCard
          :election-id="electionId"
          view="admin"
          :available="checkable"
          :definition-hash="detail.definitionHash"
          :choose-documents="canEdit"
        />

        <template v-if="!canEdit">
          <div class="ustp-header">
            <h2 class="text-h6">Ballot</h2>
            <div class="ustp-actions">
              <q-btn outline no-caps color="primary" icon="description" label="Download ballot as Word" :loading="exporting" @click="downloadWord">
                <span class="sr-only">: {{ detail.election.title }}</span>
              </q-btn>
              <q-btn outline no-caps color="primary" icon="data_object" label="Download as JSON" @click="downloadJson">
                <span class="sr-only">: {{ detail.election.title }}</span>
              </q-btn>
            </div>
          </div>
          <div v-if="!contests.length" class="text-grey-7">No questions yet.</div>
          <QuestionView
            v-for="(c, i) in contests"
            :key="c.contestId"
            :contest="c"
            :number="i + 1"
            :candidates="detail.candidates"
            :proposals="detail.proposals"
            :check-notes="checkNotes"
          />
        </template>
      </template>
    </div>

  </PageShell>
</template>
