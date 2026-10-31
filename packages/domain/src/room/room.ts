import { sha256Hex } from 'ustp-audit';
import { z } from 'zod';
import { OK, refuse, type Check, type Outcome } from '../check.js';
import type { LedgerEvent } from '../ledger-events.js';
import { NO_VOTES, type VoteTally } from '../votes.js';
import type { RoomReactionCount } from './reactions.js';

/**
 * The members' room (design §5.10): a chat room for Active members who have accepted its terms, with an assistant that
 * reads the room, keeps the group's project memory (decisions and action items) and answers questions from it. The
 * room's model is self-hosted, so nothing said in the room goes to an AI company. Everything here is the group's work,
 * never facts about members: a decision is the group's, and a name appears only as an action item's owner.
 */

/**
 * What a member accepts at the door (spec rule 1), before any of the room is shown to them. A new version puts everyone
 * back at the door; the ledger records the version and the SHA-256 of the text each member accepted.
 */
export const ROOM_TERMS = {
  version: 1,
  text: [
    'This room has an AI assistant. It reads the messages posted here, keeps notes on the group’s plans, decisions and ' +
      'tasks, and answers questions from them.',
    'The assistant runs on the party’s own servers: nothing said in this room is sent to an AI company.',
    'It keeps nothing about you as a person, only the group’s work: decisions are the group’s, and your name appears ' +
      'only on the action items you own. You can see everything it keeps, and delete what you added, with /memory and ' +
      '/forget.',
    'Messages are deleted after 90 days. Decisions stay until someone removes them; action items are deleted 90 days ' +
      'after they are done.',
    'What is kept here is a record the party may have to produce. Take legal questions to a lawyer, not the room.',
    'Leave at any time with /leave-room.',
  ].join('\n\n'),
} as const;
export const ROOM_TERMS_HASH = sha256Hex(ROOM_TERMS.text);

export const ROOM_LIMITS = {
  message: 4000,
  question: 1000,
  decision: 1000,
  task: 300,
  /** How much of a message a decision logged from it keeps, so it outlives the message. */
  quote: 500,
  /** Messages each page of history holds. */
  page: 100,
  /** Changes one update answers with at most; a page further behind than this reloads. */
  updates: 300,
  /** How long a request for updates waits for something new. */
  waitSeconds: 25,
  /** Per member: messages in any minute and in any 24 hours, and questions to the assistant in any 24 hours. */
  messagesPerMinute: 20,
  messagesPerDay: 2000,
  questionsPerDay: 50,
  /** Questions waiting for the assistant at once, across the room. */
  pending: 10,
  /** A question not answered in this long fails, with a notice in the room. */
  jobMinutes: 10,
  /** Results of a memory search. */
  search: 50,
} as const;

/** How long the room keeps things (spec rules 4 and 9; the user chose 90 days for messages on 2026-10-29). */
export const ROOM_RETENTION = {
  messageDays: 90,
  /** After an action item is done. */
  actionDoneDays: 90,
  /** A finished question's job record (its answer is a message, kept as one). */
  jobDays: 1,
} as const;

const DAY_MS = 86_400_000;
export const expiresAfter = (at: string, days: number): string => new Date(Date.parse(at) + days * DAY_MS).toISOString();

const text = (max: number) => z.string().trim().max(max, `at most ${max} characters`);
const id = z.string().trim().min(1).max(64);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');

/** `POST /v1/room/consent`: the member accepts the terms they were shown (a newer version refuses, 409). */
export const roomConsentSchema = z.strictObject({ version: z.number().int().positive() });
export type RoomConsentInput = z.infer<typeof roomConsentSchema>;

/** `POST /v1/room/messages`. */
export const roomMessageSchema = z.strictObject({ body: text(ROOM_LIMITS.message).min(1, 'write a message') });
export type RoomMessageInput = z.infer<typeof roomMessageSchema>;

/** `POST /v1/room/ask`: a question for the assistant, posted to the room as the member's message. */
export const roomAskSchema = z.strictObject({ question: text(ROOM_LIMITS.question).min(1, 'ask a question') });
export type RoomAskInput = z.infer<typeof roomAskSchema>;

