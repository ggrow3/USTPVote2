import {
  checkResults,
  comparedPercents,
  isRehearsalRoll,
  percent,
  resultsSynopsis,
  type ElectionState,
  type PublicElection,
  type ResultsRecord,
  type ContestSynopsis,
} from 'ustp-domain';
import { formatReport, hasFailures, mapLimited, verify, type Section } from 'ustp-verify';
import type { CachingPublicApi } from './cached-api.js';

/**
 * The reports the MCP tools return (design §3.4), built only from what the public api serves: the same records, results
 * and ledger anyone can read and check with ustp-verify. Nothing here signs in, writes, or sees a voter's identity.
 */

/** A request about an election the public record does not have: a mistyped ID, a draft, or a deleted election. */
export class NotPublished extends Error {}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The election ID in what the caller gave: the ID itself, or a link that contains it (results page, CSV, record). */
export function electionIdFrom(input: string): string {
  const id = UUID.exec(input)?.[0];
  if (!id) throw new NotPublished(`"${input.slice(0, 80)}" holds no election ID (a UUID such as 019a0a10-0000-7000-8000-000000000001)`);
  return id.toLowerCase();
}

/** The ledger entries that name an election (as their subject) and can make it public or end it. */
const LISTED_BY = new Set(['election.scheduled', 'election.cancelled', 'election.deleted']);

export interface ElectionListing {
  readonly electionId: string;
  readonly title: string;
  readonly state: ElectionState | 'deleted';
  /** Test voters only (design §10.4): a rehearsal, not a real election. */
  readonly rehearsal: boolean;
  readonly opensAt: string | null;
  readonly closesAt: string | null;
  readonly rollSize: number | null;
  readonly ballotsSealed: number | null;
  readonly results: 'provisional' | 'certified' | null;
}

export interface Links {
  readonly resultsPage: string;
  readonly record: string;
  readonly resultsCsv: string;
  /** Paste into a Google Sheets cell to load the results; Sheets refreshes it about hourly. */
  readonly importDataFormula: string;
}

export class ElectionReports {
  /** `site` is the web app's origin; Firebase Hosting serves the api under it at `/v1`. */
  constructor(
    readonly api: CachingPublicApi,
    readonly site: string = api.base,
  ) {}

  links(electionId: string): Links {
    const csv = `${this.site}/v1/public/elections/${electionId}/results.csv`;
    return {
      resultsPage: `${this.site}/results/${electionId}`,
      record: `${this.site}/v1/public/elections/${electionId}`,
      resultsCsv: csv,
      importDataFormula: `=IMPORTDATA("${csv}")`,
    };
  }

  /**
   * Every election the public ledger names, newest voting window first: published ones from their records, deleted
   * ones from their `election.deleted` entry. As of the last signed ledger block, so one scheduled in the last minute
   * may not show yet.
   */
  async listElections(): Promise<ElectionListing[]> {
    const named = new Map<string, { deleted: Record<string, unknown> | null }>();
    for (const { entry } of await this.api.publicEntries()) {
      if (!LISTED_BY.has(entry.type) || !entry.subject) continue;
      const seen = named.get(entry.subject) ?? { deleted: null };
      if (entry.type === 'election.deleted') seen.deleted = entry.payload;
      named.set(entry.subject, seen);
    }
    const listed = await mapLimited([...named], 4, async ([electionId, { deleted }]): Promise<ElectionListing | null> => {
      const record = deleted ? null : await this.api.election(electionId);
      if (record) {
        const { election, roll } = record;
        return {
          electionId,
          title: election.title,
          state: election.state,
          rehearsal: isRehearsalRoll(roll?.criteria),
          opensAt: election.opensAt,
          closesAt: election.closesAt,
          rollSize: roll?.count ?? null,
          ballotsSealed: record.ballotsSealed,
          results: record.results?.status ?? null,
        };
      }
      if (!deleted) return null;
      return {
        electionId,
        title: typeof deleted.title === 'string' ? deleted.title : '',
        state: 'deleted',
        rehearsal: deleted.rehearsal === true,
        opensAt: null,
        closesAt: null,
        rollSize: null,
        ballotsSealed: typeof deleted.ballotsCast === 'number' ? deleted.ballotsCast : null,
        results: null,
      };
    });
    return listed
      .filter((e): e is ElectionListing => e !== null)
      .sort((a, b) => (b.opensAt ?? '').localeCompare(a.opensAt ?? '') || a.title.localeCompare(b.title));
  }

  private async record(input: string): Promise<PublicElection> {
    const electionId = electionIdFrom(input);
    const record = await this.api.election(electionId);
    if (!record) throw new NotPublished(`no published election ${electionId}: drafts are not public, and a deleted election has only its ledger entry`);
    return record;
  }

