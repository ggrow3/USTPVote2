import { describe, expect, it } from 'vitest';
import type { BylawsAmendment } from './amendments.js';
import {
  CONSISTENCY_CHECK_TIMEOUT_MINUTES,
  MAX_CONSISTENCY_CHECKS_PER_DAY,
  MAX_PASSAGE_CHARACTERS,
  checkConsistencyRequest,
  consistencyCheckId,
  consistencyMaterial,
  contestText,
  materialCharacters,
  tidyConsistencyFindings,
  type ConsistencyFinding,
} from './consistency-check.js';
import type { ElectionDefinition } from './elections.js';

const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' as const }, base: 'yes_no' as const };
const amendment: BylawsAmendment = {
  v: 1,
  base: { version: '2026.1', contentHash: 'ab'.repeat(32) },
  changes: [{ op: 'replace', from: 2, to: 2, expect: ['Two officers.'], lines: ['Three officers.'] }],
};

const definition: Pick<ElectionDefinition, 'contests'> = {
  contests: [
    {
      contestId: 'plank',
      title: 'Question I. Section E9-C: Reversible cryopreservation',
      description: '',
      spec: { kind: 'proposal', id: 'plank', passRule: MAJORITY },
      proposal: { snapshotId: 'p1', title: 'Section E9-C', contentHash: 'cd'.repeat(32) },
      candidates: [],
      positionId: null,
    },
    {
      contestId: 'chair',
      title: 'Chair',
      description: '',
      spec: { kind: 'irv', id: 'chair', candidates: ['alex'] },
      proposal: null,
      candidates: [{ candidateId: 'alex', name: 'Alex Rivera', statement: 'I will chair well.' }],
      positionId: 'chair',
    },
    {
      contestId: 'xi',
      title: 'Question XI. Section XXVII: Electing the President',
      description: 'Leave it blank to abstain.',
      spec: { kind: 'choose_n', id: 'xi', candidates: ['keep', 'amend'], seats: 1, maxSelections: 1 },
      proposal: null,
      candidates: [
        { candidateId: 'keep', name: 'Keep the current Section XXVII', statement: null },
        { candidateId: 'amend', name: 'Amendment XXVII-1: Ranked-preference voting', statement: 'Decide by ranked-preference voting.' },
      ],
      positionId: null,
    },
    {
      contestId: 'amend',
      title: 'Bylaw Amendment 3',
      description: '',
      spec: { kind: 'proposal', id: 'amend', passRule: MAJORITY },
      proposal: { snapshotId: 'p2', title: 'Three officers', contentHash: 'ef'.repeat(32), amendsBylaws: amendment.base },
      candidates: [],
      positionId: null,
    },
  ],
};
const proposals = [
  { snapshotId: 'p1', title: 'Section E9-C', body: 'Calls for $10 billion a year of research funding for reversible cryopreservation.' },
  { snapshotId: 'p2', title: 'Three officers', body: 'We need a third officer.', amendment },
];
const material = consistencyMaterial(definition, proposals);

const finding = (contests: number[], extra: Partial<ConsistencyFinding> = {}): ConsistencyFinding => ({
  contests,
  source: 'platform',
  provision: ' Article VI, Section CIV ',
  passage: null,
  severity: 'medium',
  explanation: ' Conflicts. ',
  ...extra,
});

describe('consistencyMaterial', () => {
  it('keeps proposals and option questions in ballot order, numbered over every contest, and leaves out offices', () => {
    expect(material.map((c) => [c.position, c.contestId, c.kind])).toEqual([
      [1, 'plank', 'proposal'],
      [3, 'xi', 'choose_n'],
      [4, 'amend', 'proposal'],
    ]);
    expect(material[0]!.proposal).toEqual({ title: 'Section E9-C', body: proposals[0]!.body, amendment: null });
    expect(material[1]).toMatchObject({ seats: 1, maxSelections: 1, proposal: null });
    expect(material[1]!.options.map((o) => o.name)).toEqual(['Keep the current Section XXVII', 'Amendment XXVII-1: Ranked-preference voting']);
  });

  it('gives an amendment its changed lines in words', () => {
    expect(material[2]!.proposal!.amendment).toMatch(/^Amends bylaws version 2026\.1.*\n1\. Replace line 2:\n {3}was: Two officers\.\n {3}now: Three officers\.$/s);
  });

  it('is empty for a ballot that only fills offices', () => {
    expect(consistencyMaterial({ contests: [definition.contests[1]!] }, [])).toEqual([]);
  });

  it('counts every word a finding could quote', () => {
    expect(contestText(material[1]!)).toBe(
      'Question XI. Section XXVII: Electing the President\nLeave it blank to abstain.\nKeep the current Section XXVII\n' +
        'Amendment XXVII-1: Ranked-preference voting\nDecide by ranked-preference voting.',
    );
    expect(materialCharacters(material)).toBe(material.reduce((n, c) => n + contestText(c).length, 0));
  });
});

