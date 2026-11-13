import { z } from 'zod';
import { OK, refuse, type Check, type Outcome } from '../check.js';
import type { CardBar } from '../governance/link-previews.js';
import { percent } from '../results-synopsis.js';
import { basedOnSchema, hashtagsSchema, oneLine, stale, text } from './common.js';

/**
 * Issue polls (design §10.16): a question of the day ("Should Congress fund longevity research?") that anyone may
 * answer, signed in or not, with results to share. A poll decides nothing and is not an election: it has no roll,
 * no secret ballot and no audit ledger, and its page says so. Communications Admins write, publish, close and delete
 * polls, one alone, as with news.
 *
 * A vote is kept only as its count and as a mark that this account or this browser has answered, never which
 * choice; the marks are deleted once the poll closes. Signed-out answers are held to one per browser (a random
 * token the browser keeps), a daily number per network address (counted under a salted hash, kept that day only),
 * App Check and a hidden field; Active members who answer signed in, one per account, are also counted apart.
 * Someone who answers sees the running results; everyone sees them once the poll closes.
 */

export const POLL_STATUSES = ['draft', 'published'] as const;
export type PollStatus = (typeof POLL_STATUSES)[number];

/** Where a poll stands: a draft only its writers see, open for answers, or closed with its results for all. */
export type PollState = 'draft' | 'open' | 'closed';

export const POLL_LIMITS = { question: 200, description: 1000, choice: 80, minChoices: 2, maxChoices: 6 } as const;

/** How long a poll may stay open: from 10 minutes after publishing to 90 days. */
export const POLL_OPEN_MINUTES = { min: 10, max: 90 * 24 * 60 } as const;

/**
 * The most answers taken from one network address for one poll in one UTC day, signed out. A household, an office or
 * a phone network may share an address, so it is generous: it stops a script, not a family.
 */
export const POLL_VOTES_PER_ADDRESS_PER_DAY = 20;

/** How many documents a poll's counts are split over, so that many answers at once do not queue on one. */
export const POLL_TALLY_SHARDS = 10;

/** The browser's token: random, 16 to 64 URL-safe characters, made and kept by the browser (`poll-voter.ts`). */
export const POLL_VOTER = /^[A-Za-z0-9_-]{16,64}$/;

/** A choice's ID, given when the poll is saved: `c1`…`c6`, in the order written. */
const CHOICE_ID = /^c[1-9]$/;

/** The header a signed-out browser sends its token in, to see the results of a poll it answered. */
export const POLL_VOTER_HEADER = 'x-poll-voter';

const isoDateTime = z.iso.datetime({ offset: true, message: 'a date and time' });

const contentShape = {
  question: oneLine(POLL_LIMITS.question).pipe(z.string().min(1, 'write the question')),
  /** Plain text under the question: what it is about, why the party asks. */
  description: text(POLL_LIMITS.description),
  choices: z
    .array(oneLine(POLL_LIMITS.choice).pipe(z.string().min(1, 'write the choice, or remove it')))
    .min(POLL_LIMITS.minChoices, `give at least ${POLL_LIMITS.minChoices} choices`)
    .max(POLL_LIMITS.maxChoices, `at most ${POLL_LIMITS.maxChoices} choices`)
    .superRefine((choices, ctx) => {
      const seen = new Set<string>();
      choices.forEach((c, i) => {
        const key = c.toLowerCase();
        if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [i], message: 'two choices say the same' });
        seen.add(key);
      });
    }),
  /** Carried by the share buttons. */
  hashtags: hashtagsSchema,
  /** When it closes; may be left empty in a draft, and is checked when it is published. */
  closesAt: isoDateTime.nullable().default(null),
};

/** `POST /v1/admin/communications/polls`: a new draft. */
export const createPollSchema = z.strictObject(contentShape);
export type CreatePollInput = z.infer<typeof createPollSchema>;

