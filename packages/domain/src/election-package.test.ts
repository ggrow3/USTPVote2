import { sha256Hex } from 'ustp-audit';
import { describe, expect, it } from 'vitest';
import { bylawsAmendmentSchema } from './amendments.js';
import { splitLines } from './text-diff.js';
import {
  electionPackageFrom,
  electionPackageSchema,
  MAX_PACKAGE_DOCUMENTS,
  packageContestRecords,
  packageProposals,
  packageRecords,
  packageWindow,
  type ElectionPackageInput,
  type PackageProposal,
} from './election-package.js';
import { buildDefinition, definitionHash, proposalContentHash, validateDefinition, type ProposalSnapshotRecord } from './elections.js';

const now = new Date('2026-10-20T12:00:00Z');
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' } as const;
const bylaws = 'USTP Bylaws\nArticle I. Name.\nThe party is the USTP.\n';
const amendment = bylawsAmendmentSchema.parse({
  v: 1,
  base: { version: '2026.1', contentHash: sha256Hex(bylaws) },
  changes: [{ op: 'replace', from: 3, to: 3, expect: [splitLines(bylaws)[2]], lines: ['The party is the US Transhumanist Party.'] }],
});

/** What someone writes by hand: names only, a window relative to the import, a proposal titled like its contest. */
const handWritten: ElectionPackageInput = {
  format: 'ustp.election',
  v: 1,
  title: 'Rehearsal',
  secrecy: 'open',
  window: { opensInSeconds: 120, votingSeconds: 300 },
  contests: [
    { kind: 'choose_n', title: 'Board', seats: 2, maxSelections: 2, candidates: ['Ada', 'Grace', { id: 'alan', name: 'Alan', statement: 'Hi.' }] },
    { id: 'name', kind: 'proposal', title: 'Our name', passRule: MAJORITY, proposal: { body: 'Spell it out.', amendment } },
    { id: 'chair', kind: 'irv', title: 'Chair', candidates: ['Ada', 'Alan'] },
  ],
};

let n = 0;
const newId = () => `id${++n}`;

/** The proposal text an import captures for `p`. */
function captured(p: PackageProposal | null, snapshotId: string, source: string | null = null): ProposalSnapshotRecord {
  if (!p || !('input' in p)) throw new Error('expected a proposal text');
  return { snapshotId, ...p.input, source, contentHash: p.contentHash, capturedAt: '', capturedBy: 'ea' };
}

