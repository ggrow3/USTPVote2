<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  checkResults,
  type AnchorRecord,
  type ContestOutcome,
  type ElectionDefinition,
  type PublicElection,
  type PublicLedgerEntry,
  type ResultsCheck,
  type ResultsRecord,
  type SealedBlockRecord,
  type SigningKeyRecord,
} from 'ustp-domain';
import type { TieBreakRecord } from 'ustp-tally';
import { usePageTitle } from '../a11y.js';
import { api, ApiError, errorMessage } from '../api.js';
import { rulesText } from '../election-text.js';

type Contest = ElectionDefinition['contests'][number];

const route = useRoute();
const electionId = String(route.params.id);
const loading = ref(true);
const error = ref<string | null>(null);
const record = ref<PublicElection | null>(null);
const results = ref<ResultsRecord | null>(null);
const check = ref<ResultsCheck | null>(null);
usePageTitle(() => (record.value ? `Results: ${record.value.definition.title}` : 'Results'));

const orNull = <T,>(request: Promise<T>): Promise<T | null> =>
  request.catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 409)) return null;
    throw e;
  });

/**
 * Shows the published results and checks them here, from public data only: the bundle's hash and signature, the
 * revealed seed against its commitment, and a full re-tally of the published sealed blocks with ustp-tally, which must
 * reproduce the bundle exactly (design §9).
 */
