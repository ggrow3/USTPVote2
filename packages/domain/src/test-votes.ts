import { sha256Hex } from 'ustp-audit';
import { z } from 'zod';
import { hex32Schema } from './api.js';
import { ballotProblems } from './ballots.js';
import type { ElectionDefinition } from './elections.js';
import type { ResultsBundle } from './results.js';
import { MAX_TEST_VOTERS } from './testing.js';

/**
 * Test votes (`ustp.test-votes` v1, design §10.4): the ballots test voters cast in a rehearsal, and what the results
 * should then be. Only ever cast by test voter personas, through the ordinary ballot endpoint; no endpoint takes a
 * votes file.
 */

export const TEST_VOTES_FORMAT = 'ustp.test-votes';

const PROPOSAL_CHOICES = ['yes', 'no', 'abstain'] as const;
const OUTCOMES = ['passed', 'failed', 'no_quorum'] as const;
const name = z.string().min(1).max(200);

/**
 * A voter's answer to one contest: `yes`, `no` or `abstain` for a proposal; the candidates chosen (choose-N) or
 * ranked (IRV) by name or ID, `[]` for a blank; or `random`.
 */
const choiceSchema = z.union([z.enum([...PROPOSAL_CHOICES, 'random']), z.array(name).max(100)]);

export const testVotesSchema = z
  .strictObject({
    format: z.literal(TEST_VOTES_FORMAT),
    v: z.literal(1),
    description: z.string().max(2000).optional(),
    /** Test voter N casts these choices, by contest ID or title; a contest left out is skipped. */
    ballots: z
      .array(z.strictObject({ voter: z.number().int().min(1).max(MAX_TEST_VOTERS), choices: z.record(name, choiceSchema) }))
      .max(MAX_TEST_VOTERS)
      .default([]),
    /** Test voters 1 to `voters` without a ballot above cast a random one; the same each time with a `seed`. */
    random: z
      .strictObject({
        voters: z.number().int().min(1).max(MAX_TEST_VOTERS),
        seed: z.string().min(1).max(200).optional(),
        /** The chance that a random ballot skips a contest. */
        skipRate: z.number().min(0).max(0.9).default(0.1),
      })
      .optional(),
    /** What the results must be, by contest ID or title: a proposal's outcome, or the winners by name or ID. */
    expect: z.record(name, z.union([z.enum(OUTCOMES), z.array(name).max(100)])).optional(),
    /** SHA-256 of the bylaws the passed amendments give (design §6.6). */
    expectBylawsSha256: hex32Schema.optional(),
  })
  .superRefine((file, ctx) => {
    const voters = new Set<number>();
    file.ballots.forEach((b, i) => {
      if (voters.has(b.voter)) ctx.addIssue({ code: 'custom', path: ['ballots', i, 'voter'], message: `test voter ${b.voter} already has a ballot` });
      voters.add(b.voter);
    });
    if (!file.ballots.length && !file.random) ctx.addIssue({ code: 'custom', message: 'give ballots, random, or both' });
  });

export type TestVotes = z.output<typeof testVotesSchema>;
export type TestVotesInput = z.input<typeof testVotesSchema>;

/** One test voter's ballot: a selection per answered contest, ready to be salted and cast. */
export interface PlannedBallot {
  readonly voter: number;
  readonly selections: readonly { readonly contestId: string; readonly selection: unknown }[];
}

/** A random number generator in [0, 1). */
export type Random = () => number;

/** The same sequence for the same seed, everywhere: SHA-256 of `seed:n`, as a number in [0, 1). */
export function seededRandom(seed: string): Random {
  let n = 0;
  return () => parseInt(sha256Hex(`${seed}:${n++}`).slice(0, 12), 16) / 2 ** 48;
}

type Contest = ElectionDefinition['contests'][number];
const quote = (s: string) => `"${s}"`;

/** A contest by ID, else by title; a title two contests share must be given as an ID. */
function findContest(definition: ElectionDefinition, key: string): Contest | string {
  const byId = definition.contests.find((c) => c.contestId === key);
  if (byId) return byId;
  const titled = definition.contests.filter((c) => c.title === key);
  if (titled.length === 1) return titled[0]!;
  return titled.length ? `${titled.length} contests are titled ${quote(key)}; use the contest ID` : `there is no contest ${quote(key)}`;
}

/** Candidate IDs for names or IDs, in the order given. */
function findCandidates(contest: Contest, keys: readonly string[]): string[] | string {
  const ids: string[] = [];
  for (const key of keys) {
    const byId = contest.candidates.find((k) => k.candidateId === key);
    const named = contest.candidates.filter((k) => k.name === key);
    if (byId) ids.push(byId.candidateId);
    else if (named.length === 1) ids.push(named[0]!.candidateId);
    else return named.length ? `${named.length} candidates are named ${quote(key)}; use the candidate ID` : `there is no candidate ${quote(key)}`;
  }
  return ids;
}