describe('election packages', () => {
  it('turn a hand-written file into a draft that is ready to schedule', () => {
    const pkg = electionPackageSchema.parse(handWritten);
    expect(pkg).toMatchObject({ description: '', kAnonymity: 10, contests: [{ description: '' }, {}, {}] });

    const proposals = packageProposals(pkg);
    expect(proposals).toEqual([
      null,
      {
        input: { title: 'Our name', body: 'Spell it out.', amendment },
        contentHash: proposalContentHash('Our name', 'Spell it out.', amendment),
      },
      null,
    ]);

    n = 0;
    const { election, contests, candidates } = packageRecords(pkg, { electionId: 'e1', createdBy: 'ea', now, newId, snapshotIds: [null, 'p1', null] });
    expect(election).toMatchObject({ electionId: 'e1', state: 'draft', opensAt: '2026-10-20T12:02:00.000Z', closesAt: '2026-10-20T12:07:00.000Z' });
    expect(contests.map((c) => [c.contestId, c.order, c.spec.kind, c.proposalSnapshotId])).toEqual([
      ['id1', 1, 'choose_n', null],
      ['name', 2, 'proposal', 'p1'],
      ['chair', 3, 'irv', null],
    ]);
    expect(contests[0]!.spec).toEqual({ kind: 'choose_n', id: 'id1', candidates: ['id2', 'id3', 'alan'], seats: 2, maxSelections: 2 });
    expect(candidates.find((k) => k.candidateId === 'alan')).toEqual({ candidateId: 'alan', contestId: 'id1', name: 'Alan', statement: 'Hi.', accountId: null });

    expect(validateDefinition(buildDefinition(election, contests, candidates, [captured(proposals[1]!, 'p1')]), now)).toEqual([]);
  });

  it('export an election so that importing it gives the same definition', () => {
    n = 0;
    const pkg = electionPackageSchema.parse({ ...handWritten, window: { opensAt: '2026-11-01T00:00:00Z', closesAt: '2026-11-08T00:00:00Z' } });
    const records = packageRecords(pkg, { electionId: 'e1', createdBy: 'ea', now, newId, snapshotIds: [null, 'p1', null] });
    const proposals = [captured(packageProposals(pkg)[1]!, 'p1', 'minutes')];
    const contentHash = proposals[0]!.contentHash;

    const exported = electionPackageFrom({ ...records, proposals }, { electionId: 'e1', definitionHash: 'a'.repeat(64), exportedAt: 't' });
    const file = JSON.parse(JSON.stringify(exported)) as unknown;
    expect(file).toMatchObject({
      window: { opensAt: '2026-11-01T00:00:00Z', closesAt: '2026-11-08T00:00:00Z' },
      contests: [
        { id: 'id1', candidates: [{ id: 'id2', name: 'Ada' }, { id: 'id3', name: 'Grace' }, { id: 'alan', name: 'Alan', statement: 'Hi.' }] },
        { id: 'name', proposal: { title: 'Our name', source: 'minutes', amendment, contentHash } },
        { id: 'chair' },
      ],
    });

    const again = electionPackageSchema.parse(file);
    expect(packageProposals(again)[1]).toMatchObject({ contentHash });
    const reimported = packageRecords(again, { electionId: 'e1', createdBy: 'ea', now, newId: () => 'unused', snapshotIds: [null, 'p1', null] });
    expect(reimported.contests).toEqual(records.contests);
    expect(reimported.candidates).toEqual(records.candidates);
    expect(definitionHash(buildDefinition(reimported.election, reimported.contests, reimported.candidates, proposals))).toBe(
      definitionHash(buildDefinition(records.election, records.contests, records.candidates, proposals)),
    );
  });

  it('refuse files that are inconsistent or too big, saying where', () => {
    const problems = (input: unknown) => {
      const result = electionPackageSchema.safeParse(input);
      return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    };
    const contests = handWritten.contests!;
    expect(problems({ ...handWritten, window: { opensAt: '2026-11-01T00:00:00Z', votingSeconds: 60 } })).toEqual([
      'window: give either opensAt and closesAt, or opensInSeconds and votingSeconds',
    ]);
    expect(problems({ ...handWritten, window: { opensAt: '2026-11-08T00:00:00Z', closesAt: '2026-11-01T00:00:00Z' } })).toEqual([
      'window.closesAt: voting must close after it opens',
    ]);
    expect(problems({ ...handWritten, contests: [...contests, { ...contests[2]!, title: 'Chair again' }] })).toEqual(['contests.3.id: another contest is chair']);
    expect(problems({ ...handWritten, contests: [{ ...contests[0]!, candidates: [{ id: 'x', name: 'A' }, { id: 'x', name: 'B' }] }] })).toEqual([
      'contests.0.candidates.1.id: another candidate is x',
    ]);
    expect(problems({ ...handWritten, contests: [{ ...contests[1]!, id: 'has space' }] })[0]).toMatch(/^contests\.0\.id: use up to 64/);
    expect(problems({ ...handWritten, contests: [{ ...contests[1]!, proposal: { body: 'Spell it out.', contentHash: 'b'.repeat(64) } }] })).toEqual([
      'contests.0.proposal.contentHash: the proposal text does not hash to this; the text was changed after export, or the hash is wrong',
    ]);
    expect(problems({ ...handWritten, contests: [{ ...contests[1]!, proposal: { snapshotId: 'p1', body: 'x' } }] })).toEqual([
      'contests.0.proposal: give either snapshotId (a proposal text already captured) or the text, not both',
    ]);
    expect(problems({ ...handWritten, contests: [{ ...contests[1]!, proposal: {} }] })).toEqual([
      'contests.0.proposal.body: enter the proposal text, or give the snapshotId of one already captured',
    ]);
    const crowded = Array.from({ length: 5 }, (_, i) => ({ kind: 'irv', title: `Seat ${i}`, candidates: Array.from({ length: 95 }, (_, j) => `C${j}`) }));
    expect(problems({ ...handWritten, contests: crowded })).toEqual([
      `contests: the election, its contests, candidates and new proposal texts come to 481 records; at most ${MAX_PACKAGE_DOCUMENTS} import at once`,
    ]);
    expect(problems({ ...handWritten, format: 'ustp.proposal' })[0]).toMatch(/^format:/);
  });

  it('count a relative window from the import', () => {
    expect(packageWindow({ opensInSeconds: 0, votingSeconds: 60 }, now)).toEqual({ opensAt: '2026-10-20T12:00:00.000Z', closesAt: '2026-10-20T12:01:00.000Z' });
  });

  it('add their questions after a draft’s own, giving new IDs where the draft has them already', () => {
    const pkg = electionPackageSchema.parse({
      format: 'ustp.election',
      v: 1,
      title: 'Questions to add',
      secrecy: 'secret',
      window: { opensInSeconds: 60, votingSeconds: 60 },
      contests: [
        { id: 'chair', kind: 'irv', title: 'Chair', candidates: [{ id: 'ada', name: 'Ada' }, { id: 'ben', name: 'Ben' }] },
        { id: 'plank', kind: 'proposal', title: 'Plank', passRule: MAJORITY, proposal: { body: 'Text.' } },
      ],
    });
    let n = 0;
    const { contests, candidates } = packageContestRecords(pkg, {
      firstOrder: 4,
      newId: () => `new${++n}`,
      snapshotIds: [null, 'text1'],
      taken: { contests: new Set(['chair']), candidates: new Set(['ben']) },
    });
    expect(contests.map((c) => [c.contestId, c.order])).toEqual([
      ['new1', 4],
      ['plank', 5],
    ]);
    expect(candidates.map((k) => [k.candidateId, k.contestId])).toEqual([
      ['ada', 'new1'],
      ['new2', 'new1'],
    ]);
    expect(contests[0]!.spec).toMatchObject({ kind: 'irv', id: 'new1', candidates: ['ada', 'new2'] });
    expect(contests[1]!.proposalSnapshotId).toBe('text1');
  });
});
