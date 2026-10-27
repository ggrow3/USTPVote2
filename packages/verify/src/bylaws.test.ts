import { sha256Hex } from 'ustp-audit';
import {
  bylawsAmendmentSchema,
  proposalContentHash,
  splitLines,
  type AmendedBylawsView,
  type BylawsRecord,
  type PublicElection,
  type PublicLedgerEntry,
  type ResultsRecord,
} from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { bylawsFindings } from './bylaws.js';
import type { Finding } from './report.js';

const text = 'USTP Bylaws\nArticle I. Name.\nThe party is the USTP.\nArticle II. Membership.\nMembership is open to all.\n';
const base: BylawsRecord = { version: '2026.1', title: 'USTP Bylaws', text, contentHash: sha256Hex(text), publishedAt: 't', publishedBy: 'ma' };
const lines = splitLines(text);
const amendment = (line: number, now: string) =>
  bylawsAmendmentSchema.parse({
    v: 1,
    base: { version: base.version, contentHash: base.contentHash },
    changes: [{ op: 'replace', from: line, to: line, expect: [lines[line - 1]], lines: [now] }],
  });
const passedAmendment = amendment(5, 'Membership is open to every adult.');
const failedAmendment = amendment(3, 'The party is the TP.');
const passedProposal = { snapshotId: 'p1', title: 'Membership', body: 'Why.', amendment: passedAmendment, contentHash: proposalContentHash('Membership', 'Why.', passedAmendment) };
const failedHash = proposalContentHash('Name', 'Why.', failedAmendment);
const amended = text.replace('open to all', 'open to every adult');

const named = { version: base.version, contentHash: base.contentHash };
const record = {
  election: { electionId: 'e1' },
  definition: {
    contests: [
      { contestId: 'members', title: 'Membership', proposal: { snapshotId: 'p1', title: 'Membership', contentHash: passedProposal.contentHash, amendsBylaws: named } },
      { contestId: 'name', title: 'Name', proposal: { snapshotId: 'p2', title: 'Name', contentHash: failedHash, amendsBylaws: named } },
    ],
  },
} as unknown as PublicElection;
const results = {
  status: 'certified',
  bundle: {
    contests: [
      { contestId: 'members', tieBreakOrder: null, result: { kind: 'proposal', outcome: 'passed' } },
      { contestId: 'name', tieBreakOrder: null, result: { kind: 'proposal', outcome: 'failed' } },
    ],
  },
} as unknown as ResultsRecord;
const view: AmendedBylawsView = {
  v: 1,
  electionId: 'e1',
  electionTitle: 'Bylaws vote',
  resultsHash: 'r'.repeat(64),
  certifiedAt: 't',
  base: { version: base.version, title: base.title, contentHash: base.contentHash },
  contests: [
    { contestId: 'members', title: 'Membership', outcome: 'passed', proposal: passedProposal },
    { contestId: 'name', title: 'Name', outcome: 'failed', proposal: null },
  ],
  text: amended,
  contentHash: sha256Hex(amended),
  changed: true,
  baseIsCurrent: false,
  adoptedAs: '2026.2',
};
const entry = (seq: number, type: string, payload: object) => ({ entry: { seq, type, payload } }) as unknown as PublicLedgerEntry;
const certification = entry(40, 'results.certified', { electionId: 'e1', bylaws: { base: named, contentHash: sha256Hex(amended) } });
const published = entry(41, 'bylaws.published', { version: '2026.2', contentHash: sha256Hex(amended), amends: '2026.1', adoptedIn: { electionId: 'e1' } });
const adopted: BylawsRecord = { ...base, version: '2026.2', text: amended, contentHash: sha256Hex(amended), amends: '2026.1' };

const check = (change: Partial<Parameters<typeof bylawsFindings>[0]> = {}) =>
  bylawsFindings({ record, results, certification, view, base, adopted, entries: new Map([[41, published]]), ...change });
const failed = (findings: readonly Finding[]) => findings.filter((f) => f.status === 'fail').map((f) => f.label);

describe('bylaws amendments', () => {
  it('pass when the served text is the base with the passed amendments, ledgered and adopted', () => {
    const findings = check();
    expect(failed(findings)).toEqual([]);
    expect(findings.map((f) => f.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
  });

  it('wait for certification, and say nothing for an election that amends no bylaws', () => {
    expect(check({ results: { ...results, status: 'provisional' } }).map((f) => f.status)).toEqual(['pending']);
    const plain = { ...record, definition: { ...record.definition, contests: [] } } as unknown as PublicElection;
    expect(check({ record: plain })).toEqual([]);
  });

  it('fail when the text, an amendment, an outcome or the ledger does not match', () => {
    expect(failed(check({ view: { ...view, text: `${amended}Extra.` } }))).toEqual(['The amended text is the base with the passed amendments applied']);
    const swapped = { ...passedProposal, amendment: amendment(5, 'Membership is by invitation.') };
    expect(failed(check({ view: { ...view, contests: [{ ...view.contests[0]!, proposal: swapped }, view.contests[1]!] } }))).toEqual([
      'Each passed amendment is the text the definition froze',
    ]);
    const flipped = { ...view, contests: [view.contests[0]!, { ...view.contests[1]!, outcome: 'passed' as const }] };
    expect(failed(check({ view: flipped }))).toContain("Each amendment's outcome is the one in the certified results");
    const wrongLedger = entry(40, 'results.certified', { electionId: 'e1', bylaws: { base: named, contentHash: 'f'.repeat(64) } });
    expect(failed(check({ certification: wrongLedger }))).toEqual(['The results.certified entry records the amended text']);
  });

  it('fail when the adopted version is not the amended text or does not name this election', () => {
    expect(failed(check({ adopted: { ...adopted, contentHash: base.contentHash } }))).toEqual([
      'Version 2026.2 is the amended text, adopted from this election',
    ]);
    const unattributed = entry(41, 'bylaws.published', { version: '2026.2', contentHash: sha256Hex(amended), amends: '2026.1' });
    expect(failed(check({ entries: new Map([[41, unattributed]]) }))).toEqual(['Version 2026.2 is the amended text, adopted from this election']);
    expect(check({ view: { ...view, adoptedAs: null }, adopted: null }).at(-1)).toMatchObject({ status: 'info', detail: expect.stringMatching(/not yet/) });
  });
});
