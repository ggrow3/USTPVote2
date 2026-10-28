import { describe, expect, it } from 'vitest';
import { planQuestion, planQuestionOrder, questionInputSchema, questionOrderSchema, type QuestionInput } from './ballot-questions.js';
import type { CandidateRecord, ContestRecord } from './elections.js';

const majority = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' as const }, base: 'yes_no' as const };

const contest = (contestId: string, order: number): ContestRecord => ({
  contestId,
  order,
  title: contestId,
  description: '',
  spec: { kind: 'proposal', id: contestId, passRule: majority },
  proposalSnapshotId: null,
  positionId: null,
});

const candidate = (candidateId: string, contestId: string, accountId: string | null = null): CandidateRecord => ({
  candidateId,
  contestId,
  name: candidateId,
  statement: null,
  accountId,
});

const chooseOne = (candidates: QuestionInput['candidates'], position?: number): QuestionInput =>
  questionInputSchema.parse({
    contest: { kind: 'choose_n', title: 'Chair', seats: 1, maxSelections: 1 },
    candidates,
    ...(position !== undefined && { position }),
  });

describe('questionInputSchema', () => {
  it('takes a yes / no question whose text is not chosen yet', () => {
    const q = questionInputSchema.parse({ contest: { kind: 'proposal', title: 'Plank 1', proposalSnapshotId: null, passRule: majority } });
    expect(q.contest).toMatchObject({ kind: 'proposal', proposalSnapshotId: null, description: '' });
    expect(q.candidates).toEqual([]);
  });

  it('refuses options on a yes / no question', () => {
    const r = questionInputSchema.safeParse({
      contest: { kind: 'proposal', title: 'Plank 1', proposalSnapshotId: null, passRule: majority },
      candidates: [{ candidateId: 'a', name: 'Ada' }],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('a yes / no / abstain question has no options');
  });

  it('refuses the same option ID twice, and the same member twice', () => {
    const r = questionInputSchema.safeParse({
      contest: { kind: 'irv', title: 'Chair' },
      candidates: [
        { candidateId: 'a', name: 'Ada', accountId: 'm1' },
        { candidateId: 'a', name: 'Ben' },
        { candidateId: 'c', name: 'Ada B.', accountId: 'm1' },
      ],
    });
    expect(r.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['candidates.1.candidateId', 'another option is a'],
      ['candidates.2.accountId', 'this member is already an option in this question'],
    ]);
  });

  it('refuses option IDs outside the tally pattern, and empty names', () => {
    const r = questionInputSchema.safeParse({
      contest: { kind: 'irv', title: 'Chair' },
      candidates: [{ candidateId: '-x', name: 'Ada' }, { candidateId: 'b', name: '  ' }],
    });
    expect(r.error?.issues.map((i) => i.path.join('.'))).toEqual(['candidates.0.candidateId', 'candidates.1.name']);
  });

  it('refuses an empty question title', () => {
    expect(questionInputSchema.safeParse({ contest: { kind: 'irv', title: ' ' } }).error?.issues[0]?.message).toBe('enter a title');
  });
});

describe('questionOrderSchema', () => {
  it('takes contest IDs', () => {
    expect(questionOrderSchema.parse({ contestIds: ['a', 'b'] })).toEqual({ contestIds: ['a', 'b'] });
    expect(questionOrderSchema.safeParse({ contestIds: ['a b'] }).success).toBe(false);
  });
});

describe('planQuestion', () => {
  const contests = [contest('one', 1), contest('two', 2), contest('three', 4)];

  it('creates a question last, without touching the others', () => {
    const plan = planQuestion({
      contestId: 'new',
      input: chooseOne([{ candidateId: 'a', name: 'Ada' }]),
      current: null,
      contests,
      options: [],
      listed: [null],
      actor: 'me',
    });
    expect(plan.ok && plan.value.contest).toMatchObject({ contestId: 'new', order: 5, spec: { kind: 'choose_n', candidates: ['a'] } });
    expect(plan.ok && plan.value.reordered).toEqual([]);
    expect(plan.ok && plan.value.candidates).toEqual([{ candidateId: 'a', contestId: 'new', name: 'Ada', statement: null, accountId: null }]);
  });

  it('creates a question at a position, renumbering the questions from there', () => {
    const plan = planQuestion({ contestId: 'new', input: chooseOne([], 2), current: null, contests, options: [], listed: [], actor: 'me' });
    expect(plan.ok && plan.value.contest.order).toBe(2);
    // "three" is already 4th (orders may have gaps after a delete), so it is not written.
    expect(plan.ok && plan.value.reordered).toEqual([{ contestId: 'two', order: 3 }]);
  });

  it('puts a position past the end last', () => {
    const plan = planQuestion({ contestId: 'new', input: chooseOne([], 9), current: null, contests, options: [], listed: [], actor: 'me' });
    expect(plan.ok && plan.value.contest.order).toBe(4);
    expect(plan.ok && plan.value.reordered).toEqual([{ contestId: 'three', order: 3 }]);
  });

  it('keeps an existing question where it is, replacing its options', () => {
    const stored = [candidate('a', 'two', 'm1'), candidate('b', 'two')];
    const plan = planQuestion({
      contestId: 'two',
      input: chooseOne([
        { candidateId: 'c', name: 'Cy', accountId: 'm3' },
        { candidateId: 'a', name: 'Ada', accountId: 'm1', statement: 'Hello' },
      ], 1),
      current: contests[1]!,
      contests,
      options: stored,
      listed: [null, stored[0]!],
      actor: 'me',
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.contest).toMatchObject({ order: 2, spec: { candidates: ['c', 'a'] } });
    expect(plan.value.removed).toEqual(['b']);
    expect(plan.value.reordered).toEqual([]);
    expect(plan.value.candidates[1]).toEqual({ candidateId: 'a', contestId: 'two', name: 'Ada', statement: 'Hello', accountId: 'm1' });
    // Only the link that is new is checked again: a linked member whose status changed later stays linked (§6.5).
    expect(plan.value.newLinks).toEqual(['m3']);
  });

  it('checks a link that changed to another member', () => {
    const stored = [candidate('a', 'two', 'm1')];
    const plan = planQuestion({
      contestId: 'two',
      input: chooseOne([{ candidateId: 'a', name: 'Ada', accountId: 'm2' }]),
      current: contests[1]!,
      contests,
      options: stored,
      listed: stored,
      actor: 'me',
    });
    expect(plan.ok && plan.value.newLinks).toEqual(['m2']);
  });

  it('turns a candidate question into a yes / no one, removing its options', () => {
    const stored = [candidate('a', 'two')];
    const plan = planQuestion({
      contestId: 'two',
      input: questionInputSchema.parse({ contest: { kind: 'proposal', title: 'Plank', proposalSnapshotId: 'p1', passRule: majority } }),
      current: contests[1]!,
      contests,
      options: stored,
      listed: [],
      actor: 'me',
    });
    expect(plan.ok && plan.value.removed).toEqual(['a']);
    expect(plan.ok && plan.value.contest).toMatchObject({ proposalSnapshotId: 'p1', spec: { kind: 'proposal' } });
  });

  it('refuses an option that belongs to another question', () => {
    const plan = planQuestion({
      contestId: 'two',
      input: chooseOne([{ candidateId: 'x', name: 'X' }]),
      current: contests[1]!,
      contests,
      options: [],
      listed: [candidate('x', 'one')],
      actor: 'me',
    });
    expect(plan).toEqual({ ok: false, refusal: 'conflict', reason: 'option x belongs to another question' });
  });

  it('refuses linking your own account', () => {
    const plan = planQuestion({
      contestId: 'two',
      input: chooseOne([{ candidateId: 'x', name: 'Me', accountId: 'me' }]),
      current: contests[1]!,
      contests,
      options: [],
      listed: [null],
      actor: 'me',
    });
    expect(plan).toMatchObject({ ok: false, refusal: 'forbidden' });
  });
});

describe('planQuestionOrder', () => {
  const contests = [contest('one', 1), contest('two', 2), contest('three', 4)];

  it('renumbers the questions in the order given, writing only those that change', () => {
    expect(planQuestionOrder(contests, ['two', 'one', 'three'])).toEqual({
      ok: true,
      value: [
        { contestId: 'two', order: 1 },
        { contestId: 'one', order: 2 },
        { contestId: 'three', order: 3 },
      ],
    });
    expect(planQuestionOrder(contests.slice(0, 2), ['one', 'two'])).toEqual({ ok: true, value: [] });
  });

  it('refuses a list that is not every question once', () => {
    for (const ids of [['one', 'two'], ['one', 'two', 'three', 'four'], ['one', 'one', 'three'], ['one', 'two', 'four']]) {
      expect(planQuestionOrder(contests, ids)).toMatchObject({ ok: false, refusal: 'conflict' });
    }
  });
});
