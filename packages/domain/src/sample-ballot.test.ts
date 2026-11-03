import { describe, expect, it } from 'vitest';
import { ballotProblems } from './ballots.js';
import { DEMO_FIRST_NAMES, DEMO_SURNAMES } from './demo-election.js';
import { electionPackageSchema, packageProposals, packageRecords } from './election-package.js';
import { buildDefinition, validateDefinition, type ProposalSnapshotRecord } from './elections.js';
import { SAMPLE_BALLOT, SAMPLE_BALLOT_NOTE } from './sample-ballot.js';
import { randomBallot, seededRandom } from './test-votes.js';

const NOW = new Date('2026-11-02T12:00:00Z');
const pkg = electionPackageSchema.parse(SAMPLE_BALLOT);

describe('the sample ballot', () => {
  it('is a draft ready to schedule, with a ballot that can be cast', () => {
    let n = 0;
    const proposals = packageProposals(pkg).map((p, i): ProposalSnapshotRecord | null =>
      p && 'input' in p
        ? { snapshotId: `p${i}`, title: p.input.title, body: p.input.body, source: p.input.source ?? null, contentHash: p.contentHash, capturedAt: NOW.toISOString(), capturedBy: 'ea' }
        : null,
    );
    const records = packageRecords(pkg, { electionId: 'sample', createdBy: 'ea', now: NOW, newId: () => `k${++n}`, snapshotIds: proposals.map((p) => p?.snapshotId ?? null) });
    const definition = buildDefinition(records.election, records.contests, records.candidates, proposals.filter((p) => p !== null));
    expect(validateDefinition(definition, NOW)).toEqual([]);
    // Every ID is the file's own, so results and exports name the questions as the file does.
    expect(n).toBe(0);
    const ballot = randomBallot(definition, seededRandom('sample'), 0).map((s) => ({ v: 1 as const, electionId: 'sample', ...s, salt: '00'.repeat(32) }));
    expect(ballotProblems(definition, ballot)).toEqual([]);
  });

  it('has a question of every kind the ballot builder makes', () => {
    const kinds = pkg.contests.map((c) =>
      c.kind === 'choose_n' ? (c.maxSelections === 1 ? 'choose_one' : 'choose_several') : c.kind === 'irv' ? 'rank' : 'yes_no',
    );
    expect(new Set(kinds)).toEqual(new Set(['rank', 'choose_one', 'choose_several', 'yes_no']));
  });

  it('names only invented people, fills no office and says its planks are not party policy', () => {
    for (const c of pkg.contests) {
      if (c.kind === 'proposal') {
        expect(c.proposal.body!.endsWith(SAMPLE_BALLOT_NOTE)).toBe(true);
        continue;
      }
      expect(c.positionId ?? null).toBeNull();
      for (const k of c.candidates) {
        expect('accountId' in k && k.accountId).toBeFalsy();
        // People have a statement; places and "Online only" do not.
        if (!('statement' in k) || !k.statement) continue;
        const [first, last, ...rest] = k.name.split(' ');
        expect(rest).toEqual([]);
        expect(DEMO_FIRST_NAMES).toContain(first);
        expect(DEMO_SURNAMES).toContain(last);
      }
    }
  });
});