/** `POST /v1/room/decisions`: a decision, the group's, optionally logged from a message in the room. */
export const roomDecisionSchema = z.strictObject({
  text: text(ROOM_LIMITS.decision).min(1, 'say what was decided'),
  messageId: id.nullable().default(null),
});
export type RoomDecisionInput = z.infer<typeof roomDecisionSchema>;

/** `POST /v1/room/actions`: an action item, its owner someone in the room, its due date optional. */
export const roomActionSchema = z.strictObject({
  task: text(ROOM_LIMITS.task).min(1, 'say what needs doing'),
  ownerId: id,
  due: date.nullable().default(null),
});
export type RoomActionInput = z.infer<typeof roomActionSchema>;

/** `PUT /v1/room/actions/{itemId}`: the item as it should be now. */
export const roomActionUpdateSchema = roomActionSchema.extend({ status: z.enum(['open', 'done']) });
export type RoomActionUpdate = z.infer<typeof roomActionUpdateSchema>;

/** `PUT /v1/room/assistant`: a Membership Admin's kill switch. */
export const roomAssistantSchema = z.strictObject({ on: z.boolean() });
export type RoomAssistantInput = z.infer<typeof roomAssistantSchema>;

/** `GET /v1/room/messages`: a page of history, newest last, before a message (or the latest). */
export const roomHistoryQuerySchema = z.strictObject({ before: id.optional() });
export type RoomHistoryQuery = z.infer<typeof roomHistoryQuerySchema>;

/** `GET /v1/room/updates`: what changed after the feed number `since`, waiting up to `ROOM_LIMITS.waitSeconds`. */
export const roomUpdatesQuerySchema = z.strictObject({
  since: z.coerce.number().int().min(0),
  wait: z.enum(['0', '1']).default('1'),
});
export type RoomUpdatesQuery = z.infer<typeof roomUpdatesQuerySchema>;

/** `room_consents/{accountId}`: the member's acceptance of the terms, or its withdrawal. */
export interface RoomConsentRecord {
  readonly accountId: string;
  readonly termsVersion: number;
  readonly termsHash: string;
  readonly acceptedAt: string;
  /** Set when they left with /leave-room; accepting again clears it. */
  readonly withdrawnAt: string | null;
}

/** Messages a member posts, the assistant's answers, and notices of what was done (a decision logged, the switch). */
export const ROOM_MESSAGE_KINDS = ['member', 'assistant', 'notice'] as const;
export type RoomMessageKind = (typeof ROOM_MESSAGE_KINDS)[number];

/** What an answer cites: a message, a decision or an action item, as it read when cited. */
export interface RoomSource {
  readonly kind: 'message' | 'decision' | 'action';
  readonly id: string;
  readonly excerpt: string;
  readonly at: string;
}

/** A memory item a notice is about, so the page can open it. */
export interface RoomRef {
  readonly kind: RoomMemoryKind;
  readonly itemId: string;
}

/**
 * `room_messages/{messageId}` (UUIDv7, so ID order is time order), with its votes' totals and how many gave each
 * reaction; who did is in `room_reactions` (`./reactions.ts`).
 */
export interface RoomMessageRecord extends VoteTally {
  readonly messageId: string;
  /** The feed number of its last change (made, voted on, reacted to, deleted), so updates are one query. */
  readonly seq: number;
  readonly kind: RoomMessageKind;
  /** The member who posted it, or who did what a notice tells of; null for the assistant. */
  readonly authorId: string | null;
  /** Empty once deleted. */
  readonly body: string;
  readonly createdAt: string;
  /** A question for the assistant (`/ask`). */
  readonly ask: boolean;
  /** An answer's question. */
  readonly replyTo: string | null;
  readonly sources: readonly RoomSource[];
  /** The IDs of an answer's sources, so deleting or forgetting one finds the answers that cite it. */
  readonly cites: readonly string[];
  readonly ref: RoomRef | null;
  readonly reactions: readonly RoomReactionCount[];
  readonly deletedAt: string | null;
  readonly deletedBy: string | null;
  /** When the tick deletes it: `ROOM_RETENTION.messageDays` after it was posted. */
  readonly expireAt: string;
}