  /** Where the election stands, its timeline, contests, roll and results status. */
  async status(input: string) {
    const record = await this.record(input);
    const { election, definition, roll } = record;
    return {
      electionId: election.electionId,
      title: election.title,
      description: election.description,
      state: election.state,
      stage: stage(record),
      rehearsal: isRehearsalRoll(roll?.criteria),
      secrecy: election.secrecy === 'secret' ? 'secret ballot' : 'roll-call (open) ballot',
      votingWindow: { opensAt: election.opensAt, closesAt: election.closesAt },
      timeline: {
        openedAt: election.openedAt,
        closedAt: election.closedAt,
        sealedAt: election.sealedAt,
        resultsComputedAt: record.results?.computedAt ?? null,
        certifiedAt: election.certifiedAt,
        cancelledAt: election.cancelledAt,
        ballotKeyDestroyedAt: election.poolKeyDestroyedAt,
      },
      roll: roll && { size: roll.count, asOf: roll.asOf, voters: isRehearsalRoll(roll.criteria) ? 'test voters only' : 'Active members' },
      contests: definition.contests.map((c, i) => ({
        number: i + 1,
        contestId: c.contestId,
        title: c.title,
        kind: KIND[c.spec.kind],
        ...(c.spec.kind === 'choose_n' && { seats: c.spec.seats, maxSelections: c.spec.maxSelections }),
        ...(c.proposal && { proposal: c.proposal.title, amendsBylaws: !!c.proposal.amendsBylaws }),
        ...(c.candidates.length > 0 && { candidates: c.candidates.map((k) => k.name) }),
      })),
      ballotsSealed: record.ballotsSealed,
      results: record.results && {
        status: record.results.status,
        resultsHash: record.results.resultsHash,
        computedAt: record.results.computedAt,
        certifiedAt: record.results.certifiedAt,
      },
      links: this.links(election.electionId),
    };
  }

  /**
   * Ballots against the roll. Exact once voting has closed and everything is sealed; while voting is open only sealed
   * ballots are public (design §7.2), so the figure is a lower bound.
   */
  async turnout(input: string) {
    const record = await this.record(input);
    const { election, roll } = record;
    const rollSize = roll?.count ?? 0;
    const head = { electionId: election.electionId, title: election.title, state: election.state, rehearsal: isRehearsalRoll(roll?.criteria) };
    const results = record.results ? await this.api.results(election.electionId) : null;
    if (results) {
      const synopsis = resultsSynopsis({ results, definition: record.definition });
      return {
        ...head,
        rollSize,
        ballots: synopsis.turnout.part,
        turnoutPercent: percent(synopsis.turnout),
        exact: true,
        basis: `counted: the ${results.status} results`,
        contests: synopsis.contests.map((c) => ({
          title: c.title,
          kind: KIND[c.kind],
          ballots: c.ballots,
          invalid: c.invalid,
          ...(c.kind === 'proposal'
            ? { abstain: c.abstain.part, quorum: c.quorum }
            : { blank: c.blank.part }),
        })),
      };
    }
    const sealed = record.ballotsSealed;
    const base = { ...head, rollSize, ballots: sealed, turnoutPercent: percent({ part: sealed, whole: rollSize }) };
    switch (election.state) {
      case 'draft':
      case 'scheduled':
        return { ...base, exact: true, basis: `voting has not opened (it opens ${election.opensAt})` };
      case 'open':
        return {
          ...base,
          exact: false,
          basis:
            election.secrecy === 'open'
              ? 'roll-call ballots are sealed once, when voting closes, so none are counted publicly while it is open'
              : `a lower bound: only sealed ballots are public while voting is open. Up to ${2 * election.kAnonymity - 1} ` +
                `more (2k - 1, k = ${election.kAnonymity}) wait in the encrypted pool so no sealed batch can be tied to ` +
                'fewer than k voters, plus any cast in the last minute. The exact count follows when voting closes.',
        };
      case 'closed':
        return election.sealedAt
          ? { ...base, exact: true, basis: 'every ballot is sealed; the results are being counted' }
          : { ...base, exact: false, basis: 'voting has closed and the last ballots are being sealed (within minutes)' };
      case 'cancelled':
        return { ...base, exact: !election.openedAt || !!election.sealedAt, basis: `cancelled ${election.cancelledAt ?? ''}`.trim() };
      case 'certified':
        return { ...base, exact: true, basis: 'sealed ballots' };
    }
  }

