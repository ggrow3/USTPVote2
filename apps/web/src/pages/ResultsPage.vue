<script setup lang="ts">
import { copyToClipboard, useQuasar } from 'quasar';
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  checkResults,
  resultsSynopsis,
  type AnchorRecord,
  type BallotView,
  type ContestOutcome,
  type ElectionDefinition,
  type PublicElection,
  type PublicElectionCheck,
  type PublicLedgerEntry,
  type ResultsCheck,
  type ResultsRecord,
  type SealedBlockRecord,
  type SigningKeyRecord,
} from 'ustp-domain';
import type { TieBreakRecord } from 'ustp-tally';
import { usePageTitle } from '../a11y.js';
import { api, ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { publishedElectionCheck } from '../election-check/api.js';
import BylawsCheckNotes from '../election-check/BylawsCheckNotes.vue';
import { downloadElectionDocx } from '../election-files.js';
import { rulesText, tieBreakText } from '../election-text.js';
import ResultsSynopsis from '../elections/ResultsSynopsis.vue';
import { session } from '../session.js';

type Contest = ElectionDefinition['contests'][number];

const $q = useQuasar();
const route = useRoute();
const electionId = String(route.params.id);
const loading = ref(true);
const error = ref<string | null>(null);
const record = ref<PublicElection | null>(null);
const results = ref<ResultsRecord | null>(null);
const check = ref<ResultsCheck | null>(null);
/** Side notes from the election setup check (design §6.9), if an admin ran it on the scheduled election. */
const bylawsCheck = ref<PublicElectionCheck | null>(null);
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
    const [publicRecord, published, notes] = await Promise.all([
      api<PublicElection>('GET', base),
      orNull(api<ResultsRecord>('GET', `${base}/results`)),
      publishedElectionCheck(electionId),
    ]);
    record.value = publicRecord;
    results.value = published;
    bylawsCheck.value = notes;
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

/** The synopsis first, as the party's own results documents open; the full results have every count and round. */
const view = ref<'synopsis' | 'full'>('synopsis');
const resultsUrl = `${window.location.origin}/results/${encodeURIComponent(electionId)}`;
const synopsis = computed(() =>
  results.value && record.value ? resultsSynopsis({ results: results.value, definition: record.value.definition }) : null,
);

function showFullResults() {
  view.value = 'full';
  document.getElementById('results-tab-full')?.focus();
}

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

const tieText = (c: Contest, t: TieBreakRecord) => tieBreakText(t, (ids) => names(c, ids));

/** IRV round table cell: blank once a candidate is out. */
function roundCount(outcome: ContestOutcome, round: number, candidateId: string): string {
  if (outcome.result.kind !== 'irv') return '';
  const count = outcome.result.rounds[round]?.counts[candidateId];
  return count === undefined ? '—' : String(count);
}

/** The results as CSV; Google Sheets fetches it itself (IMPORTDATA), with no Google sign-in or add-on. */
const csvPath = `/v1/public/elections/${electionId}/results.csv`;
const sheetsFormula = `=IMPORTDATA("${window.location.origin}${csvPath}")`;

async function copyFormula() {
  try {
    await copyToClipboard(sheetsFormula); // falls back to execCommand where the Clipboard API is refused
    $q.notify({ message: 'Formula copied' });
  } catch {
    $q.notify({ message: 'Could not copy. Select the formula and copy it.' });
  }
}

/**
 * The ballot and these results as a Word file, which Google Docs opens as it is. The public record names each proposal
 * by its hash only; a signed-in voter on the roll may read the texts on their ballot, so their copy includes them.
 */
const exporting = ref(false);

async function proposalTexts(): Promise<BallotView['proposals']> {
  if (!session.user || !record.value?.definition.contests.some((c) => c.proposal)) return [];
  try {
    return (await api<BallotView>('GET', `/v1/elections/${electionId}/ballot`)).proposals;
  } catch (e) {
    if (e instanceof ApiError && [401, 403, 404].includes(e.status)) return []; // not on this election's roll
    throw e;
  }
}

async function downloadWord() {
  if (!record.value || !results.value) return;
  exporting.value = true;
  try {
    const { definition, election } = record.value;
    await downloadElectionDocx({ definition, state: election.state, proposals: await proposalTexts(), results: results.value });
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) });
  } finally {
    exporting.value = false;
  }
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
  <PageShell>
    <div class="ustp-content">
      <q-btn flat dense no-caps icon="arrow_back" label="Your ballots" to="/ballot" class="ustp-back ustp-no-print" />
      <q-banner v-if="error" class="bg-negative text-white" rounded>{{ error }}</q-banner>
      <div v-else-if="loading" class="ustp-toolbar">
        <q-spinner size="sm" /><span>Loading and checking the results…</span>
      </div>

      <template v-else-if="record">
        <div>
          <h1 class="text-h5">{{ record.definition.title }} — results</h1>
          <div class="text-caption text-grey-7">
            Voting closed {{ new Date(record.election.closesAt).toLocaleString() }} ·
            {{ record.election.secrecy === 'secret' ? 'secret ballot' : 'roll-call' }}
            <template v-if="results">
              · {{ results.bundle.participationCount }} of {{ results.bundle.roll.count }} on the roll voted · counted
              {{ new Date(results.computedAt).toLocaleString() }}
            </template>
          </div>
        </div>

        <q-banner v-if="!results" class="bg-grey-3 text-black" rounded>
          {{
            record.election.state === 'cancelled'
              ? 'This election was cancelled; it has no results.'
              : 'Results are published once voting has closed and every ballot has been sealed and counted, usually within a minute of closing.'
          }}
        </q-banner>

        <template v-else>
          <q-banner v-if="results.status === 'provisional'" class="bg-grey-3 text-black ustp-no-print" rounded>
            Provisional: these results are signed and in the audit ledger, but not yet certified.
          </q-banner>
          <q-banner v-else class="bg-positive text-white ustp-no-print" rounded>
            Certified {{ results.certifiedAt ? new Date(results.certifiedAt).toLocaleString() : '' }} by an Election Admin and an
            Auditor.
          </q-banner>
          <q-banner v-if="summary" :class="summary.cls" class="ustp-no-print" rounded>{{ summary.text }}</q-banner>

          <div class="ustp-no-print">
            <q-tabs v-model="view" dense align="left" class="text-primary" no-caps>
              <q-tab id="results-tab-synopsis" name="synopsis" label="Synopsis" aria-controls="results-panel-synopsis" />
              <q-tab id="results-tab-full" name="full" label="Full results" aria-controls="results-panel-full" />
            </q-tabs>
            <q-separator />
          </div>
          <!-- Transparent and without padding, so the panels' cards sit on the page in line with the tabs. -->
          <q-tab-panels v-model="view" keep-alive class="bg-transparent">
            <q-tab-panel id="results-panel-synopsis" name="synopsis" aria-labelledby="results-tab-synopsis" class="q-pa-none">
              <ResultsSynopsis
                v-if="synopsis"
                :synopsis="synopsis"
                :results-hash="results.resultsHash"
                :results-url="resultsUrl"
                @full-results="showFullResults"
              />
            </q-tab-panel>
            <q-tab-panel id="results-panel-full" name="full" aria-labelledby="results-tab-full" class="q-pa-none ustp-stack">
              <BylawsCheckNotes :check="bylawsCheck" :contest-id="null" subject="this election" />
              <q-card v-for="{ contest, outcome } in outcomes" :key="contest.contestId" flat bordered>
                <q-card-section>
                  <div class="ustp-header">
                    <h2 class="text-subtitle1">{{ contest.title }}</h2>
                    <q-badge
                      v-if="outcome.result.kind === 'proposal'"
                      :color="PROPOSAL_OUTCOME[outcome.result.outcome].color"
                      :label="PROPOSAL_OUTCOME[outcome.result.outcome].label"
                    />
                  </div>
                  <div v-for="line in rulesText(contest.spec)" :key="line" class="text-caption text-grey-7">{{ line }}</div>
                  <BylawsCheckNotes :check="bylawsCheck" :contest-id="contest.contestId" :subject="contest.title" />
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
            </q-tab-panel>
          </q-tab-panels>

          <q-card v-if="check" flat bordered class="ustp-no-print">
            <q-card-section>
              <h2 class="text-subtitle1">How these results were checked</h2>
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
                  <q-item-label v-if="s.detail" caption class="ustp-break">{{ s.detail }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card>

          <q-card flat bordered class="ustp-no-print">
            <q-card-section>
              <h2 class="text-subtitle1">Use these results in a spreadsheet or document</h2>
              <div class="text-caption text-grey-7">
                The CSV and Word files are unsigned copies; the signed results checked on this page are the official record.
              </div>
            </q-card-section>
            <q-card-section class="ustp-form">
              <div>
                <div class="ustp-actions">
                  <q-btn outline no-caps color="primary" icon="download" label="Download CSV" :href="csvPath" download />
                  <q-btn
                    outline
                    no-caps
                    color="primary"
                    icon="description"
                    label="Download as Word"
                    :loading="exporting"
                    aria-describedby="word-help"
                    @click="downloadWord"
                  >
                    <span class="sr-only">: {{ record.definition.title }}, ballot and results</span>
                  </q-btn>
                </div>
                <div id="word-help" class="ustp-message text-grey-7">
                  The Word file has the synopsis, the ballot and these results. To open it in Google Docs, upload it to
                  Google Drive and choose Open with, then Google Docs.
                </div>
              </div>
              <div>
                <q-input
                  :model-value="sheetsFormula"
                  readonly
                  outlined
                  dense
                  label="Google Sheets formula"
                  aria-describedby="sheets-formula-help"
                  @focus="($event.target as HTMLInputElement).select()"
                >
                  <template #append>
                    <q-btn flat round dense icon="content_copy" aria-label="Copy the Google Sheets formula" @click="copyFormula" />
                  </template>
                </q-input>
                <div id="sheets-formula-help" class="ustp-message text-grey-7">
                  Paste it into a cell in Google Sheets to load these results; Sheets refreshes them about every hour.
                </div>
              </div>
            </q-card-section>
          </q-card>
        </template>
      </template>
    </div>
  </PageShell>
</template>