/** `PUT /v1/admin/communications/polls/{pollId}`: a draft's content, from the version edited. */
export const updatePollSchema = z.strictObject({ ...contentShape, basedOn: basedOnSchema });
export type UpdatePollInput = z.infer<typeof updatePollSchema>;

/** `POST …/polls/{pollId}/publish` and `…/close`: the version it was looked at. */
export const pollVersionSchema = z.strictObject({ basedOn: basedOnSchema });
export type PollVersionInput = z.infer<typeof pollVersionSchema>;

export interface PollChoice {
  readonly choiceId: string;
  readonly label: string;
}

/** `polls/{pollId}` */
export interface PollRecord {
  readonly pollId: string;
  readonly question: string;
  readonly description: string;
  readonly choices: readonly PollChoice[];
  readonly hashtags: readonly string[];
  readonly status: PollStatus;
  /** Counts saves, so a change made from an older copy is refused instead of undoing someone else's. */
  readonly version: number;
  /** When it closes as published; a poll closed early also has `closedAt`. */
  readonly closesAt: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  /** Set when a Communications Admin closed it before its time. */
  readonly closedAt: string | null;
  readonly closedBy: string | null;
  /** The worker deleted its "has answered" marks after it closed (design §10.16). */
  readonly marksCleared: boolean;
}

/** The counts of one group of voters: how many answered, and how many chose each choice. */
export interface PollCount {
  readonly total: number;
  readonly counts: Readonly<Record<string, number>>;
}

/** A poll's results: everyone who answered, and the Active members among them who answered signed in. */
export interface PollResults {
  readonly everyone: PollCount;
  readonly members: PollCount;
}

/** `poll_tallies/{pollId}_{shard}`: one of a poll's count documents. */
export interface PollTallyRecord {
  readonly pollId: string;
  readonly shard: number;
  readonly everyone?: Readonly<Record<string, number>>;
  readonly members?: Readonly<Record<string, number>>;
}

/** `poll_limits/{YYYY-MM-DD}`: the salt voters' addresses are counted under that day (random, hex). */
export interface PollLimitsRecord {
  readonly day: string;
  readonly salt: string;
}

/** `poll_address_counts/{day}_{pollId}_{hash}`: answers from one address to one poll that day. */
export interface PollAddressCountRecord {
  readonly day: string;
  readonly pollId: string;
  readonly count: number;
}

/** A poll as the public sees it. */
export interface PublicPoll {
  readonly pollId: string;
  readonly question: string;
  readonly description: string;
  readonly choices: readonly PollChoice[];
  readonly hashtags: readonly string[];
  readonly state: Exclude<PollState, 'draft'>;
  readonly publishedAt: string;
  /** When it closes, or closed (early, if a Communications Admin closed it). */
  readonly closesAt: string;
  /** Whether the person asking has answered it (by their account, or by this browser). */
  readonly voted: boolean;
  /** Its results, once they have answered or it has closed; null before. */
  readonly results: PollResults | null;
}

/** A poll as Communications Admins see it: everything, with its running results and how often it was shared. */
export interface AdminPoll extends PollRecord {
  readonly state: PollState;
  readonly results: PollResults;
  readonly shared: number;
}

/** `POST /v1/polls/{pollId}/votes` and `…/member-votes`: the choice, the browser's token, and the hidden field. */
export const pollVoteSchema = z.strictObject({
  choiceId: z.string().regex(CHOICE_ID, 'choose one of the answers'),
  voter: z.string().regex(POLL_VOTER, 'this browser could not make a voting token; allow site data and reload'),
  /** Left empty by people; a form filler that fills every field fills this too, and its answer is not counted. */
  website: z.string().max(500).default(''),
});
export type PollVoteInput = z.infer<typeof pollVoteSchema>;

/** Whether what was sent is a person's answer (the trap field is empty) or a form filler's, which is not counted. */
export const isTrappedVote = (input: Pick<PollVoteInput, 'website'>) => input.website.trim() !== '';

const EMPTY_COUNT: PollCount = { total: 0, counts: {} };
export const NO_POLL_RESULTS: PollResults = { everyone: EMPTY_COUNT, members: EMPTY_COUNT };

