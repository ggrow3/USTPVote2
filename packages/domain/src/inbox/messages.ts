import { z } from 'zod';
import { deny, OK, refuse, type Check } from '../check.js';
import type { MemberStatus } from '../membership/member-status.js';

/**
 * Messages between members (design §10.13), the party's decision: any Active member can write to any other, one to one.
 * Each conversation is between two accounts; only they read it. A member can block another, which stops that member
 * writing to them without telling them so, and can report a message to the Membership Admins, who then see that one
 * message and nothing else of the conversation. There is a daily limit, and messages are kept a year.
 */

export const MAX_MESSAGE_LENGTH = 2_000;
export const MAX_REPORT_REASON = 500;
/** Messages a member can send in 24 hours, and new people they can start a conversation with. */
export const MESSAGES_PER_DAY = 100;
export const NEW_CONVERSATIONS_PER_DAY = 20;
export const MESSAGE_RETENTION_DAYS = 365;
/** Messages a conversation shows at a time, the latest first loaded; older ones on asking. */
export const MESSAGES_SHOWN = 50;
/** How much of the last message the list of conversations shows. */
export const THREAD_PREVIEW_LENGTH = 140;

/** The one conversation between two accounts, whichever starts it. Account IDs hold no underscore. */
export function threadIdOf(a: string, b: string): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** `member_threads/{threadId}`: a conversation between two accounts. */
export interface MemberThreadRecord {
  readonly threadId: string;
  /** Both accounts, in ID order. */
  readonly members: readonly [string, string];
  /** Who wrote first. */
  readonly createdBy: string;
  readonly createdAt: string;
  readonly lastMessageAt: string;
  readonly lastSenderId: string;
  /** The start of the last message, for the list of conversations. */
  readonly lastText: string;
  /** Each member's messages they have not read yet. */
  readonly unread: Readonly<Record<string, number>>;
  /** When the thread was last written to, for Firestore's TTL: a year after its last message. */
  readonly expireAt?: unknown;
}

/** `member_messages/{messageId}`: one message. Kept a year. */
export interface MemberMessageRecord {
  readonly messageId: string;
  readonly threadId: string;
  readonly from: string;
  readonly to: string;
  readonly body: string;
  readonly sentAt: string;
  /** Reported by the one it was sent to; the report keeps a copy. */
  readonly reportedAt: string | null;
}

/** `member_blocks/{blockerId}_{blockedId}`: one account will get no messages from another. */
export interface MemberBlockRecord {
  readonly blockerId: string;
  readonly blockedId: string;
  readonly at: string;
}

export function blockIdOf(blockerId: string, blockedId: string): string {
  return `${blockerId}_${blockedId}`;
}

/** `message_reports/{reportId}`: a message its recipient reported, with a copy of it, for the Membership Admins. */
export interface MessageReportRecord {
  readonly reportId: string;
  readonly messageId: string;
  readonly threadId: string;
  readonly reportedBy: string;
  /** Who wrote it, and what it said when reported. */
  readonly from: string;
  readonly body: string;
  readonly sentAt: string;
  readonly reason: string;
  readonly status: 'open' | 'closed';
  readonly createdAt: string;
  readonly closedBy: string | null;
  readonly closedAt: string | null;
  /** What the Membership Admin did about it, in their words. */
  readonly note: string | null;
}

