import { describe, expect, it } from 'vitest';
import type { CandidateRecord, ContestRecord, ProposalSnapshotRecord } from 'ustp-domain';
import {
  blankOption,
  copyQuestion,
  linkOption,
  moveItem,
  newId,
  newQuestion,
  questionBody,
  questionContest,
  questionErrors,
  questionFromRecords,
  questionNotes,
  questionRules,
  renameOption,
  textToCapture,
  withType,
  type QuestionDraft,
} from './question-model.js';

const majority = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' as const }, base: 'yes_no' as const };

const candidate = (candidateId: string, name: string, more: Partial<CandidateRecord> = {}): CandidateRecord => ({
  candidateId,
  contestId: 'c1',
  name,
  statement: null,
  accountId: null,
  ...more,
});
const candidates = [candidate('k1', 'Ada Brooks', { accountId: 'm1', statement: 'For openness.' }), candidate('k2', 'Ben'), candidate('k3', 'Cy')];

const text: ProposalSnapshotRecord = {
  snapshotId: 'p1',
  title: 'Plank 12',
  body: 'Adopt plank 12.',
  source: null,
  contentHash: 'h',
  capturedAt: '2026-10-28T00:00:00Z',
  capturedBy: 'ea',
};

const contest = (spec: ContestRecord['spec'], more: Partial<ContestRecord> = {}): ContestRecord => ({
  contestId: 'c1',
  order: 3,
  title: 'Question',
  description: 'Why it matters.',
  spec,
  proposalSnapshotId: null,
  positionId: null,
  ...more,
});

/** A question read from records and saved untouched gives back exactly the stored contest (order aside). */
function roundTrips(record: ContestRecord) {
  const q = questionFromRecords(record, candidates, [text]);
  expect(questionErrors(q)).toEqual({});
  expect(questionContest(q)).toEqual({ ...record, order: 0, positionId: record.positionId ?? null });
  return q;
}

describe('reading and saving questions', () => {
  it('round-trips every kind of contest exactly, odd ratios included', () => {
    expect(roundTrips(contest({ kind: 'proposal', id: 'c1', passRule: majority }, { proposalSnapshotId: 'p1' })).type).toBe('yes_no');
    const odd = {
      kind: 'proposal' as const,
      id: 'c1',
      passRule: { threshold: { ratio: { num: 3, den: 5 }, comparison: 'gte' as const }, base: 'roll' as const },
      quorum: { minBallots: 40, rollRatio: { num: 1, den: 3 } },
    };
    const q = roundTrips(contest(odd, { proposalSnapshotId: 'p1' }));
    expect(q).toMatchObject({ passPreset: null, quorumPct: 33, minBallots: 40 });

    expect(roundTrips(contest({ kind: 'choose_n', id: 'c1', candidates: ['k1', 'k2'], seats: 1, maxSelections: 1 })).type).toBe('choose_one');
    const floor = { ratio: { num: 1, den: 3 }, comparison: 'gt' as const };
    const approval = roundTrips(contest({ kind: 'choose_n', id: 'c1', candidates: ['k1', 'k2', 'k3'], seats: 1, maxSelections: 3, supportFloor: floor }));
    expect(approval).toMatchObject({ type: 'choose_several', anyNumber: true, floorPct: 33 });
    const block = roundTrips(contest({ kind: 'choose_n', id: 'c1', candidates: ['k1', 'k2', 'k3'], seats: 2, maxSelections: 2 }, { positionId: 'board' }));
    expect(block).toMatchObject({ type: 'choose_several', anyNumber: false, seats: 2, maxSelections: 2, positionId: 'board' });

    expect(roundTrips(contest({ kind: 'irv', id: 'c1', candidates: ['k3', 'k1'] })).type).toBe('rank');
    expect(roundTrips(contest({ kind: 'irv', id: 'c1', candidates: ['k3', 'k1', 'k2'], maxRanks: 2 })).maxRanks).toBe(2);
  });

  it('keeps options in ballot order, with statements and links', () => {
    const q = questionFromRecords(contest({ kind: 'irv', id: 'c1', candidates: ['k3', 'k1'] }), candidates, []);
    expect(q.options).toEqual([
      { id: 'k3', name: 'Cy', statement: '', statementOpen: false, accountId: null, linkedName: null },
      { id: 'k1', name: 'Ada Brooks', statement: 'For openness.', statementOpen: true, accountId: 'm1', linkedName: 'Ada Brooks' },
    ]);
    expect(questionBody(q).candidates).toEqual([
      { candidateId: 'k3', name: 'Cy' },
      { candidateId: 'k1', name: 'Ada Brooks', statement: 'For openness.', accountId: 'm1' },
    ]);
  });

  it('turns a percentage typed in into a ratio over 100', () => {
    const q = { ...newQuestion('yes_no'), quorumPct: '25', minBallots: '' };
    expect(questionBody(q).contest).toMatchObject({ quorum: { rollRatio: { num: 25, den: 100 } } });
    const several = { ...newQuestion('choose_several'), floorPct: 10 };
    expect(questionBody(several).contest).toMatchObject({ supportFloor: { ratio: { num: 10, den: 100 }, comparison: 'gte' } });
  });
});

