import { describe, expect, it } from 'vitest';
import { ballotViewProblems, proposalContentHash, type ElectionDetail } from 'ustp-domain';
import { previewBallotView } from './ballot-preview.js';

const majority = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' as const }, base: 'yes_no' as const };

const detail = {
  election: {
    electionId: 'e1',
    title: 'Ballot',
    description: 'Why we vote.',
    secrecy: 'secret',
    opensAt: '2026-11-20T15:00:00.000Z',
    closesAt: '2026-11-27T15:00:00.000Z',
    kAnonymity: 10,
    state: 'draft',
  },
  contests: [
    { contestId: 'chair', order: 2, title: 'Chair', description: '', spec: { kind: 'irv', id: 'chair', candidates: ['b', 'a'] }, proposalSnapshotId: null, positionId: null },
    { contestId: 'plank', order: 1, title: 'Plank 12', description: '', spec: { kind: 'proposal', id: 'plank', passRule: majority }, proposalSnapshotId: 'p1' },
  ],
  candidates: [
    { candidateId: 'a', contestId: 'chair', name: 'Ada', statement: null, accountId: 'm1' },
    { candidateId: 'b', contestId: 'chair', name: 'Ben', statement: 'Hello.', accountId: null },
  ],
  proposals: [
    { snapshotId: 'p1', title: 'Plank 12', body: 'Adopt it.', source: null, contentHash: proposalContentHash('Plank 12', 'Adopt it.'), capturedAt: '', capturedBy: '' },
  ],
} as unknown as ElectionDetail;

describe('previewBallotView', () => {
  it('is the ballot the draft would freeze, open and not voted in', () => {
    const view = previewBallotView(detail);
    expect(view.election).toEqual({
      electionId: 'e1',
      title: 'Ballot',
      description: 'Why we vote.',
      secrecy: 'secret',
      state: 'open',
      opensAt: '2026-11-20T15:00:00.000Z',
      closesAt: '2026-11-27T15:00:00.000Z',
      castAt: null,
    });
    expect(view.definition.contests.map((c) => c.title)).toEqual(['Plank 12', 'Chair']);
    expect(view.definition.contests[1]!.candidates.map((k) => k.name)).toEqual(['Ben', 'Ada']);
    // The ballot page's own check passes, so it shows the preview as it will show the frozen ballot.
    expect(ballotViewProblems(view)).toEqual([]);
    expect(view.proposals).toEqual([{ snapshotId: 'p1', title: 'Plank 12', body: 'Adopt it.', contentHash: detail.proposals[0]!.contentHash, amendment: null }]);
  });

  it('carries nobody’s account: voters see names only', () => {
    expect(JSON.stringify(previewBallotView(detail))).not.toContain('m1');
  });
});