/** `POST /v1/messages`: to whom, and what. Plain text. */
export const sendMessageSchema = z.strictObject({
  to: z.string().trim().min(1).max(64),
  body: z.string().trim().min(1, 'write a message').max(MAX_MESSAGE_LENGTH),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/** `POST /v1/messages/{messageId}/report`. */
export const reportMessageSchema = z.strictObject({ reason: z.string().trim().min(1, 'say what is wrong with it').max(MAX_REPORT_REASON) });
export type ReportMessageInput = z.infer<typeof reportMessageSchema>;

/** `POST /v1/admin/message-reports/{reportId}/close`. */
export const closeReportSchema = z.strictObject({ note: z.string().trim().max(MAX_REPORT_REASON).optional() });
export type CloseReportInput = z.infer<typeof closeReportSchema>;

/**
 * Whether one member may write to another now: both Active, not themselves, neither blocking the other, within the day's
 * limits. A block by the recipient is refused like a recipient who cannot get messages, so the sender is not told of it.
 */
export function checkCanMessage(input: {
  readonly from: string;
  readonly to: string;
  readonly fromStatus: MemberStatus | null;
  readonly toStatus: MemberStatus | null;
  /** The sender has blocked the recipient. */
  readonly blocking: boolean;
  /** The recipient has blocked the sender. */
  readonly blockedBy: boolean;
  readonly sentToday: number;
  /** Whether this starts a conversation, and how many the sender started today. */
  readonly newConversation: boolean;
  readonly startedToday: number;
}): Check {
  if (input.from === input.to) return deny('you cannot write to yourself');
  if (input.fromStatus !== 'active') return refuse('forbidden', 'only Active members can send messages');
  if (input.toStatus !== 'active' || input.blockedBy) return refuse('forbidden', 'this member cannot get messages from you');
  if (input.blocking) return deny('you have blocked this member; unblock them to write to them');
  if (input.sentToday >= MESSAGES_PER_DAY) return refuse('rate_limited', `you have sent ${MESSAGES_PER_DAY} messages in the last day`);
  if (input.newConversation && input.startedToday >= NEW_CONVERSATIONS_PER_DAY) {
    return refuse('rate_limited', `you have written to ${NEW_CONVERSATIONS_PER_DAY} new people in the last day`);
  }
  return OK;
}

/** The thread after a message: its preview, and one more unread for the recipient. */
export function threadAfterMessage(current: MemberThreadRecord | null, message: Pick<MemberMessageRecord, 'threadId' | 'from' | 'to' | 'body' | 'sentAt'>): MemberThreadRecord {
  const { threadId, from, to, body, sentAt } = message;
  const lastText = oneLine(body).slice(0, THREAD_PREVIEW_LENGTH);
  if (!current) {
    const members = (from < to ? [from, to] : [to, from]) as [string, string];
    return { threadId, members, createdBy: from, createdAt: sentAt, lastMessageAt: sentAt, lastSenderId: from, lastText, unread: { [from]: 0, [to]: 1 } };
  }
  const { expireAt: _expireAt, ...thread } = current;
  return { ...thread, lastMessageAt: sentAt, lastSenderId: from, lastText, unread: { ...current.unread, [from]: 0, [to]: (current.unread[to] ?? 0) + 1 } };
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** The other member of a conversation. */
export function otherMember(thread: Pick<MemberThreadRecord, 'members'>, accountId: string): string {
  return thread.members[0] === accountId ? thread.members[1] : thread.members[0];
}

/** Someone in a conversation, as the other sees them: their name, and whether they can get messages now. */
export interface MessagePerson {
  readonly accountId: string;
  readonly name: string;
  readonly active: boolean;
}

/** `GET /v1/messages`: one of the caller's conversations. */
export interface ThreadSummary {
  readonly threadId: string;
  readonly with: MessagePerson;
  readonly lastMessageAt: string;
  readonly lastText: string;
  readonly lastFromMe: boolean;
  readonly unread: number;
  /** The caller has blocked them. */
  readonly blocking: boolean;
}

export interface MessageView {
  readonly messageId: string;
  readonly fromMe: boolean;
  readonly body: string;
  readonly sentAt: string;
  /** The caller reported it. */
  readonly reported: boolean;
}

/** `GET /v1/messages/{threadId}`: oldest first, the latest `MESSAGES_SHOWN`, or those before `before`. */
export interface ThreadView {
  readonly threadId: string;
  readonly with: MessagePerson;
  readonly messages: readonly MessageView[];
  /** Pass as `before` for older messages; null when there are none. */
  readonly older: string | null;
  readonly blocking: boolean;
}

/** `GET /v1/messages/people?name=`: Active members by name, to write to. */
export interface MessagePeopleMatch {
  readonly accountId: string;
  readonly name: string;
}

/** `GET /v1/admin/message-reports`: for Membership Admins, the reported message alone. */
export interface MessageReportView extends Omit<MessageReportRecord, 'threadId' | 'closedBy'> {
  readonly fromName: string | null;
  readonly reportedByName: string | null;
  readonly closedByName: string | null;
}