/** When a published poll closes: when closed early, else its time. */
export function pollClosesAt(poll: Pick<PollRecord, 'closesAt' | 'closedAt'>): string | null {
  if (poll.closedAt && (!poll.closesAt || poll.closedAt < poll.closesAt)) return poll.closedAt;
  return poll.closesAt;
}

export function pollState(poll: Pick<PollRecord, 'status' | 'closesAt' | 'closedAt'>, now: Date): PollState {
  if (poll.status === 'draft') return 'draft';
  const closes = pollClosesAt(poll);
  return closes && Date.parse(closes) <= now.getTime() ? 'closed' : 'open';
}

/** Choices as saved: each its `c1`…`c6` in the order written. */
export const pollChoices = (labels: readonly string[]): PollChoice[] => labels.map((label, i) => ({ choiceId: `c${i + 1}`, label }));

export function newPoll(input: CreatePollInput, pollId: string, actor: string, at: string): PollRecord {
  return {
    pollId,
    question: input.question,
    description: input.description,
    choices: pollChoices(input.choices),
    hashtags: input.hashtags,
    status: 'draft',
    version: 1,
    closesAt: input.closesAt,
    createdAt: at,
    createdBy: actor,
    updatedAt: at,
    updatedBy: actor,
    publishedAt: null,
    publishedBy: null,
    closedAt: null,
    closedBy: null,
    marksCleared: false,
  };
}

const staleCheck = (poll: PollRecord, basedOn: number): Check => (poll.version === basedOn ? OK : refuse('conflict', stale('poll')));

/** A draft changed. Once published, its question and choices stay as people answered them. */
export function updatePoll(poll: PollRecord, input: UpdatePollInput, actor: string, at: string): Outcome<PollRecord> {
  if (poll.status !== 'draft') return refuse('conflict', 'a published poll no longer changes: people have answered it as it is');
  const fresh = staleCheck(poll, input.basedOn);
  if (!fresh.ok) return fresh;
  return {
    ok: true,
    value: {
      ...poll,
      question: input.question,
      description: input.description,
      choices: pollChoices(input.choices),
      hashtags: input.hashtags,
      closesAt: input.closesAt,
      version: poll.version + 1,
      updatedAt: at,
      updatedBy: actor,
    },
  };
}

/** Why a closing time cannot be used now, if it cannot. */
export function closingProblem(closesAt: string | null, now: Date): string | null {
  if (!closesAt) return 'set when the poll closes';
  const minutes = (Date.parse(closesAt) - now.getTime()) / 60_000;
  if (minutes < POLL_OPEN_MINUTES.min) return `close it at least ${POLL_OPEN_MINUTES.min} minutes from now`;
  if (minutes > POLL_OPEN_MINUTES.max) return `a poll stays open at most ${POLL_OPEN_MINUTES.max / 1440} days`;
  return null;
}

/** A draft published: open at once, until its closing time. */
export function publishPoll(poll: PollRecord, basedOn: number, actor: string, now: Date): Outcome<PollRecord> {
  if (poll.status !== 'draft') return refuse('conflict', 'this poll is already published');
  const fresh = staleCheck(poll, basedOn);
  if (!fresh.ok) return fresh;
  const problem = closingProblem(poll.closesAt, now);
  if (problem) return refuse('conflict', problem);
  const at = now.toISOString();
  return { ok: true, value: { ...poll, status: 'published', version: poll.version + 1, publishedAt: at, publishedBy: actor, updatedAt: at, updatedBy: actor } };
}

/** An open poll closed now, before its time. */
export function closePoll(poll: PollRecord, basedOn: number, actor: string, now: Date): Outcome<PollRecord> {
  const state = pollState(poll, now);
  if (state !== 'open') return refuse('conflict', state === 'draft' ? 'a draft is not open; delete it instead' : 'this poll has already closed');
  const fresh = staleCheck(poll, basedOn);
  if (!fresh.ok) return fresh;
  const at = now.toISOString();
  return { ok: true, value: { ...poll, version: poll.version + 1, closedAt: at, closedBy: actor, updatedAt: at, updatedBy: actor } };
}

