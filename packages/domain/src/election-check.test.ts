import { describe, expect, it } from 'vitest';
import { electionCheckChanges, positionsHash, publicElectionCheck, type ElectionCheckBasis, type ElectionCheckRecord } from './election-check.js';
import { KIND_LABELS, rulesText, thresholdText } from './election-text.js';
import { definitionAdvisories, type ElectionDefinition } from './elections.js';
import type { PositionRecord } from './positions.js';

const AT = '2026-11-01T12:00:00.000Z';
const office = (positionId: string, seats: number, termMonths = 24): PositionRecord => ({
  positionId,
  title: positionId === 'board' ? 'Board' : 'Chair',
  description: '',
  seats,
  termMonths,
  definedAt: AT,
  approvalId: 'a1',
});

const definition: ElectionDefinition = {
  v: 1,
  electionId: 'e1',
  title: 'Officers',
  description: '',
  secrecy: 'secret',
  opensAt: AT,
  closesAt: AT,
  kAnonymity: 2,
  contests: [
    {
      contestId: 'plank',
      title: 'Plank 12',
      description: '',
      spec: { kind: 'proposal', id: 'plank', passRule: { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' } },
      proposal: { snapshotId: 'p1', title: 'Plank 12', contentHash: '0'.repeat(64) },
      candidates: [],
      positionId: null,
    },
    {
      contestId: 'board',
      title: 'Board',
      description: '',
      spec: { kind: 'choose_n', id: 'board', candidates: ['a', 'b', 'c'], seats: 2, maxSelections: 2 },
      proposal: null,
      candidates: [],
      positionId: 'board',
    },
    {
      contestId: 'chair',
      title: 'Chair',
      description: '',
      spec: { kind: 'irv', id: 'chair', candidates: ['a', 'b'] },
      proposal: null,
      candidates: [],
      positionId: 'chair',
    },
  ],
};

describe('definition advisories', () => {
  it('point out contests electing a different number of people than their office has seats', () => {
    expect(definitionAdvisories(definition, [office('board', 2), office('chair', 1)])).toEqual([]);
    expect(definitionAdvisories(definition, [office('board', 3), office('chair', 2)])).toEqual([
      '“Board” elects 2, but the office Board has 3 seats. That is right when filling only some seats; otherwise change the contest.',
      '“Chair” is ranked choice, which elects one person, but the office Chair has 2 seats. That is right when filling one seat; otherwise use a choose-candidates contest.',
    ]);
  });

  it('say nothing about offices they cannot see', () => {
    expect(definitionAdvisories(definition, [])).toEqual([]);
  });
});

describe('election check basis', () => {
  const basis: ElectionCheckBasis = {
    definitionHash: 'd'.repeat(64),
    bylaws: { version: '2026.1', contentHash: 'b'.repeat(64) },
    positionsHash: positionsHash([office('board', 2), office('chair', 1)]),
  };

  it('hashes offices regardless of order, and changes with seats or term', () => {
    expect(positionsHash([office('chair', 1), office('board', 2)])).toBe(basis.positionsHash);
    expect(positionsHash([office('board', 3), office('chair', 1)])).not.toBe(basis.positionsHash);
    expect(positionsHash([office('board', 2, 12), office('chair', 1)])).not.toBe(basis.positionsHash);
  });

  it('names what changed since a check', () => {
    expect(electionCheckChanges(basis, basis)).toEqual([]);
    expect(electionCheckChanges(null, basis)).toEqual([]);
    expect(electionCheckChanges(basis, { ...basis, definitionHash: 'e'.repeat(64) })).toEqual(['election']);
    expect(electionCheckChanges(basis, { ...basis, bylaws: { version: '2026.2', contentHash: 'c'.repeat(64) }, positionsHash: 'x' })).toEqual([
      'bylaws',
      'offices',
    ]);
  });

  it('shows every user the notes, but not who asked, what it cost or why it failed', () => {
    const record: ElectionCheckRecord = {
      checkId: 'c1',
      electionId: 'e1',
      status: 'done',
      requestedBy: 'admin-account',
      requestedAt: AT,
      startedAt: AT,
      finishedAt: AT,
      checker: 'claude',
      model: 'claude-opus-5-5',
      basis,
      findings: [{ contestId: 'plank', bylawsLines: [3], topic: 'pass-threshold', severity: 'high', explanation: 'Needs two-thirds.' }],
      quotedLines: [{ line: 3, text: 'Amendments need two-thirds.' }],
      summary: 'One mismatch.',
      error: null,
      usage: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    };
    const shown = publicElectionCheck(record);
    expect(shown).toEqual({
      checkId: 'c1',
      electionId: 'e1',
      finishedAt: AT,
      checker: 'claude',
      model: 'claude-opus-5-5',
      basis,
      findings: record.findings,
      quotedLines: record.quotedLines,
      summary: 'One mismatch.',
    });
    expect(JSON.stringify(shown)).not.toContain('admin-account');
  });
});

describe('rules wording', () => {
  it('lives in the domain, for the pages and the check alike', () => {
    expect(rulesText(definition.contests[0]!.spec)).toEqual(['Passes with more than half of yes + no votes (abstentions ignored).']);
    expect(rulesText(definition.contests[1]!.spec)).toEqual(['Elect 2; voters choose up to 2.']);
    expect(thresholdText({ ratio: { num: 2, den: 3 }, comparison: 'gte' })).toBe('at least two-thirds');
    expect(KIND_LABELS.irv).toBe('Ranked choice (instant runoff)');
  });
});
