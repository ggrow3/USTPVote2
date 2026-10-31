import { z } from 'zod';

/**
 * Up and down votes, as the forum (design §5.9) and the members' room (§5.10) take them: one per member per post,
 * comment or message, up or down, which they can change or take back. Everyone sees the total; nobody but the voter
 * sees their vote.
 */

/** `PUT …/vote`: up, down, or 0 to take the vote back. */
export const voteSchema = z.strictObject({ value: z.union([z.literal(1), z.literal(0), z.literal(-1)]) });
export type VoteValue = z.infer<typeof voteSchema>['value'];

/** What votes add up to. */
export interface VoteTally {
  readonly up: number;
  readonly down: number;
  /** `up - down`. */
  readonly score: number;
}

export const NO_VOTES: VoteTally = { up: 0, down: 0, score: 0 };

/** The tally once a member's vote goes from `before` to `after` (0 being none). */
export function changeVote(tally: VoteTally, before: VoteValue, after: VoteValue): VoteTally {
  const up = tally.up - (before === 1 ? 1 : 0) + (after === 1 ? 1 : 0);
  const down = tally.down - (before === -1 ? 1 : 0) + (after === -1 ? 1 : 0);
  return { up, down, score: up - down };
}
