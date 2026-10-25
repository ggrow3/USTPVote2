import { z } from 'zod';
import { bylawsAmendmentSchema } from './amendments.js';
import { DEFAULT_K_ANONYMITY, MIN_K_ANONYMITY, SECRECY_MODES } from './elections.js';

/** Election setup request bodies (design §6, §12), shared by the API and the web app. */

const title = z.string().trim().min(1, 'enter a title').max(200);
const description = z.string().trim().max(5000);
const isoDateTime = z.iso.datetime({ offset: true, message: 'expected an ISO 8601 date-time' });
const count = z.number().int().min(0);
const ratio = z
  .strictObject({ num: count, den: z.number().int().min(1) })
  .refine((r) => r.num <= r.den, 'a ratio cannot exceed 1');
const threshold = z.strictObject({ ratio, comparison: z.enum(['gt', 'gte']) });

export const createElectionSchema = z.strictObject({
  title,
  description: description.default(''),
  secrecy: z.enum(SECRECY_MODES),
  opensAt: isoDateTime,
  closesAt: isoDateTime,
  kAnonymity: z.number().int().min(MIN_K_ANONYMITY).max(1000).default(DEFAULT_K_ANONYMITY),
});
export type CreateElectionInput = z.infer<typeof createElectionSchema>;

export const updateElectionSchema = createElectionSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'change at least one field');
export type UpdateElectionInput = z.infer<typeof updateElectionSchema>;

const contestBase = { title, description: description.default('') };
/** The office a candidate contest fills (design §6.4); omit or null for none. */
const officeId = z.string().min(1).max(48).nullable().optional();

/** The rules of a contest; candidates are managed separately and fill in the candidate list. */
export const contestInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('proposal'),
    ...contestBase,
    proposalSnapshotId: z.string().min(1, 'choose the proposal text'),
    passRule: z.strictObject({ threshold, base: z.enum(['yes_no', 'yes_no_abstain', 'roll']) }),
    quorum: z.strictObject({ minBallots: count.optional(), rollRatio: ratio.optional() }).optional(),
  }),
  z.strictObject({
    kind: z.literal('choose_n'),
    ...contestBase,
    seats: z.number().int().min(1),
    maxSelections: z.number().int().min(1),
    supportFloor: threshold.optional(),
    positionId: officeId,
  }),
  z.strictObject({
    kind: z.literal('irv'),
    ...contestBase,
    maxRanks: z.number().int().min(1).optional(),
    positionId: officeId,
  }),
]);
export type ContestInput = z.infer<typeof contestInputSchema>;

export const candidateInputSchema = z.strictObject({
  name: z.string().trim().min(1, 'enter a name').max(200),
  statement: z.string().trim().max(5000).optional(),
  accountId: z.string().min(1).optional(),
});
export type CandidateInput = z.infer<typeof candidateInputSchema>;

/** Body of requests that only carry the written reason (roll, schedule, cancel). */
export const reasonInputSchema = z.strictObject({
  reason: z.string().trim().min(1, 'a written reason is required').max(2000),
});
export type ReasonInput = z.infer<typeof reasonInputSchema>;

/** Who a roll holds: every Active member, or only the test voters (a rehearsal; testing mode only, design §10.4). */
export const ROLL_VOTERS = ['members', 'test_voters'] as const;

/** `POST /v1/admin/elections/{id}/roll`. */
export const rollRequestSchema = reasonInputSchema.extend({
  voters: z.enum(ROLL_VOTERS).default('members'),
});
export type RollRequestInput = z.infer<typeof rollRequestSchema>;

export const proposalInputSchema = z.strictObject({
  title,
  body: z.string().trim().min(1, 'enter the proposal text').max(100_000),
  source: z.string().trim().max(2000).optional(),
  /** The bylaws lines it changes (design §6.6); `body` then gives the reasons. */
  amendment: bylawsAmendmentSchema.optional(),
});
export type ProposalInput = z.infer<typeof proposalInputSchema>;
