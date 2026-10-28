import { z } from 'zod';
import { refuse, type Outcome } from './check.js';
import { candidateInputSchema, contestInputSchema } from './election-api.js';
import { contestRecord } from './election-package.js';
import type { CandidateRecord, ContestRecord } from './elections.js';

/**
 * The ballot builder's writes (design §6.5): a question, which is a contest with its options (candidates), saved whole
 * in one request, and the order of the questions. The builder names its contests and candidates itself, as an election
 * package may (§6.7), so a save can be repeated, a copy is new IDs, and undoing a delete restores exactly what was
 * deleted, IDs and definition hash included.
 */

/** A contest or candidate ID the client chooses: the `ustp-tally` pattern, as in election packages. */
export const ballotIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'use up to 64 letters, digits, - and _, starting with a letter or digit');

/** Most options one question may have; an election package allows as many candidates per contest. */
export const MAX_QUESTION_OPTIONS = 100;

const [proposalContest, chooseNContest, irvContest] = contestInputSchema.options;

/**
 * A question's rules: those of `POST …/contests`, except that a yes / no question may be saved before its text is
 * chosen (null). Like a contest without candidates, the draft then lists it among the problems that block scheduling.
 */
export const questionContestSchema = z.discriminatedUnion('kind', [
  proposalContest.extend({ proposalSnapshotId: z.string().min(1).nullable() }),
  chooseNContest,
  irvContest,
]);
export type QuestionContest = z.infer<typeof questionContestSchema>;

/** One option: a candidate with the ID the builder gave it. */
export const questionOptionSchema = candidateInputSchema.extend({ candidateId: ballotIdSchema });
export type QuestionOption = z.infer<typeof questionOptionSchema>;

/** `PUT /v1/admin/elections/{id}/questions/{contestId}`: creates the question, or replaces its rules and options. */
export const questionInputSchema = z
  .strictObject({
    contest: questionContestSchema,
    /** In ballot order. Options left out are deleted; a yes / no question has none. */
    candidates: z.array(questionOptionSchema).max(MAX_QUESTION_OPTIONS).default([]),
    /** Where a new question goes, counting from 1 (default: last). Ignored when the question exists. */
    position: z.number().int().min(1).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.contest.kind === 'proposal' && q.candidates.length) {
      ctx.addIssue({ code: 'custom', path: ['candidates'], message: 'a yes / no / abstain question has no options' });
    }
    const ids = new Set<string>();
    const accounts = new Set<string>();
    q.candidates.forEach((k, i) => {
      if (ids.has(k.candidateId)) ctx.addIssue({ code: 'custom', path: ['candidates', i, 'candidateId'], message: `another option is ${k.candidateId}` });
      ids.add(k.candidateId);
      if (!k.accountId) return;
      if (accounts.has(k.accountId)) {
        ctx.addIssue({ code: 'custom', path: ['candidates', i, 'accountId'], message: 'this member is already an option in this question' });
      }
      accounts.add(k.accountId);
    });
  });
export type QuestionInput = z.infer<typeof questionInputSchema>;

/** `PUT /v1/admin/elections/{id}/question-order`: every question of the ballot, once each, in their new order. */
export const questionOrderSchema = z.strictObject({
  contestIds: z.array(ballotIdSchema).max(200),
});
export type QuestionOrderInput = z.infer<typeof questionOrderSchema>;

/** A question as the api returns it after saving: the contest and its options in ballot order. */
export interface SavedQuestion {
  readonly contest: ContestRecord;
  readonly candidates: readonly CandidateRecord[];
}

/** A new order for one contest. */
export interface OrderChange {
  readonly contestId: string;
  readonly order: number;
}

/** What saving a question writes. */
export interface QuestionPlan {
  readonly contest: ContestRecord;
  /** The question's options in ballot order, created or replaced. */
  readonly candidates: readonly CandidateRecord[];
  /** Options the question had that the save leaves out. */
  readonly removed: readonly string[];
  /** Other contests renumbered to make room for a new question placed among them. */
  readonly reordered: readonly OrderChange[];
  /** Accounts the save links that were not linked to that option before, to check as Active members (§6.5). */
  readonly newLinks: readonly string[];
}