/** A random answer to `contest`, as the dev seed's ballots were: mostly yes, and a few candidates in random order. */
function randomSelection(contest: Contest, random: Random): unknown {
  if (contest.spec.kind === 'proposal') return (['yes', 'yes', 'yes', 'no', 'no', 'abstain'] as const)[Math.floor(random() * 6)];
  const ids = contest.candidates.map((k) => k.candidateId);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  const max = Math.min(contest.spec.kind === 'choose_n' ? contest.spec.maxSelections : (contest.spec.maxRanks ?? ids.length), ids.length);
  return max ? ids.slice(0, 1 + Math.floor(random() * max)) : [];
}

/** A plausible random ballot that answers at least one contest, skipping each with probability `skipRate`. */
export function randomBallot(definition: ElectionDefinition, random: Random, skipRate = 0.1): PlannedBallot['selections'] {
  const answered = definition.contests.filter(() => random() >= skipRate);
  const chosen = answered.length || !definition.contests.length ? answered : [definition.contests[Math.floor(random() * definition.contests.length)]!];
  return chosen.map((c) => ({ contestId: c.contestId, selection: randomSelection(c, random) }));
}

/**
 * The ballots a votes file casts in an election: names and titles resolved to IDs, `random` filled in, and every
 * ballot checked as the api would check it. A seed makes it the same every time; otherwise `random` decides.
 */
export function planTestBallots(
  file: TestVotes,
  definition: ElectionDefinition,
  random: Random = Math.random,
): { ok: true; ballots: PlannedBallot[] } | { ok: false; problems: string[] } {
  const rng = file.random?.seed ? seededRandom(file.random.seed) : random;
  const problems: string[] = [];
  const ballots: PlannedBallot[] = [];
  const voters = new Set([...file.ballots.map((b) => b.voter), ...Array.from({ length: file.random?.voters ?? 0 }, (_, i) => i + 1)]);
  for (const voter of [...voters].sort((a, b) => a - b)) {
    const given = file.ballots.find((b) => b.voter === voter);
    const label = `test voter ${voter}`;
    const before = problems.length;
    let selections: PlannedBallot['selections'];
    if (!given) selections = randomBallot(definition, rng, file.random?.skipRate);
    else {
      const resolved: { contestId: string; selection: unknown }[] = [];
      for (const [key, choice] of Object.entries(given.choices)) {
        const contest = findContest(definition, key);
        if (typeof contest === 'string') {
          problems.push(`${label}: ${contest}`);
          continue;
        }
        let selection: unknown;
        if (choice === 'random') selection = randomSelection(contest, rng);
        else if (contest.spec.kind === 'proposal') {
          if (Array.isArray(choice)) {
            problems.push(`${label}: ${quote(contest.title)} is a proposal; answer yes, no or abstain`);
            continue;
          }
          selection = choice;
        } else if (!Array.isArray(choice)) {
          problems.push(`${label}: ${quote(contest.title)} takes a list of candidates, not ${choice}`);
          continue;
        } else {
          selection = findCandidates(contest, choice);
          if (typeof selection === 'string') {
            problems.push(`${label}: ${quote(contest.title)}: ${selection}`);
            continue;
          }
        }
        resolved.push({ contestId: contest.contestId, selection });
      }
      selections = resolved;
    }
    if (!selections.length && problems.length === before) problems.push(`${label}: the ballot answers no contest`);
    const parts = selections.map((s) => ({ v: 1 as const, electionId: definition.electionId, ...s, salt: '0'.repeat(64) }));
    problems.push(...ballotProblems(definition, parts).map((p) => `${label}: ${p}`));
    ballots.push({ voter, selections });
  }
  return problems.length ? { ok: false, problems } : { ok: true, ballots };
}

/** How the results differ from what a votes file expects; empty when they match. Winners match in any order. */
export function expectedResultProblems(expect: TestVotes['expect'], definition: ElectionDefinition, bundle: Pick<ResultsBundle, 'contests'>): string[] {
  const problems: string[] = [];
  for (const [key, expected] of Object.entries(expect ?? {})) {
    const contest = findContest(definition, key);
    if (typeof contest === 'string') {
      problems.push(contest);
      continue;
    }
    const result = bundle.contests.find((c) => c.contestId === contest.contestId)?.result;
    const label = quote(contest.title);
    if (!result) problems.push(`${label} has no result`);
    else if (result.kind === 'proposal') {
      if (result.outcome !== expected) problems.push(`${label}: expected ${JSON.stringify(expected)}, the result is ${result.outcome}`);
    } else {
      const want = Array.isArray(expected) ? findCandidates(contest, expected) : `${label} has winners, not an outcome`;
      if (typeof want === 'string') {
        problems.push(want);
        continue;
      }
      const got = result.kind === 'choose_n' ? result.winners : result.winner ? [result.winner] : [];
      const names = (ids: readonly string[]) => (ids.length ? ids.map((id) => contest.candidates.find((k) => k.candidateId === id)?.name ?? id).join(', ') : 'none');
      if ([...want].sort().join() !== [...got].sort().join()) problems.push(`${label}: expected ${names(want)} to win, the winners are ${names(got)}`);
    }
  }
  return problems;
}