  /**
   * The results in brief (the synopsis the results page and Word file open with) and whether they verify from public
   * data, or the results CSV for a spreadsheet. Null results means not published yet.
   */
  async results(input: string, format: 'summary' | 'csv' = 'summary') {
    const record = await this.record(input);
    const { electionId } = record.election;
    const links = this.links(electionId);
    const notYet = { electionId, title: record.election.title, published: false, stage: stage(record), links };
    if (format === 'csv') {
      const csv = await this.api.text(`/v1/public/elections/${electionId}/results.csv`);
      return csv === null ? notYet : { electionId, title: record.election.title, published: true, csv, links };
    }
    const results = await this.api.results(electionId);
    if (!results) return notYet;
    const synopsis = resultsSynopsis({ results, definition: record.definition });
    return {
      electionId,
      published: true,
      status: results.status,
      statusMeaning:
        results.status === 'certified'
          ? 'certified by two Election Admins: final'
          : 'provisional: counted, signed and ledgered by the system, not yet certified by two Election Admins',
      resultsHash: results.resultsHash,
      rehearsal: isRehearsalRoll(record.roll?.criteria),
      verification: await this.verifyResults(record, results),
      synopsis: { ...synopsis, contests: synopsis.contests.map(withPassRule) },
      links,
    };
  }

  /** The results page's check (design §9): hash, signature, seed, sealed blocks, a full re-tally, then the ledger. */
  private async verifyResults(record: PublicElection, results: ResultsRecord) {
    const { electionId } = record.election;
    const entry = (seq: number | null | undefined) => (Number.isSafeInteger(seq) ? this.api.ledgerEntry(seq!) : Promise.resolve(null));
    const [blocks, keys, anchor, ledger, certification] = await Promise.all([
      this.api.sealedBlocks(electionId),
      this.api.ledgerKeys(),
      this.api.latestAnchor(),
      entry(results.ledgerSeq),
      entry(results.certifiedLedgerSeq),
    ]);
    if (!blocks) return { status: 'failed' as const, steps: [{ label: 'Sealed blocks published', ok: false }] };
    const check = await checkResults({ election: record, results, blocks, keys, ledger, anchor, certification });
    return { status: check.status, steps: check.steps.map(({ label, ok, detail }) => ({ label, ok, ...(detail && { detail }) })) };
  }

  /**
   * ustp-verify's report over the public artifacts: with an election, its record, sealed ballots and results (a full
   * re-tally); without one, the whole ledger and every public entry.
   */
  async audit(input?: string) {
    const electionId = input ? electionIdFrom(input) : undefined;
    const checkedAt = new Date().toISOString();
    const sections: Section[] = await verify(this.api, electionId ? { electionId } : { scanEntries: true });
    const counts = { passed: 0, failed: 0, pending: 0 };
    for (const f of sections.flatMap((s) => s.findings)) {
      if (f.status === 'pass') counts.passed++;
      else if (f.status === 'fail') counts.failed++;
      else if (f.status === 'pending') counts.pending++;
    }
    return {
      verified: !hasFailures(sections),
      ...counts,
      report: formatReport(`USTP Vote audit report: ${this.site}${electionId ? `, election ${electionId}` : ''}, ${checkedAt}`, sections),
    };
  }
}

const BASE = { yes_no: 'of yes + no votes', yes_no_abstain: 'of all ballots in the contest', roll: 'of the whole roll' } as const;

/**
 * A proposal's yes share beside the threshold it was judged against, in words, with as many decimals as it takes for
 * them not to look equal when they are not (the results page's rule): 1,001 of 2,001 reads "50.02%" against "50.00%".
 */
function withPassRule(contest: ContestSynopsis) {
  if (contest.kind !== 'proposal') return contest;
  const { threshold, base } = contest.passRule;
  const shown = comparedPercents(contest.yesShare, threshold.ratio);
  const bar = shown?.threshold ?? percent({ part: threshold.ratio.num, whole: threshold.ratio.den });
  const rule = `${threshold.comparison === 'gt' ? 'more than' : 'at least'} ${bar} ${BASE[base]}`;
  return { ...contest, passRule: { rule, yesShare: shown?.share ?? null } };
}

const KIND = { proposal: 'proposal (yes / no / abstain)', choose_n: 'choose N candidates', irv: 'ranked choice (instant runoff)' } as const;

/** Where the election stands, in a sentence. */
function stage({ election, results }: PublicElection): string {
  switch (election.state) {
    case 'draft':
      return 'draft';
    case 'scheduled':
      return `scheduled: voting opens ${election.opensAt}`;
    case 'open':
      return `voting is open until ${election.closesAt}`;
    case 'closed':
      if (!election.sealedAt) return `voting closed ${election.closedAt ?? election.closesAt}; the last ballots are being sealed`;
      if (!results) return 'every ballot is sealed; the results are being counted';
      return `provisional results published ${results.computedAt}; awaiting certification by two Election Admins`;
    case 'certified':
      return `results certified ${election.certifiedAt ?? ''}`.trim();
    case 'cancelled':
      return `cancelled ${election.cancelledAt ?? ''}`.trim();
  }
}