describe('new questions and types', () => {
  it('starts each type with the usual rules', () => {
    expect(questionBody(newQuestion('yes_no', 'q'))).toEqual({
      contest: { kind: 'proposal', title: 'Untitled question', description: '', proposalSnapshotId: null, passRule: majority },
      candidates: [],
    });
    expect(questionBody(newQuestion('choose_one', 'q')).contest).toMatchObject({ kind: 'choose_n', seats: 1, maxSelections: 1, positionId: null });
    expect(questionBody(newQuestion('choose_several', 'q')).contest).toMatchObject({ kind: 'choose_n', seats: 1, maxSelections: 2 });
    expect(questionBody(newQuestion('rank', 'q')).contest).toEqual({ kind: 'irv', title: 'Untitled question', description: '', positionId: null });
    expect(newQuestion('rank').options).toHaveLength(1);
  });

  it('lets voters tick as many as there are options in a choose-several question', () => {
    const q = newQuestion('choose_several');
    q.options = ['A', 'B', 'C'].map((name) => ({ ...blankOption(), name }));
    expect(questionBody(q).contest).toMatchObject({ seats: 1, maxSelections: 3 });
    q.anyNumber = false;
    q.maxSelections = 2;
    expect(questionBody(q).contest).toMatchObject({ maxSelections: 2 });
  });

  it('keeps the options when the type changes to yes / no and back, saving none meanwhile', () => {
    let q = newQuestion('choose_one');
    q.options[0]!.name = 'Ada';
    q = withType(q, 'yes_no');
    expect(questionBody(q).candidates).toEqual([]);
    q = withType(q, 'rank');
    expect(questionBody(q).candidates).toEqual([{ candidateId: q.options[0]!.id, name: 'Ada' }]);
  });

  it('copies a question with new IDs', () => {
    const q = newQuestion('choose_one');
    q.options[0]!.name = 'Ada';
    const copy = copyQuestion(q);
    expect(copy.id).not.toBe(q.id);
    expect(copy.options[0]!.id).not.toBe(q.options[0]!.id);
    expect(copy.options[0]!.name).toBe('Ada');
  });
});

describe('options', () => {
  it('skips empty rows when saving', () => {
    const q = newQuestion('choose_one');
    q.options = [{ ...blankOption('a'), name: 'Ada' }, blankOption('b'), { ...blankOption('c'), name: ' ' }];
    expect(questionBody(q).candidates).toEqual([{ candidateId: 'a', name: 'Ada' }]);
  });

  it('unlinks an option renamed to another name, and links one chosen from the search', () => {
    const linked = linkOption(blankOption(), { accountId: 'm1', legalName: 'Ada Brooks', preferredName: null, state: 'CA' });
    expect(linked).toMatchObject({ name: 'Ada Brooks', accountId: 'm1', linkedName: 'Ada Brooks' });
    expect(renameOption(linked, 'Ada Brooks ').accountId).toBe('m1');
    expect(renameOption(linked, 'Ada B.')).toMatchObject({ name: 'Ada B.', accountId: null, linkedName: null });
  });

  it('moves items', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'c', 'b']);
  });

  it('makes IDs the tally accepts', () => {
    const ids = new Set(Array.from({ length: 200 }, newId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
  });
});