onMounted(async () => {
  try {
    const base = `/v1/public/elections/${electionId}`;
    const [publicRecord, published] = await Promise.all([
      api<PublicElection>('GET', base),
      orNull(api<ResultsRecord>('GET', `${base}/results`)),
    ]);
    record.value = publicRecord;
    results.value = published;
    if (!published) return;
    const certifiedSeq = published.certifiedLedgerSeq;
    const [blocks, keys, ledger, anchor, certification] = await Promise.all([
      api<SealedBlockRecord[]>('GET', `${base}/sealed-blocks`),
      api<SigningKeyRecord[]>('GET', '/v1/public/ledger/keys'),
      orNull(api<PublicLedgerEntry>('GET', `/v1/public/ledger/entries/${published.ledgerSeq}`)),
      orNull(api<AnchorRecord>('GET', '/v1/public/anchors/latest')),
      certifiedSeq ? orNull(api<PublicLedgerEntry>('GET', `/v1/public/ledger/entries/${certifiedSeq}`)) : Promise.resolve(null),
    ]);
    check.value = await checkResults({ election: publicRecord, results: published, blocks, keys, ledger, anchor, certification });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
});

const outcomes = computed(() => {
  const r = results.value;
  const def = record.value?.definition;
  if (!r || !def) return [];
  return r.bundle.contests.flatMap((outcome) => {
    const contest = def.contests.find((c) => c.contestId === outcome.contestId);
    return contest ? [{ contest, outcome }] : [];
  });
});

const nameOf = (c: Contest, id: string) => c.candidates.find((k) => k.candidateId === id)?.name ?? id;
const names = (c: Contest, ids: readonly string[]) => ids.map((id) => nameOf(c, id)).join(', ') || 'none';

const PROPOSAL_OUTCOME = {
  passed: { label: 'Passed', color: 'positive' },
  failed: { label: 'Failed', color: 'negative' },
  no_quorum: { label: 'No quorum', color: 'grey-7' },
} as const;

function tieText(c: Contest, t: TieBreakRecord): string {
  const where = t.reason === 'seat_cutoff' ? 'for the last seat' : `for last place in round ${t.round}`;
  const how = t.resolvedBy === 'previous_rounds' ? 'by the earlier rounds’ counts' : 'by the tie-break order drawn from the election’s seed';
  const lost = t.reason === 'seat_cutoff' ? 'not elected' : 'eliminated';
  return `${names(c, t.tied)} tied ${where}; resolved ${how}: ${names(c, t.excluded)} ${lost}.`;
}

/** IRV round table cell: blank once a candidate is out. */
function roundCount(outcome: ContestOutcome, round: number, candidateId: string): string {
  if (outcome.result.kind !== 'irv') return '';
  const count = outcome.result.rounds[round]?.counts[candidateId];
  return count === undefined ? '—' : String(count);
}

const STEP_ICON = (ok: boolean | null) =>
  ok === true ? { name: 'check_circle', color: 'positive' } : ok === false ? { name: 'cancel', color: 'negative' } : { name: 'hourglass_empty', color: 'grey-6' };

const summary = computed(() => {
  switch (check.value?.status) {
    case 'verified':
      return { cls: 'bg-positive text-white', text: 'Checked in this browser: re-counting the published ballots gives exactly these results.' };
    case 'failed':
      return { cls: 'bg-negative text-white', text: 'These results do not check out. Do not rely on them; tell an Auditor.' };
    case 'pending':
      return { cls: 'bg-grey-3 text-black', text: 'Nothing is wrong so far; some steps cannot be checked yet.' };
    default:
      return null;
  }
});
</script>

<template>
  <q-page padding>
    <q-btn flat no-caps icon="arrow_back" label="Your ballots" to="/ballot" class="q-mb-sm" />
    <q-banner v-if="error" class="bg-negative text-white" rounded>{{ error }}</q-banner>
    <div v-else-if="loading" class="row items-center q-gutter-sm">
      <q-spinner size="sm" /><span>Loading and checking the results…</span>
    </div>

    <template v-else-if="record">
      <h1 class="text-h5 q-my-none">{{ record.definition.title }} — results</h1>
      <div class="text-caption text-grey-7 q-mb-md">
        Voting closed {{ new Date(record.election.closesAt).toLocaleString() }} ·
        {{ record.election.secrecy === 'secret' ? 'secret ballot' : 'roll-call' }}
        <template v-if="results">
          · {{ results.bundle.participationCount }} of {{ results.bundle.roll.count }} on the roll voted · counted
          {{ new Date(results.computedAt).toLocaleString() }}
        </template>
      </div>

      <q-banner v-if="!results" class="bg-grey-3 text-black" rounded style="max-width: 860px">
        {{
          record.election.state === 'cancelled'
            ? 'This election was cancelled; it has no results.'
            : 'Results are published once voting has closed and every ballot has been sealed and counted, usually within a minute of closing.'
        }}
      </q-banner>

      <div v-else class="column q-gutter-md" style="max-width: 860px">
        <q-banner v-if="results.status === 'provisional'" class="bg-grey-3 text-black" rounded>
          Provisional: these results are signed and in the audit ledger, but not yet certified.
        </q-banner>
        <q-banner v-else class="bg-positive text-white" rounded>
          Certified {{ results.certifiedAt ? new Date(results.certifiedAt).toLocaleString() : '' }} by an Election Admin and an
          Auditor.
        </q-banner>
        <q-banner v-if="summary" :class="summary.cls" rounded>{{ summary.text }}</q-banner>

        <q-card v-for="{ contest, outcome } in outcomes" :key="contest.contestId" flat bordered>
          <q-card-section>
            <div class="row items-center">
              <h2 class="text-subtitle1 col q-my-none">{{ contest.title }}</h2>
              <q-badge
                v-if="outcome.result.kind === 'proposal'"
                :color="PROPOSAL_OUTCOME[outcome.result.outcome].color"
                :label="PROPOSAL_OUTCOME[outcome.result.outcome].label"
              />
            </div>
            <div v-for="line in rulesText(contest.spec)" :key="line" class="text-caption text-grey-7">{{ line }}</div>
          </q-card-section>

          <q-card-section v-if="outcome.result.kind === 'proposal'" class="q-pt-none">
            <q-markup-table flat dense separator="horizontal">
              <thead>
                <tr><th scope="col" class="text-left">Choice</th><th scope="col" class="text-right">Votes</th></tr>
              </thead>
              <tbody>
                <tr><td>Yes</td><td class="text-right">{{ outcome.result.counts.yes }}</td></tr>
                <tr><td>No</td><td class="text-right">{{ outcome.result.counts.no }}</td></tr>
                <tr><td>Abstain</td><td class="text-right">{{ outcome.result.counts.abstain }}</td></tr>
              </tbody>
            </q-markup-table>
            <div v-if="outcome.result.quorum.required > 0" class="text-caption q-mt-sm">
              Quorum: {{ outcome.result.ballots }} of {{ outcome.result.quorum.required }} needed
              ({{ outcome.result.quorum.met ? 'met' : 'not met' }}).
            </div>
          </q-card-section>

          <q-card-section v-else-if="outcome.result.kind === 'choose_n'" class="q-pt-none">
            <div class="text-body1 q-mb-sm">
              Elected: <strong>{{ names(contest, outcome.result.winners) }}</strong>
              <span v-if="outcome.result.vacantSeats > 0">
                · {{ outcome.result.vacantSeats }} {{ outcome.result.vacantSeats === 1 ? 'seat' : 'seats' }} left vacant
              </span>
            </div>
            <q-markup-table flat dense separator="horizontal">
              <thead>
                <tr>
                  <th scope="col" class="text-left">Candidate</th>
                  <th scope="col" class="text-right">Votes</th>
                  <th v-if="'supportFloor' in contest.spec && contest.spec.supportFloor" scope="col" class="text-left">Support floor</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in outcome.result.ranking" :key="r.candidateId">
                  <td>
                    {{ nameOf(contest, r.candidateId) }}
                    <q-icon v-if="outcome.result.winners.includes(r.candidateId)" name="how_to_reg" color="positive" aria-label="elected" />
                  </td>
                  <td class="text-right">{{ r.votes }}</td>
                  <td v-if="'supportFloor' in contest.spec && contest.spec.supportFloor">{{ r.meetsFloor ? 'met' : 'not met' }}</td>
                </tr>
              </tbody>
            </q-markup-table>
          </q-card-section>

          <q-card-section v-else class="q-pt-none">
            <div class="text-body1 q-mb-sm">
              Elected: <strong>{{ outcome.result.winner ? nameOf(contest, outcome.result.winner) : 'nobody (no ranked ballots)' }}</strong>
            </div>
            <div v-if="outcome.result.rounds.length" class="scroll">
              <q-markup-table flat dense separator="cell">
                <thead>
                  <tr>
                    <th scope="col" class="text-left">Candidate</th>
                    <th v-for="r in outcome.result.rounds" :key="r.round" scope="col" class="text-right">Round {{ r.round }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="k in contest.candidates" :key="k.candidateId">
                    <th scope="row" class="text-left text-weight-regular">{{ k.name }}</th>
                    <td v-for="(r, i) in outcome.result.rounds" :key="r.round" class="text-right">
                      {{ roundCount(outcome, i, k.candidateId) }}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" class="text-left text-weight-regular text-grey-7">Exhausted</th>
                    <td v-for="r in outcome.result.rounds" :key="r.round" class="text-right text-grey-7">{{ r.exhausted }}</td>
                  </tr>
                  <tr>
                    <th scope="row" class="text-left text-weight-regular text-grey-7">Outcome</th>
                    <td v-for="r in outcome.result.rounds" :key="r.round" class="text-right text-grey-7">
                      {{ r.elected ? `${nameOf(contest, r.elected)} elected` : r.eliminated ? `${nameOf(contest, r.eliminated)} out` : '—' }}
                    </td>
                  </tr>
                </tbody>
              </q-markup-table>
            </div>
          </q-card-section>

          <q-card-section v-if="outcome.result.kind !== 'proposal'" class="q-pt-none text-caption">
            <div v-for="(t, i) in outcome.result.tieBreaks" :key="i">{{ tieText(contest, t) }}</div>
            <div class="text-grey-7">
              {{ outcome.result.ballots }} ballots ({{ outcome.result.blank }} blank)<span v-if="outcome.result.invalid">,
              {{ outcome.result.invalid }} invalid</span>. Tie-break order: {{ names(contest, outcome.tieBreakOrder ?? []) }}.
            </div>
          </q-card-section>
          <q-card-section v-else-if="outcome.result.invalid" class="q-pt-none text-caption text-grey-7">
            {{ outcome.result.invalid }} invalid
          </q-card-section>
        </q-card>

        <q-card v-if="check" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1 q-my-none">How these results were checked</h2>
            <div class="text-caption text-grey-7">
              In this browser, from the published record only. Results hash <code>{{ results.resultsHash }}</code>; revealed
              tie-break seed <code>{{ results.bundle.tieBreakSeed }}</code>.
            </div>
          </q-card-section>
          <q-list dense class="q-pb-sm">
            <q-item v-for="s in check.steps" :key="s.label">
              <q-item-section avatar>
                <q-icon :name="STEP_ICON(s.ok).name" :color="STEP_ICON(s.ok).color" :aria-label="s.ok === true ? 'passed' : s.ok === false ? 'failed' : 'not yet'" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ s.label }}</q-item-label>
                <q-item-label v-if="s.detail" caption>{{ s.detail }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>
      </div>
    </template>
  </q-page>
</template>