/** What a message written before votes and reactions lacks. */
export const NO_REACTIONS: Pick<RoomMessageRecord, 'up' | 'down' | 'score' | 'reactions'> = { ...NO_VOTES, reactions: [] };

export const ROOM_MEMORY_KINDS = ['decision', 'action'] as const;
export type RoomMemoryKind = (typeof ROOM_MEMORY_KINDS)[number];

interface RoomMemoryBase {
  readonly itemId: string;
  readonly seq: number;
  /** A decision's text, or an action item's task. */
  readonly text: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `room_memory/{itemId}`, a decision: the group's, kept until someone removes it. */
export interface RoomDecisionRecord extends RoomMemoryBase {
  readonly kind: 'decision';
  /** The message it was logged from, and what that said (kept after the message is gone). */
  readonly messageId: string | null;
  readonly quote: string | null;
  readonly expireAt: null;
}

/** `room_memory/{itemId}`, an action item: kept until `ROOM_RETENTION.actionDoneDays` after it is done. */
export interface RoomActionRecord extends RoomMemoryBase {
  readonly kind: 'action';
  readonly ownerId: string;
  readonly due: string | null;
  readonly status: 'open' | 'done';
  readonly doneAt: string | null;
  readonly expireAt: string | null;
}

export type RoomMemoryRecord = RoomDecisionRecord | RoomActionRecord;

export type RoomJobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** `room_jobs/{jobId}`: a question waiting for the assistant, run on the worker (design §13). */
export interface RoomJobRecord {
  readonly jobId: string;
  readonly questionId: string;
  readonly askedBy: string;
  readonly question: string;
  readonly state: RoomJobState;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly answerId: string | null;
  /** Why it failed, without the question or anything from the room. */
  readonly error: string | null;
  /** When the tick deletes the record once finished. */
  readonly expireAt: string | null;
}

/**
 * `room_state/feed`: the room's change counter, its switches (the room open, its model server on, the assistant on) and
 * the questions the assistant is working on. Every switch is a change, so open pages learn of it at once.
 */
export interface RoomFeedRecord {
  /** The number of the room's latest change; each change takes the next. */
  readonly seq: number;
  /** The number of the latest change to memory, so pages reload it. */
  readonly memorySeq: number;
  /** The number of the latest time someone entered or left, so pages reload who is in the room. */
  readonly peopleSeq: number;
  readonly assistantOn: boolean;
  readonly switchedAt: string | null;
  readonly switchedBy: string | null;
  /** The question messages waiting for an answer, oldest first. */
  readonly pending: readonly string[];
  /** An admin's switch (Admin › Members' room): closed, nobody uses the room; nothing in it is deleted. */
  readonly open: boolean;
  readonly openChangedAt: string | null;
  readonly openChangedBy: string | null;
  /** A System Admin's switch: off, nothing goes to the model server, so its GPU scales to zero and costs nothing. */
  readonly serverOn: boolean;
  readonly serverChangedAt: string | null;
  readonly serverChangedBy: string | null;
}

export const EMPTY_FEED: RoomFeedRecord = {
  seq: 0,
  memorySeq: 0,
  peopleSeq: 0,
  assistantOn: true,
  switchedAt: null,
  switchedBy: null,
  pending: [],
  open: true,
  openChangedAt: null,
  openChangedBy: null,
  serverOn: true,
  serverChangedAt: null,
  serverChangedBy: null,
};

/** The admins' switches (Admin › Members' room): the room open or closed, its model server on or off. */
export const ROOM_SETTINGS = ['open', 'server'] as const;
export type RoomSetting = (typeof ROOM_SETTINGS)[number];

/** `room.settings_changed`: an admin opened or closed the room, or switched its model server (public to Auditors only). */
export interface RoomSettingsChangedPayload {
  readonly setting: RoomSetting;
  readonly on: boolean;
}

/** `room.consent_changed`: a member accepted the terms or left (Auditors only). */
export interface RoomConsentChangedPayload {
  readonly change: 'accepted' | 'withdrawn';
  readonly termsVersion: number;
  readonly termsHash: string;
}

export const checkRoomMember = (status: string | null | undefined): Check =>
  status === 'active' ? OK : refuse('forbidden', 'the room is for Active members');

/** Whether the member accepted the current terms and has not left since. */
export const inRoom = (consent: RoomConsentRecord | null): boolean =>
  !!consent && consent.withdrawnAt === null && consent.termsVersion === ROOM_TERMS.version;

export const checkInRoom = (consent: RoomConsentRecord | null): Check =>
  inRoom(consent)
    ? OK
    : refuse('forbidden', consent && !consent.withdrawnAt ? 'the room’s terms have changed: accept them to enter again' : 'accept the room’s terms to enter');

/** Accepting the terms shown: the consent record and its ledger entry, written together before the room opens. */
export function acceptTerms(
  current: RoomConsentRecord | null,
  input: RoomConsentInput,
  accountId: string,
  at: string,
): Outcome<{ consent: RoomConsentRecord; event: LedgerEvent }> {
  if (input.version !== ROOM_TERMS.version) return refuse('conflict', 'the terms have changed since you read them: read them again');
  if (inRoom(current)) return refuse('conflict', 'you have already accepted these terms');
  return {
    ok: true,
    value: {
      consent: { accountId, termsVersion: ROOM_TERMS.version, termsHash: ROOM_TERMS_HASH, acceptedAt: at, withdrawnAt: null },
      event: consentEvent(accountId, { change: 'accepted', termsVersion: ROOM_TERMS.version, termsHash: ROOM_TERMS_HASH }),
    },
  };
}

/** `/leave-room`: consent withdrawn, effective from the next request. */
export function withdrawConsent(current: RoomConsentRecord | null, at: string): Outcome<{ consent: RoomConsentRecord; event: LedgerEvent }> {
  if (!current || current.withdrawnAt) return refuse('conflict', 'you are not in the room');
  return {
    ok: true,
    value: {
      consent: { ...current, withdrawnAt: at },
      event: consentEvent(current.accountId, { change: 'withdrawn', termsVersion: current.termsVersion, termsHash: current.termsHash }),
    },
  };
}

const consentEvent = (accountId: string, payload: RoomConsentChangedPayload): LedgerEvent => ({
  type: 'room.consent_changed',
  actor: accountId,
  subject: accountId,
  payload: { ...payload },
});

/** A message as posted, before it takes its feed number. */
export function newMessage(
  fields: Pick<RoomMessageRecord, 'messageId' | 'kind' | 'authorId' | 'body' | 'createdAt'> & Partial<Pick<RoomMessageRecord, 'ask' | 'replyTo' | 'sources' | 'ref'>>,
  seq: number,
): RoomMessageRecord {
  return {
    ask: false,
    replyTo: null,
    sources: [],
    ref: null,
    ...fields,
    cites: (fields.sources ?? []).map((s) => s.id),
    ...NO_REACTIONS,
    seq,
    deletedAt: null,
    deletedBy: null,
    expireAt: expiresAfter(fields.createdAt, ROOM_RETENTION.messageDays),
  };
}

/** Its author deletes a message, or a Membership Admin deletes any: the text is erased and the place stays. */
export function deleteMessage(
  message: RoomMessageRecord | null,
  actor: string,
  moderator: boolean,
  seq: number,
  at: string,
): Outcome<RoomMessageRecord> {
  if (!message || message.deletedAt) return refuse('not_found', 'no such message');
  if (message.kind !== 'member' || message.authorId !== actor) {
    if (!moderator) return refuse('forbidden', 'only its author or a Membership Admin deletes a message');
  }
  return { ok: true, value: erased(message, actor, seq, at) };
}

/**
 * A message with its text gone: deleted, or an answer that cited something since deleted or forgotten (forgetting is
 * real, so nothing the room shows keeps the text). The place stays; its votes and reactions go with the text.
 */
export function erased(message: RoomMessageRecord, actor: string, seq: number, at: string): RoomMessageRecord {
  return { ...message, body: '', sources: [], cites: [], ref: null, ...NO_REACTIONS, deletedAt: at, deletedBy: actor, seq };
}

/** A decision, the group's; logged from a message it keeps a quote of what that said. */
export function newDecision(
  input: RoomDecisionInput,
  from: RoomMessageRecord | null,
  itemId: string,
  actor: string,
  seq: number,
  at: string,
): Outcome<RoomDecisionRecord> {
  if (input.messageId && (!from || from.deletedAt || from.kind !== 'member')) return refuse('not_found', 'no such message');
  return {
    ok: true,
    value: {
      itemId,
      kind: 'decision',
      seq,
      text: input.text,
      createdBy: actor,
      createdAt: at,
      updatedAt: at,
      messageId: input.messageId,
      quote: from ? from.body.slice(0, ROOM_LIMITS.quote) : null,
      expireAt: null,
    },
  };
}

/** An action item for someone in the room. */
export function newAction(input: RoomActionInput, ownerInRoom: boolean, itemId: string, actor: string, seq: number, at: string): Outcome<RoomActionRecord> {
  if (!ownerInRoom) return refuse('conflict', 'its owner must be someone in the room');
  return {
    ok: true,
    value: {
      itemId,
      kind: 'action',
      seq,
      text: input.task,
      createdBy: actor,
      createdAt: at,
      updatedAt: at,
      ownerId: input.ownerId,
      due: input.due,
      status: 'open',
      doneAt: null,
      expireAt: null,
    },
  };
}

/**
 * An action item changed by its owner, whoever added it, or a Membership Admin: done items are deleted
 * `ROOM_RETENTION.actionDoneDays` after they were done, and reopening one keeps it. Null when nothing changed.
 */
export function updateAction(
  item: RoomMemoryRecord | null,
  input: RoomActionUpdate,
  ownerInRoom: boolean,
  actor: string,
  moderator: boolean,
  seq: number,
  at: string,
): Outcome<RoomActionRecord | null> {
  if (!item || item.kind !== 'action') return refuse('not_found', 'no such action item');
  if (!moderator && actor !== item.ownerId && actor !== item.createdBy) {
    return refuse('forbidden', 'its owner, whoever added it, or a Membership Admin changes an action item');
  }
  if (input.ownerId !== item.ownerId && !ownerInRoom) return refuse('conflict', 'its owner must be someone in the room');
  const same = item.text === input.task && item.ownerId === input.ownerId && item.due === input.due && item.status === input.status;
  if (same) return { ok: true, value: null };
  const doneAt = input.status === 'done' ? (item.status === 'done' ? item.doneAt : at) : null;
  return {
    ok: true,
    value: {
      ...item,
      seq,
      text: input.task,
      ownerId: input.ownerId,
      due: input.due,
      status: input.status,
      doneAt,
      expireAt: doneAt ? expiresAfter(doneAt, ROOM_RETENTION.actionDoneDays) : null,
      updatedAt: at,
    },
  };
}

/** `/forget`: whoever added a memory item, or a Membership Admin, deletes it for good. */
export function checkForget(item: RoomMemoryRecord | null, actor: string, moderator: boolean): Check {
  if (!item) return refuse('not_found', 'no such memory item');
  if (!moderator && item.createdBy !== actor) return refuse('forbidden', 'only whoever added it or a Membership Admin can make the assistant forget it');
  return OK;
}

/**
 * A Membership Admin's kill switch: off stops the assistant at once, cancelling the questions it has waiting; on lets
 * it answer again. Decisions, action items and the chat keep working either way.
 */
export function switchAssistant(
  feed: RoomFeedRecord,
  on: boolean,
  actor: string,
  at: string,
): Outcome<{ feed: Omit<RoomFeedRecord, 'seq'>; cancelled: readonly string[]; event: LedgerEvent }> {
  if (feed.assistantOn === on) return refuse('conflict', on ? 'the assistant is already on' : 'the assistant is already off');
  return {
    ok: true,
    value: {
      feed: { ...feed, assistantOn: on, switchedAt: at, switchedBy: actor, pending: on ? feed.pending : [] },
      cancelled: on ? [] : feed.pending,
      event: { type: 'room.assistant_switched', actor, subject: null, payload: { on } },
    },
  };
}

/**
 * An admin opens or closes the room (System or Membership Admin), or a System Admin switches its model server on or
 * off. Switching the server off cancels the questions waiting, as the assistant's own switch does, since none of them
 * may reach the model now.
 */
export function changeRoomSetting(
  feed: RoomFeedRecord,
  setting: RoomSetting,
  on: boolean,
  actor: string,
  at: string,
): Outcome<{ feed: Omit<RoomFeedRecord, 'seq'>; cancelled: readonly string[]; event: LedgerEvent }> {
  const current = setting === 'open' ? feed.open : feed.serverOn;
  if (current === on) {
    return refuse('conflict', setting === 'open' ? `the room is already ${on ? 'open' : 'closed'}` : `the model server is already ${on ? 'on' : 'off'}`);
  }
  const changed: Omit<RoomFeedRecord, 'seq'> =
    setting === 'open'
      ? { ...feed, open: on, openChangedAt: at, openChangedBy: actor }
      : { ...feed, serverOn: on, serverChangedAt: at, serverChangedBy: actor, pending: on ? feed.pending : [] };
  const payload: RoomSettingsChangedPayload = { setting, on };
  return {
    ok: true,
    value: {
      feed: changed,
      cancelled: setting === 'server' && !on ? feed.pending : [],
      event: { type: 'room.settings_changed', actor, subject: null, payload: { ...payload } },
    },
  };
}

/** Whether the room is open: an admin may close it for everyone for a while. */
export const checkRoomOpen = (feed: RoomFeedRecord): Check =>
  feed.open ? OK : refuse('forbidden', 'the room is closed for now: an admin closed it');

/** Whether a member may ask another question, having asked `asked` in the last 24 hours with `pending` waiting room-wide. */
export function checkAsk(feed: RoomFeedRecord, asked: number): Check {
  if (!feed.serverOn) return refuse('conflict', 'a System Admin has switched the room’s model server off; ask again once it is on');
  if (!feed.assistantOn) return refuse('conflict', 'a Membership Admin has switched the assistant off');
  if (feed.pending.length >= ROOM_LIMITS.pending) return refuse('rate_limited', 'the assistant has too many questions waiting; ask again in a minute');
  if (asked >= ROOM_LIMITS.questionsPerDay) return refuse('rate_limited', `you can ask ${ROOM_LIMITS.questionsPerDay} questions in any 24 hours`);
  return OK;
}

/** Whether a member who posted `lastMinute` and `lastDay` messages may post another. */
export function checkMessageRate(lastMinute: number, lastDay: number): Check {
  if (lastMinute >= ROOM_LIMITS.messagesPerMinute) return refuse('rate_limited', 'you are posting very fast; wait a moment');
  if (lastDay >= ROOM_LIMITS.messagesPerDay) return refuse('rate_limited', `you can post ${ROOM_LIMITS.messagesPerDay} messages in any 24 hours`);
  return OK;
}

/**
 * The sources an answer cites, as `[n]` markers numbering the `count` sources it was given: markers outside that range
 * are dropped from the text (the model cited something it was not given), and each source cited is listed once, in the
 * order first cited, with the markers renumbered to match, so `[k]` in the text is the k-th source listed.
 */
export function citations(answer: string, count: number): { text: string; cited: number[] } {
  const cited: number[] = [];
  const text = answer
    .replace(/\[(\d{1,3})\]/g, (_marker, n: string) => {
      const i = Number(n);
      if (i < 1 || i > count) return '';
      if (!cited.includes(i)) cited.push(i);
      return `[${cited.indexOf(i) + 1}]`;
    })
    .replace(/[ \t]+([.,;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return { text, cited };
}

/** Words a memory search matches on: lowercase letters and digits, three or more long, without common words. */
export function searchWords(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(words.filter((w) => !STOP_WORDS.has(w)))];
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'what', 'when', 'who', 'did', 'does', 'was', 'were', 'are', 'about', 'that', 'this', 'from', 'have', 'has', 'how', 'our', 'can', 'will']);

/** Whether a memory item (a record or its view) matches a search: every word appears in its text, quote or due date. */
export function memoryMatches(
  item: { readonly text: string; readonly quote?: string | null; readonly due?: string | null },
  words: readonly string[],
): boolean {
  const hay = [item.text, item.quote, item.due].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
