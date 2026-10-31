import { z } from 'zod';
import { refuse, type Outcome } from '../check.js';
import { DAILY_JOKES, type DailyJoke } from '../daily.js';
import type { RoomFeedRecord } from './room.js';

/**
 * Voice in the members' room (design §5.10): members in the room talk in one call while they chat. Peer to peer, the
 * user's choice on 2026-10-30: each browser sends its audio straight to every other in the call, encrypted (WebRTC's
 * DTLS-SRTP), and the api only passes each pair's handshake and says who is in the call. Nothing of a call is recorded
 * or reaches the api, and each browser works out who is speaking from the sound it receives.
 */

export const ROOM_VOICE_LIMITS = {
  /** In the call at once: each browser sends its audio to every other, so many more overload a phone's uplink. */
  participants: 8,
  /** One offer or answer: an audio-only session description with its network addresses runs to a few KB. */
  sdp: 16_000,
  /** Joining, muting or unmuting, and handshakes sent (one each), per member in any minute. */
  actionsPerMinute: 60,
  /** A page in the call says it is still there this often; one silent for `staleSeconds` is dropped from the call. */
  heartbeatSeconds: 20,
  staleSeconds: 60,
  /** A handshake is deleted this long after it was sent: by then it was read, or is of no use. */
  signalMinutes: 5,
} as const;

const id = z.string().trim().min(1).max(64);

/** `POST /v1/room/voice`: joining the call from this page, muted or not. */
export const roomVoiceJoinSchema = z.strictObject({ muted: z.boolean().default(false) });
export type RoomVoiceJoinInput = z.infer<typeof roomVoiceJoinSchema>;

/** `PUT /v1/room/voice`: the page is still in the call (every `heartbeatSeconds`), muted or not. */
export const roomVoiceUpdateSchema = z.strictObject({ sessionId: id, muted: z.boolean() });
export type RoomVoiceUpdateInput = z.infer<typeof roomVoiceUpdateSchema>;

/** `DELETE /v1/room/voice?sessionId=`: this page leaves the call (another page of the member's is left alone). */
export const roomVoiceLeaveQuerySchema = z.strictObject({ sessionId: id });
export type RoomVoiceLeaveQuery = z.infer<typeof roomVoiceLeaveQuerySchema>;

export const ROOM_SIGNAL_KINDS = ['offer', 'answer'] as const;
export type RoomSignalKind = (typeof ROOM_SIGNAL_KINDS)[number];

/** `POST /v1/room/voice/signals`: handshakes from this page to pages in the call, one per person. */
export const roomSignalsSchema = z.strictObject({
  sessionId: id,
  signals: z
    .array(
      z.strictObject({
        to: id,
        toSession: id,
        kind: z.enum(ROOM_SIGNAL_KINDS),
        sdp: z.string().min(1).max(ROOM_VOICE_LIMITS.sdp, `at most ${ROOM_VOICE_LIMITS.sdp} characters`),
      }),
    )
    .min(1)
    .max(ROOM_VOICE_LIMITS.participants - 1),
});
export type RoomSignalsInput = z.infer<typeof roomSignalsSchema>;

/** `room_voice/{accountId}`: a member in the call, from one page; joining from another page replaces it. */
export interface RoomVoiceRecord {
  readonly accountId: string;
  /** The page in the call, so a handshake meant for an earlier page of theirs is never used. */
  readonly sessionId: string;
  readonly joinedAt: string;
  readonly seenAt: string;
  readonly muted: boolean;
  /** When, in the last minute, they joined, muted or unmuted, or sent a handshake: for the rate limit. */
  readonly actions: readonly string[];
}

/** `room_signals/{signalId}` (UUIDv7): half of a handshake between two pages in the call, for the other to read once. */
export interface RoomSignalRecord {
  readonly signalId: string;
  /** The feed number it was sent with, so the recipient's next update brings it. */
  readonly seq: number;
  readonly from: string;
  readonly fromSession: string;
  readonly to: string;
  readonly toSession: string;
  readonly kind: RoomSignalKind;
  /** The session description, with the sender's network addresses. */
  readonly sdp: string;
  readonly createdAt: string;
  readonly expireAt: string;
}

const MINUTE_MS = 60_000;

/** Whether a member's page said it was there recently enough to count as in the call. */
export const voiceLive = (v: RoomVoiceRecord, now: string): boolean => Date.parse(now) - Date.parse(v.seenAt) < ROOM_VOICE_LIMITS.staleSeconds * 1000;

/** The actions of the last minute, and whether `count` more stay within the limit. */
function withinRate(actions: readonly string[], count: number, now: string): Outcome<string[]> {
  const recent = actions.filter((at) => Date.parse(now) - Date.parse(at) < MINUTE_MS);
  if (recent.length + count > ROOM_VOICE_LIMITS.actionsPerMinute) return refuse('rate_limited', 'you are joining, muting or calling very fast; wait a moment');
  return { ok: true, value: [...recent, ...Array<string>(count).fill(now)] };
}