describe('tidyConsistencyFindings', () => {
  it('keeps questions that were reviewed, deduplicated and ascending, the most severe first', () => {
    const tidy = tidyConsistencyFindings(
      [finding([4, 1, 1, 2, 99], { severity: 'low' }), finding([2]), finding([3], { severity: 'high' })],
      material,
    );
    expect(tidy.map((f) => [f.severity, f.contests])).toEqual([
      ['high', [3]],
      ['low', [1, 4]],
    ]);
    expect(tidy[0]).toMatchObject({ provision: 'Article VI, Section CIV', explanation: 'Conflicts.' });
  });

  it('needs two questions for a conflict within the ballot, and an explanation', () => {
    const tidy = tidyConsistencyFindings(
      [finding([1], { source: 'ballot' }), finding([1, 3], { source: 'ballot' }), finding([4], { explanation: '  ' })],
      material,
    );
    expect(tidy.map((f) => f.contests)).toEqual([[1, 3]]);
  });

  it('keeps a passage only if one of its questions has those words', () => {
    const [exact, spaced, elsewhere, invented] = tidyConsistencyFindings(
      [
        finding([1], { passage: '“$10 billion a year of research funding”' }),
        finding([3], { passage: 'Decide  by\nranked-preference voting.', severity: 'low' }),
        finding([4], { passage: '$10 billion a year', severity: 'low' }),
        finding([4], { passage: 'Abolish the officers.', severity: 'low' }),
      ],
      material,
    );
    expect(exact!.passage).toBe('$10 billion a year of research funding');
    expect(spaced!.passage).toBe('Decide by ranked-preference voting.');
    expect(elsewhere!.passage).toBeNull(); // in question 1, not 4
    expect(invented!.passage).toBeNull();
    const long = tidyConsistencyFindings([finding([1], { passage: 'x'.repeat(MAX_PASSAGE_CHARACTERS + 50) })], material);
    expect(long[0]!.passage).toBeNull();
  });
});

describe('the once-per-election rule', () => {
  const now = new Date('2026-10-27T12:00:00.000Z');
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

  it('lets a person ask once', () => {
    expect(checkConsistencyRequest(null, 0, now)).toEqual({ ok: true });
  });

  it('refuses a second check once one has finished, whatever it found', () => {
    expect(checkConsistencyRequest({ status: 'done', requestedAt: ago(60 * 24 * 30), startedAt: ago(60) }, 0, now)).toMatchObject({
      ok: false,
      refusal: 'conflict',
      reason: expect.stringMatching(/already run the consistency check for this election; each person may run it once/),
    });
  });

  it('refuses while one is under way, until it has run too long', () => {
    expect(checkConsistencyRequest({ status: 'queued', requestedAt: ago(1), startedAt: null }, 0, now)).toMatchObject({
      ok: false,
      refusal: 'conflict',
      reason: expect.stringMatching(/still running/),
    });
    expect(checkConsistencyRequest({ status: 'running', requestedAt: ago(30), startedAt: ago(2) }, 0, now)).toMatchObject({ ok: false });
    expect(
      checkConsistencyRequest({ status: 'running', requestedAt: ago(30), startedAt: ago(CONSISTENCY_CHECK_TIMEOUT_MINUTES + 1) }, 0, now),
    ).toEqual({ ok: true });
  });

  it('does not count a check that failed', () => {
    expect(checkConsistencyRequest({ status: 'failed', requestedAt: ago(5), startedAt: ago(4) }, 0, now)).toEqual({ ok: true });
  });

  it('stops every new check once the server has run its daily number', () => {
    expect(checkConsistencyRequest(null, MAX_CONSISTENCY_CHECKS_PER_DAY - 1, now)).toEqual({ ok: true });
    expect(checkConsistencyRequest(null, MAX_CONSISTENCY_CHECKS_PER_DAY, now)).toMatchObject({ ok: false, refusal: 'rate_limited' });
    // A finished check is still refused as a repeat, not as the daily limit.
    expect(checkConsistencyRequest({ status: 'done', requestedAt: ago(5), startedAt: ago(4) }, MAX_CONSISTENCY_CHECKS_PER_DAY, now)).toMatchObject({
      refusal: 'conflict',
    });
  });

  it('keys the record by election and person', () => {
    expect(consistencyCheckId('e1', 'a1')).toBe('e1_a1');
  });
});