describe('what is wrong, and what is still to do', () => {
  const draft = (more: Partial<QuestionDraft>, type: QuestionDraft['type'] = 'choose_several') => ({ ...newQuestion(type), ...more });

  it('says in plain words what stops a question being saved', () => {
    expect(questionErrors(draft({ title: '  ' }))).toEqual({ title: 'Type the question.' });
    expect(questionErrors(draft({ seats: '' }))).toEqual({ seats: 'Enter a whole number, 1 or more.' });
    expect(questionErrors(draft({ seats: 1.5 }))).toEqual({ seats: 'Enter a whole number, 1 or more.' });
    expect(questionErrors(draft({ anyNumber: false, maxSelections: 1 }))).toEqual({ maxSelections: 'Enter a whole number, 2 or more.' });
    expect(questionErrors(draft({ floorPct: 140 }))).toEqual({ floorPct: 'Enter a percentage from 1 to 100, or leave it empty.' });
    expect(questionErrors(draft({ quorumPct: 0 }, 'yes_no'))).toEqual({ quorumPct: 'Enter a percentage from 1 to 100, or leave it empty.' });
    expect(questionErrors(draft({ maxRanks: 0 }, 'rank'))).toEqual({ maxRanks: 'Enter a whole number, 1 or more, or leave it empty.' });
  });

  it('marks the option at fault', () => {
    const q = draft({});
    q.options = [
      { ...blankOption('a'), name: 'Ada', accountId: 'm1', linkedName: 'Ada' },
      blankOption('gap'),
      { ...blankOption('b'), name: 'Ada again', accountId: 'm1', linkedName: 'Ada again' },
      { ...blankOption('c'), name: 'x'.repeat(201) },
    ];
    expect(questionErrors(q)).toEqual({
      'option:b': 'This member is already another option in this question.',
      'option:c': 'Use at most 200 characters.',
    });
  });

  it('lists what is still to do before scheduling', () => {
    expect(questionNotes(newQuestion('yes_no'))).toEqual(['Write the text members vote on, or use a saved text.']);
    expect(questionNotes({ ...newQuestion('yes_no'), text: 'Adopt it.' })).toEqual([]);
    expect(questionNotes(newQuestion('rank'))).toEqual(['Add the options voters choose from.']);
    const two = (q: QuestionDraft) => ({ ...q, options: ['A', 'B'].map((name) => ({ ...blankOption(), name })) });
    expect(questionNotes(two({ ...newQuestion('choose_several'), seats: 3 }))).toEqual(['3 win, so add at least 3 options.']);
    expect(questionNotes(two({ ...newQuestion('choose_several'), anyNumber: false, maxSelections: 3 }))).toEqual([
      'Voters may choose up to 3, so add at least 3 options or lower the limit.',
    ]);
    expect(questionNotes(two({ ...newQuestion('rank'), maxRanks: 4 }))).toEqual(['Voters may rank up to 4, so add at least 4 options or lower the limit.']);
    expect(questionNotes({ ...newQuestion('choose_several'), options: [{ ...blankOption(), name: 'A' }] })).toEqual(['Add at least 2 options.']);
    expect(questionNotes(two(newQuestion('choose_one')))).toEqual([]);
  });

  it('gives the rules in the ballot’s words once the question can be saved', () => {
    expect(questionRules(newQuestion('yes_no'))).toEqual(['Passes with more than half of yes + no votes (abstentions ignored).']);
    expect(questionRules(draft({ title: '' }))).toEqual([]);
  });
});

describe('textToCapture', () => {
  const yesNo = (more: Partial<QuestionDraft>) => ({ ...newQuestion('yes_no'), ...more });

  it('captures a text typed in, or changed from the one attached', () => {
    expect(textToCapture(yesNo({ text: 'Adopt it.' }), [])).toBe(true);
    expect(textToCapture(yesNo({ text: 'Adopt plank 12.', proposalSnapshotId: 'p1' }), [text])).toBe(false);
    expect(textToCapture(yesNo({ text: 'Adopt plank 12, amended.', proposalSnapshotId: 'p1' }), [text])).toBe(true);
    expect(textToCapture(yesNo({ text: '  ' }), [])).toBe(false);
  });

  it('never replaces a bylaws amendment from here', () => {
    const amendment = { ...text, amendment: { v: 1, base: { version: '2026.1', contentHash: 'b' }, changes: [] } } as ProposalSnapshotRecord;
    expect(textToCapture(yesNo({ text: 'Other', proposalSnapshotId: 'p1' }), [amendment])).toBe(false);
  });
});