/**
 * Joining the call from a page, which replaces any earlier page of theirs in it. `others` are the rest of the call
 * (live ones only); refused when it is full.
 */
export function joinVoice(
  current: RoomVoiceRecord | null,
  others: readonly RoomVoiceRecord[],
  accountId: string,
  sessionId: string,
  muted: boolean,
  at: string,
): Outcome<RoomVoiceRecord> {
  if (others.length >= ROOM_VOICE_LIMITS.participants) return refuse('conflict', `the call is full: ${ROOM_VOICE_LIMITS.participants} people at most`);
  const actions = withinRate(current?.actions ?? [], 1, at);
  if (!actions.ok) return actions;
  return { ok: true, value: { accountId, sessionId, joinedAt: at, seenAt: at, muted, actions: actions.value } };
}

/** Whether the member is in the call from page `sessionId` now. */
const inCallFrom = (v: RoomVoiceRecord | null, sessionId: string, at: string): v is RoomVoiceRecord => !!v && v.sessionId === sessionId && voiceLive(v, at);

/**
 * The page saying it is still in the call, muted or not. `changed` when it muted or unmuted, which the rest of the room
 * is told of; refused when this page is no longer in the call (it joined elsewhere, or went quiet too long).
 */
export function touchVoice(current: RoomVoiceRecord | null, sessionId: string, muted: boolean, at: string): Outcome<{ record: RoomVoiceRecord; changed: boolean }> {
  if (!inCallFrom(current, sessionId, at)) return refuse('conflict', 'you are not in the call from this page');
  const changed = muted !== current.muted;
  const actions = withinRate(current.actions, changed ? 1 : 0, at);
  if (!actions.ok) return actions;
  return { ok: true, value: { record: { ...current, seenAt: at, muted, actions: actions.value }, changed } };
}

/**
 * Handshakes from page `sessionId`: the sender must be in the call from it, and each must go to someone else in the
 * call, to the page they are in it from. The sender's record comes back with the handshakes counted.
 */
export function checkSignals(
  sender: RoomVoiceRecord | null,
  input: RoomSignalsInput,
  call: ReadonlyMap<string, RoomVoiceRecord>,
  at: string,
): Outcome<RoomVoiceRecord> {
  if (!inCallFrom(sender, input.sessionId, at)) return refuse('conflict', 'you are not in the call from this page');
  for (const s of input.signals) {
    if (s.to === sender.accountId || !inCallFrom(call.get(s.to) ?? null, s.toSession, at)) return refuse('conflict', 'someone you are calling has left the call');
  }
  const actions = withinRate(sender.actions, input.signals.length, at);
  if (!actions.ok) return actions;
  return { ok: true, value: { ...sender, actions: actions.value } };
}

export function signalRecord(
  from: RoomVoiceRecord,
  s: RoomSignalsInput['signals'][number],
  signalId: string,
  seq: number,
  at: string,
): RoomSignalRecord {
  return {
    signalId,
    seq,
    from: from.accountId,
    fromSession: from.sessionId,
    to: s.to,
    toSession: s.toSession,
    kind: s.kind,
    sdp: s.sdp,
    createdAt: at,
    expireAt: new Date(Date.parse(at) + ROOM_VOICE_LIMITS.signalMinutes * MINUTE_MS).toISOString(),
  };
}

/**
 * In each pair in the call the page that joined later makes the offer and the other answers, so the two never offer at
 * once; a page that joins again has joined later than everyone, and calls them all.
 */
export function offersTo(mine: { readonly accountId: string; readonly joinedAt: string }, theirs: { readonly accountId: string; readonly joinedAt: string }): boolean {
  return mine.joinedAt > theirs.joinedAt || (mine.joinedAt === theirs.joinedAt && mine.accountId > theirs.accountId);
}

/**
 * `/joke`: the assistant tells a lame joke, from the same gentle list as the daily joke (design §4.1), never about
 * people or politics. The room goes through them in a fixed shuffled order, so none comes again until all have.
 */
export const JOKE_STRIDE = 7;

/** The next joke, after the `feed.jokes` the room has heard; refused while the assistant is switched off. */
export function nextJoke(feed: RoomFeedRecord): Outcome<DailyJoke> {
  if (!feed.assistantOn) return refuse('conflict', 'a Membership Admin has switched the assistant off');
  return { ok: true, value: DAILY_JOKES[(feed.jokes * JOKE_STRIDE + 3) % DAILY_JOKES.length]! };
}

/** A joke's message: the setup, then the punchline on its own line (the page reads it out with a pause between). */
export const jokeBody = (joke: DailyJoke): string => `${joke.setup}\n${joke.punchline}`;