/** Whether an answer may be taken now. */
export function checkPollOpen(poll: PollRecord | null, now: Date): Check {
  if (!poll || poll.status !== 'published') return refuse('not_found', 'no such poll');
  return pollState(poll, now) === 'open' ? OK : refuse('conflict', 'this poll has closed; see its results');
}

/** Whether one more answer from an address fits today's number for the poll. */
export function checkPollAddress(count: number): Check {
  return count >= POLL_VOTES_PER_ADDRESS_PER_DAY
    ? refuse('rate_limited', `that is ${POLL_VOTES_PER_ADDRESS_PER_DAY} answers to this poll from your network today, the most we take from one; please try again tomorrow`)
    : OK;
}

export const ALREADY_ANSWERED = 'you have already answered this poll; each person answers once';

/** The results of a poll's count documents, added up, counting only its own choices. */
export function sumPollTallies(choices: readonly PollChoice[], shards: readonly Partial<PollTallyRecord>[]): PollResults {
  const add = (group: 'everyone' | 'members'): PollCount => {
    const counts: Record<string, number> = {};
    for (const { choiceId } of choices) counts[choiceId] = shards.reduce((n, s) => n + Math.max(0, s[group]?.[choiceId] ?? 0), 0);
    return { total: Object.values(counts).reduce((a, b) => a + b, 0), counts };
  };
  return { everyone: add('everyone'), members: add('members') };
}

/** Whether results are shown: to someone who answered, and to everyone once it closed. */
export const pollResultsShown = (state: PollState, voted: boolean) => state === 'closed' || voted;

export function publicPoll(poll: PollRecord, results: PollResults, voted: boolean, now: Date): PublicPoll {
  const state = pollState(poll, now);
  if (state === 'draft') throw new Error('a draft is not public');
  return {
    pollId: poll.pollId,
    question: poll.question,
    description: poll.description,
    choices: poll.choices,
    hashtags: poll.hashtags,
    state,
    publishedAt: poll.publishedAt!,
    closesAt: pollClosesAt(poll)!,
    voted,
    results: pollResultsShown(state, voted) ? results : null,
  };
}

/** The choices that have the most answers (more than one on a tie); none before anyone answered. */
export function leadingChoices(choices: readonly PollChoice[], count: PollCount): PollChoice[] {
  const top = Math.max(0, ...choices.map((c) => count.counts[c.choiceId] ?? 0));
  return top > 0 ? choices.filter((c) => (count.counts[c.choiceId] ?? 0) === top) : [];
}

/** A choice's share of a group's answers. */
export const choiceShare = (count: PollCount, choiceId: string) => ({ part: count.counts[choiceId] ?? 0, whole: count.total });

/**
 * A closed poll's card bars (design §15): everyone's answers, a bar per choice in the order written, the leaders
 * solid; with more than four choices, the four with the most answers.
 */
export function pollBars(choices: readonly PollChoice[], count: PollCount): CardBar[] {
  const leaders = new Set(leadingChoices(choices, count).map((c) => c.choiceId));
  const shown =
    choices.length <= 4
      ? choices
      : [...choices]
          .sort((a, b) => (count.counts[b.choiceId] ?? 0) - (count.counts[a.choiceId] ?? 0))
          .slice(0, 4)
          .sort((a, b) => choices.indexOf(a) - choices.indexOf(b));
  return shown.map((c) => {
    const share = choiceShare(count, c.choiceId);
    return {
      label: c.label,
      value: percent(share, 0) ?? '–',
      share: share.whole > 0 ? share.part / share.whole : 0,
      ...(leaders.has(c.choiceId) ? { highlight: true } : {}),
    };
  });
}

/** The UTC day of a time, `YYYY-MM-DD`. */
export const pollDay = (at: Date) => at.toISOString().slice(0, 10);
