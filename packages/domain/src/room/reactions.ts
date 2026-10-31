import { z } from 'zod';
import { OK, refuse, type Check, type Outcome } from '../check.js';
import { changeVote, type VoteValue } from '../votes.js';
import type { RoomMessageRecord } from './room.js';

/**
 * Votes and emoji reactions on the room's messages (design §5.10): each member votes a member's message or an answer up
 * or down, as on the forum (§5.9), and reacts to it with any of a few emojis; everyone sees the score and how many gave
 * each reaction, nobody sees who. They go when their message goes: deleted, erased, or expired after 90 days.
 */

/** The reactions members pick from, in the order a message shows them. */
export const ROOM_REACTIONS = ['like', 'love', 'laugh', 'celebrate', 'thinking', 'thanks'] as const;
export type RoomReaction = (typeof ROOM_REACTIONS)[number];

/** How each reaction looks, and what a screen reader says for it. */
export const ROOM_REACTION_EMOJI: Readonly<Record<RoomReaction, { readonly emoji: string; readonly label: string }>> = {
  like: { emoji: '👍', label: 'thumbs up' },
  love: { emoji: '❤️', label: 'heart' },
  laugh: { emoji: '😂', label: 'laughing' },
  celebrate: { emoji: '🎉', label: 'party popper' },
  thinking: { emoji: '🤔', label: 'thinking' },
  thanks: { emoji: '🙏', label: 'thank you' },
};

/** `PUT /v1/room/messages/{messageId}/reactions`: a reaction added (`on`) or taken back. */
export const roomReactionSchema = z.strictObject({ reaction: z.enum(ROOM_REACTIONS), on: z.boolean() });
export type RoomReactionInput = z.infer<typeof roomReactionSchema>;

/** How many members gave a reaction to a message. */
export interface RoomReactionCount {
  readonly reaction: RoomReaction;
  readonly count: number;
}

/**
 * `room_reactions/{messageId}_{accountId}`: one member's vote and reactions on a message, never shown to anyone but
 * them; deleted once it holds neither, and with its message.
 */
export interface RoomReactionRecord {
  readonly messageId: string;
  readonly accountId: string;
  /** Up, down, or 0 for none. */
  readonly vote: VoteValue;
  /** In `ROOM_REACTIONS` order. */
  readonly reactions: readonly RoomReaction[];
  /** When they last changed it. */
  readonly at: string;
  /** Its message's, so the tick deletes the two together. */
  readonly expireAt: string;
}

/** Message IDs are UUIDv7 and have no underscore. */
export const roomReactionId = (messageId: string, accountId: string) => `${messageId}_${accountId}`;

/** A vote or reaction taken: the message with its new totals and feed number, and the member's record (null: delete it). */
export interface RoomReactionChange {
  readonly message: RoomMessageRecord;
  readonly record: RoomReactionRecord | null;
}

/** Members vote on and react to a member's message or an answer while it is there; notices take neither. */
export function checkReactable(message: RoomMessageRecord | null): Check {
  if (!message || message.deletedAt) return refuse('not_found', 'no such message');
  if (message.kind === 'notice') return refuse('conflict', 'notices take no votes or reactions');
  return OK;
}

/** The member's vote on a message, replacing theirs (0 takes it back). Null when it is the vote they gave. */
export function voteOnMessage(
  message: RoomMessageRecord | null,
  current: RoomReactionRecord | null,
  value: VoteValue,
  accountId: string,
  seq: number,
  at: string,
): Outcome<RoomReactionChange | null> {
  const check = checkReactable(message);
  if (!check.ok) return check;
  const before = current?.vote ?? 0;
  if (before === value) return { ok: true, value: null };
  return {
    ok: true,
    value: {
      message: { ...message!, ...changeVote(message!, before, value), seq },
      record: recordOf(message!, current, accountId, { vote: value }, at),
    },
  };
}

/** The member adds a reaction to a message, or takes theirs back. Null when they already had (or had not) given it. */
export function reactToMessage(
  message: RoomMessageRecord | null,
  current: RoomReactionRecord | null,
  input: RoomReactionInput,
  accountId: string,
  seq: number,
  at: string,
): Outcome<RoomReactionChange | null> {
  const check = checkReactable(message);
  if (!check.ok) return check;
  const mine = new Set(current?.reactions ?? []);
  if (mine.has(input.reaction) === input.on) return { ok: true, value: null };
  if (input.on) mine.add(input.reaction);
  else mine.delete(input.reaction);
  return {
    ok: true,
    value: {
      message: { ...message!, reactions: recount(message!.reactions, input.reaction, input.on ? 1 : -1), seq },
      record: recordOf(message!, current, accountId, { reactions: ROOM_REACTIONS.filter((r) => mine.has(r)) }, at),
    },
  };
}

/** The counts with one reaction given or taken back once more: in `ROOM_REACTIONS` order, those nobody gives left out. */
function recount(counts: readonly RoomReactionCount[], reaction: RoomReaction, by: 1 | -1): RoomReactionCount[] {
  const n = new Map(counts.map((c) => [c.reaction, c.count]));
  n.set(reaction, Math.max(0, (n.get(reaction) ?? 0) + by));
  return ROOM_REACTIONS.flatMap((r) => (n.get(r) ? [{ reaction: r, count: n.get(r)! }] : []));
}

function recordOf(
  message: RoomMessageRecord,
  current: RoomReactionRecord | null,
  accountId: string,
  change: Partial<Pick<RoomReactionRecord, 'vote' | 'reactions'>>,
  at: string,
): RoomReactionRecord | null {
  const vote = change.vote ?? current?.vote ?? 0;
  const reactions = change.reactions ?? current?.reactions ?? [];
  if (vote === 0 && !reactions.length) return null;
  return { messageId: message.messageId, accountId, vote, reactions, at, expireAt: message.expireAt };
}
