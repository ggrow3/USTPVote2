import type { TieBreakRecord } from 'ustp-tally';
import { definitionHash, type ElectionDefinition } from './elections.js';
import type { ContestOutcome, ResultsRecord } from './results.js';

/**
 * Results as CSV (design §9), for spreadsheets: `GET /v1/public/elections/{id}/results.csv`, which Google Sheets reads
 * with IMPORTDATA. Made from the signed bundle, with titles and names from the frozen definition, so it holds nothing
 * the bundle and the published record do not. It is an unsigned copy: its first rows say that the signed bundle is the
 * record, give its hash and say where to check it.
 */

type Contest = ElectionDefinition['contests'][number];
type Cell = string | number;

export const RESULTS_CSV_NOTICE =
  'Unsigned copy for spreadsheets. The authoritative record is the signed results bundle with the results hash below; ' +
  'check it on the results page below.';

/** RFC 4180: CRLF line ends, every row the same width, UTF-8 (no byte-order mark). */
export function resultsCsv(input: {
  readonly results: ResultsRecord;
  /** The frozen definition the bundle was counted from (for titles and names). */
  readonly definition: ElectionDefinition;
  /** Where the web app is served, e.g. `https://vote.example.org`; the URLs in the header rows start with it. */
  readonly origin: string;
}): string {
  const { results, definition, origin } = input;
  const { bundle } = results;
  if (definition.electionId !== results.electionId || definitionHash(definition) !== bundle.definitionHash) {
    throw new Error('the definition is not the one these results were counted from');
  }
  const id = results.electionId;
  const rows: Cell[][] = [
    ['Election', definition.title],
    ['Notice', RESULTS_CSV_NOTICE],
    ['Status', results.status === 'certified' ? 'Certified' : 'Provisional (not yet certified)'],
    ['Certified at', results.certifiedAt ?? ''],
    ['Counted at', results.computedAt],
    ['Results hash', results.resultsHash],
    ['Results page', `${origin}/results/${id}`],
    ['Signed bundle', `${origin}/v1/public/elections/${id}/results`],
    ['Election ID', id],
    ['Ballots counted', bundle.participationCount],
    ['Voters on the roll', bundle.roll.count],
  ];
  for (const outcome of bundle.contests) {
    const contest = definition.contests.find((c) => c.contestId === outcome.contestId);
    if (!contest) throw new Error(`the definition has no contest ${outcome.contestId}`);
    rows.push([], ['Contest', contest.title], ['Contest ID', contest.contestId], ...contestRows(contest, outcome));
  }
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array<Cell>(width - r.length).fill('')].map(csvCell).join(',') + '\r\n').join('');
}

const PROPOSAL_OUTCOME = { passed: 'Passed', failed: 'Failed', no_quorum: 'No quorum' } as const;

function contestRows(contest: Contest, outcome: ContestOutcome): Cell[][] {
  const name = (id: string) => contest.candidates.find((k) => k.candidateId === id)?.name ?? id;
  const names = (ids: readonly string[]) => ids.map(name).join(', ') || 'none';
  const ties = (tieBreaks: readonly TieBreakRecord[]): Cell[][] => [
    ...tieBreaks.map((t) => ['Tie', tieText(t, names)]),
    ['Tie-break order', names(outcome.tieBreakOrder ?? [])],
  ];
  const r = outcome.result;
  switch (r.kind) {
    case 'proposal':
      return [
        ['Type', 'Proposal'],
        ['Choice', 'Votes'],
        ['Yes', r.counts.yes],
        ['No', r.counts.no],
        ['Abstain', r.counts.abstain],
        ['Ballots', r.ballots],
        ['Invalid', r.invalid],
        ['Quorum', r.quorum.required > 0 ? `${r.ballots} of ${r.quorum.required} needed (${r.quorum.met ? 'met' : 'not met'})` : 'none'],
        ['Outcome', PROPOSAL_OUTCOME[r.outcome]],
      ];
    case 'choose_n': {
      const floor = 'supportFloor' in contest.spec && !!contest.spec.supportFloor;
      return [
        ['Type', 'Choose candidates'],
        ['Seats', r.winners.length + r.vacantSeats],
        ['Candidate', 'Votes', 'Elected', ...(floor ? ['Meets support floor'] : [])],
        ...r.ranking.map((k) => [
          name(k.candidateId),
          k.votes,
          r.winners.includes(k.candidateId) ? 'yes' : 'no',
          ...(floor ? [k.meetsFloor ? 'yes' : 'no'] : []),
        ]),
        ['Ballots', r.ballots],
        ['Blank', r.blank],
        ['Invalid', r.invalid],
        ['Vacant seats', r.vacantSeats],
        ...ties(r.tieBreaks),
        ['Elected', names(r.winners)],
      ];
    }
    case 'irv': {
      // One column per round, as on the results page; a candidate's cell is empty once they are out.
      const rounds = r.rounds.length
        ? [
            ['Candidate', ...r.rounds.map((round) => `Round ${round.round}`)],
            ...contest.candidates.map((k) => [k.name, ...r.rounds.map((round) => round.counts[k.candidateId] ?? '')]),
            ['Continuing ballots', ...r.rounds.map((round) => round.continuingBallots)],
            ['Exhausted', ...r.rounds.map((round) => round.exhausted)],
            [
              'Round result',
              ...r.rounds.map((round) =>
                round.elected ? `${name(round.elected)} elected` : round.eliminated ? `${name(round.eliminated)} eliminated` : '',
              ),
            ],
          ]
        : [];
      return [
        ['Type', 'Ranked choice (instant runoff)'],
        ...rounds,
        ['Ballots', r.ballots],
        ['Blank', r.blank],
        ['Invalid', r.invalid],
        ...ties(r.tieBreaks),
        ['Elected', r.winner ? name(r.winner) : 'nobody (no ranked ballots)'],
      ];
    }
  }
}

function tieText(t: TieBreakRecord, names: (ids: readonly string[]) => string): string {
  const where = t.reason === 'seat_cutoff' ? 'for the last seat' : `for last place in round ${t.round}`;
  const how = t.resolvedBy === 'previous_rounds' ? "by the earlier rounds' counts" : "by the tie-break order drawn from the election's seed";
  const lost = t.reason === 'seat_cutoff' ? 'not elected' : 'eliminated';
  return `${names(t.tied)} tied ${where}; resolved ${how}: ${names(t.excluded)} ${lost}.`;
}

/** Cells a spreadsheet would read as a formula (or DDE) start with one of these; a leading `'` keeps them text. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell (RFC 4180), quoted when it must be, a would-be formula with a leading `'`; the members export uses it too. */
export function csvCell(value: Cell): string {
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