/**
 * The records a question save writes. `current` is the stored contest (null to create it), `contests` every contest of
 * the election, `options` the candidates stored under this contest, and `listed` the stored candidate for each ID the
 * save lists (null where there is none yet). Refused when a listed ID is another question's option, or when the admin
 * links their own account (recusal, §10.1).
 */
export function planQuestion(args: {
  readonly contestId: string;
  readonly input: QuestionInput;
  readonly current: ContestRecord | null;
  readonly contests: readonly ContestRecord[];
  readonly options: readonly CandidateRecord[];
  readonly listed: readonly (CandidateRecord | null)[];
  readonly actor: string;
}): Outcome<QuestionPlan> {
  const { contestId, input, current, contests, options, listed, actor } = args;
  const foreign = listed.find((k) => k && k.contestId !== contestId);
  if (foreign) return refuse('conflict', `option ${foreign.candidateId} belongs to another question`);
  if (input.candidates.some((k) => k.accountId === actor)) {
    return refuse('forbidden', 'you cannot add yourself as a candidate in an election you administer');
  }

  const candidates = input.candidates.map(
    (k): CandidateRecord => ({
      candidateId: k.candidateId,
      contestId,
      name: k.name,
      statement: k.statement || null,
      accountId: k.accountId ?? null,
    }),
  );
  const kept = new Set(candidates.map((k) => k.candidateId));
  const before = new Map(options.map((k) => [k.candidateId, k]));
  const newLinks = candidates.flatMap((k) => (k.accountId && before.get(k.candidateId)?.accountId !== k.accountId ? [k.accountId] : []));

  const others = contests.filter((c) => c.contestId !== contestId);
  let order = current?.order ?? Math.max(0, ...others.map((c) => c.order)) + 1;
  let reordered: OrderChange[] = [];
  if (!current && input.position !== undefined) {
    const sorted = [...others].sort(byOrder);
    const at = Math.min(input.position, sorted.length + 1) - 1;
    order = at + 1;
    reordered = renumber([...sorted.slice(0, at).map((c) => c.contestId), contestId, ...sorted.slice(at).map((c) => c.contestId)], others);
  }

  return {
    ok: true,
    value: {
      contest: contestRecord(contestId, order, input.contest, candidates.map((k) => k.candidateId)),
      candidates,
      removed: options.filter((k) => !kept.has(k.candidateId)).map((k) => k.candidateId),
      reordered,
      newLinks,
    },
  };
}

/**
 * The orders that put the questions in `contestIds` order (1, 2, 3, …), for the contests whose order changes. Refused
 * unless the list names every question exactly once: the ballot changed since the builder loaded it.
 */
export function planQuestionOrder(contests: readonly ContestRecord[], contestIds: readonly string[]): Outcome<readonly OrderChange[]> {
  const stored = new Set(contests.map((c) => c.contestId));
  const listed = new Set(contestIds);
  if (listed.size !== contestIds.length || listed.size !== stored.size || [...listed].some((id) => !stored.has(id))) {
    return refuse('conflict', 'the questions on the ballot have changed since this page loaded them; reload it');
  }
  return { ok: true, value: renumber(contestIds, contests) };
}

const byOrder = (a: ContestRecord, b: ContestRecord) => a.order - b.order || a.contestId.localeCompare(b.contestId);

/** Orders 1, 2, 3, … for `ids`, keeping only the stored contests whose order changes. */
function renumber(ids: readonly string[], contests: readonly ContestRecord[]): OrderChange[] {
  const orderOf = new Map(contests.map((c) => [c.contestId, c.order]));
  return ids.flatMap((contestId, i) => (orderOf.has(contestId) && orderOf.get(contestId) !== i + 1 ? [{ contestId, order: i + 1 }] : []));
}
