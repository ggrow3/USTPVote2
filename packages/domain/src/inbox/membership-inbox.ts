import { z } from 'zod';
import { deny, OK, refuse, type Check } from '../check.js';
import type { MemberStatus } from '../membership/member-status.js';
import type { MailAddressState } from '../notifications/my-email.js';

/**
 * The membership inbox (design §10.13), the party's decisions: the Membership Admins share one inbox of conversations
 * between "the membership team" and each member. Either side can start one; each has a subject, and a status the team
 * works by: it needs an answer while the member wrote last, is answered once the team wrote, and is closed when done.
 * A conversation can be assigned to one Membership Admin, and the team can add notes the member never sees. What the
 * team writes reaches the member in the app and by email, as membership business, so whether or not they chose to get
 * news and announcements, but through the same gate as all the site's email (§10.12). Kept two years after the last
 * message; deleted with the member's account.
 */

/** Conversations in the shared inbox: needs an answer (`open`), the team answered (`answered`), done (`closed`). */
export const INBOX_STATUSES = ['open', 'answered', 'closed'] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

export const MAX_INBOX_SUBJECT = 150;
export const MAX_INBOX_MESSAGE = 5_000;
/** A conversation that long is better started afresh. */
export const MAX_INBOX_CONVERSATION = 200;
export const INBOX_RETENTION_DAYS = 730;
/** A member may start this many conversations with the team, and send this many messages to it, in 24 hours. */
export const MEMBER_INBOX_STARTS_PER_DAY = 3;
export const MEMBER_INBOX_MESSAGES_PER_DAY = 20;
/**
 * Conversations one Membership Admin may start in 24 hours. The inbox is for one member at a time; an email to many goes
 * through Email members, with its consent and approval (§10.12).
 */
export const TEAM_INBOX_STARTS_PER_DAY = 50;
/** Conversations listed a page at a time. */
export const INBOX_PAGE = 50;
/** How much of the last message a list shows. */
export const INBOX_PREVIEW_LENGTH = 140;

/** Who wrote: the member, or one of the Membership Admins for the team. */
export type InboxSide = 'member' | 'team';

/** `membership_threads/{threadId}`: one conversation between the membership team and a member. */
export interface MembershipThreadRecord {
  readonly threadId: string;
  /** The member it is with. */
  readonly accountId: string;
  readonly subject: string;
  readonly status: InboxStatus;
  /** The Membership Admin it is assigned to; null for the whole team. */
  readonly assignedTo: string | null;
  readonly startedBy: InboxSide;
  /** The account that wrote first: the member, or the Membership Admin. */
  readonly createdBy: string;
  readonly createdAt: string;
  /** The last message either side wrote; notes leave it as it was. */
  readonly lastMessageAt: string;
  readonly lastFrom: InboxSide;
  readonly lastText: string;
  /** Messages and notes in it, for the limit. */
  readonly messageCount: number;
  /** The team's messages the member has not read yet, and when they last opened it. */
  readonly memberUnread: number;
  readonly memberReadAt: string | null;
  /** The last change of any kind: a message, a note, its status or who it is assigned to. */
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/** Whether an email of a team message went: waiting for the worker, taken by the mail service, or not sent and why. */
export type InboxEmailStatus = 'pending' | 'sent' | 'not_sent';
/**
 * Why it was not sent: all of the site's email is off, the member has no confirmed address or it bounced or was marked
 * as spam, they unsubscribed or an admin stopped their email, or the mail service failed for a day.
 */
export type InboxEmailSkip = 'email_off' | 'no_address' | 'unverified' | 'undeliverable' | 'unsubscribed' | 'email_stopped' | 'failed';

export interface InboxEmail {
  readonly status: InboxEmailStatus;
  readonly reason: InboxEmailSkip | null;
  readonly at: string | null;
}

/** `membership_messages/{messageId}`: one message or note in a conversation. */
export interface MembershipMessageRecord {
  readonly messageId: string;
  readonly threadId: string;
  /** The member the conversation is with, so their account's deletion finds it. */
  readonly accountId: string;
  readonly from: InboxSide;
  /** Who wrote it: the member, or the Membership Admin. */
  readonly authorId: string;
  /** A note for the team: the member never sees it, and it is never emailed. */
  readonly note: boolean;
  readonly body: string;
  readonly sentAt: string;
  /** A team message's email to the member; null for the member's own messages and for notes. */
  readonly email: InboxEmail | null;
  /** True while the worker has still to send its email. */
  readonly emailPending: boolean;
}

const subject = z.string().trim().min(1, 'give it a subject').max(MAX_INBOX_SUBJECT);
const body = z.string().trim().min(1, 'write a message').max(MAX_INBOX_MESSAGE);

/** `POST /v1/membership-team`: a member writes to the team. */
export const startTeamConversationSchema = z.strictObject({ subject, body });
export type StartTeamConversationInput = z.infer<typeof startTeamConversationSchema>;

/** `POST /v1/admin/inbox`: a Membership Admin writes to a member. */
export const startMemberConversationSchema = z.strictObject({ accountId: z.string().trim().min(1).max(64), subject, body });
export type StartMemberConversationInput = z.infer<typeof startMemberConversationSchema>;

/** `POST /v1/membership-team/{threadId}`: the member answers. */
export const memberReplySchema = z.strictObject({ body });
export type MemberReplyInput = z.infer<typeof memberReplySchema>;

/** `POST /v1/admin/inbox/{threadId}/messages`: the team answers, closing it at the same time if asked, or adds a note. */
export const teamReplySchema = z
  .strictObject({ body, note: z.boolean().optional(), close: z.boolean().optional() })
  .refine((v) => !(v.note && v.close), { message: 'a note does not close a conversation', path: ['close'] });
export type TeamReplyInput = z.infer<typeof teamReplySchema>;

/** `POST /v1/admin/inbox/{threadId}/status`: closed when done, open again when it needs an answer after all. */
export const inboxStatusSchema = z.strictObject({ status: z.enum(['open', 'closed']) });
export type InboxStatusInput = z.infer<typeof inboxStatusSchema>;

/** `POST /v1/admin/inbox/{threadId}/assign`: to one Membership Admin, or null for the whole team. */
export const inboxAssignSchema = z.strictObject({ accountId: z.string().trim().min(1).max(64).nullable() });
export type InboxAssignInput = z.infer<typeof inboxAssignSchema>;

/** `GET /v1/admin/inbox`: which conversations. */
export const inboxQuerySchema = z.strictObject({
  status: z.enum([...INBOX_STATUSES, 'all']).optional(),
  /** Assigned to the caller, to nobody, or anyone (absent). */
  assigned: z.enum(['me', 'nobody']).optional(),
  /** One member's conversations, every status. */
  account: z.string().trim().min(1).max(64).optional(),
  after: z.string().trim().min(1).max(200).optional(),
});
export type InboxQuery = z.infer<typeof inboxQuerySchema>;

/**
 * Whether a member may write to the team now: any member record will do, whatever its status, since an applicant or a
 * lapsed member may need the team most. Within the day's limits; and a conversation of `MAX_INBOX_CONVERSATION` is full.
 */
export function checkMemberCanWrite(input: {
  readonly status: MemberStatus | null;
  readonly sentToday: number;
  readonly newConversation: boolean;
  readonly startedToday: number;
  readonly messageCount: number;
}): Check {
  if (!input.status) return refuse('forbidden', 'only members and applicants can write to the membership team');
  if (input.messageCount >= MAX_INBOX_CONVERSATION) return refuse('conflict', 'this conversation is full: start a new one');
  if (input.sentToday >= MEMBER_INBOX_MESSAGES_PER_DAY) {
    return refuse('rate_limited', `you have written to the membership team ${MEMBER_INBOX_MESSAGES_PER_DAY} times in the last day`);
  }
  if (input.newConversation && input.startedToday >= MEMBER_INBOX_STARTS_PER_DAY) {
    return refuse('rate_limited', `you have started ${MEMBER_INBOX_STARTS_PER_DAY} conversations with the membership team in the last day`);
  }
  return OK;
}

/** Whether a Membership Admin may write in a conversation, or start one with a member. */
export function checkTeamCanWrite(input: {
  readonly memberStatus: MemberStatus | null;
  readonly newConversation: boolean;
  readonly startedToday: number;
  readonly messageCount: number;
  /** The member is the Membership Admin themselves. */
  readonly self: boolean;
}): Check {
  if (input.self) return deny('you cannot write to yourself as the membership team');
  if (input.newConversation && !input.memberStatus) return refuse('not_found', 'no member or applicant has that account');
  if (input.messageCount >= MAX_INBOX_CONVERSATION) return refuse('conflict', 'this conversation is full: start a new one');
  if (input.newConversation && input.startedToday >= TEAM_INBOX_STARTS_PER_DAY) {
    return refuse(
      'rate_limited',
      `you have started ${TEAM_INBOX_STARTS_PER_DAY} conversations in the last day: to write to many members, use Email members`,
    );
  }
  return OK;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** A new message or note in a conversation, its email waiting if the team wrote it to the member. */
export function inboxMessage(input: {
  readonly messageId: string;
  readonly threadId: string;
  readonly accountId: string;
  readonly from: InboxSide;
  readonly authorId: string;
  readonly note: boolean;
  readonly body: string;
  readonly at: string;
}): MembershipMessageRecord {
  const emailed = input.from === 'team' && !input.note;
  return {
    messageId: input.messageId,
    threadId: input.threadId,
    accountId: input.accountId,
    from: input.from,
    authorId: input.authorId,
    note: input.from === 'team' && input.note,
    body: input.body,
    sentAt: input.at,
    email: emailed ? { status: 'pending', reason: null, at: null } : null,
    emailPending: emailed,
  };
}

/**
 * The conversation after a message or note: a member's message makes it need an answer again (a closed one too), the
 * team's makes it answered, or closed when they close it with it; a note changes neither its status nor its last message.
 */
export function threadAfterInboxMessage(
  current: MembershipThreadRecord | null,
  input: { readonly subject?: string; readonly close?: boolean },
  message: MembershipMessageRecord,
): MembershipThreadRecord {
  const at = message.sentAt;
  if (!current) {
    const status: InboxStatus = message.from === 'member' ? 'open' : input.close ? 'closed' : 'answered';
    return {
      threadId: message.threadId,
      accountId: message.accountId,
      subject: oneLine(input.subject ?? ''),
      status,
      assignedTo: null,
      startedBy: message.from,
      createdBy: message.authorId,
      createdAt: at,
      lastMessageAt: at,
      lastFrom: message.from,
      lastText: oneLine(message.body).slice(0, INBOX_PREVIEW_LENGTH),
      messageCount: 1,
      memberUnread: message.from === 'team' ? 1 : 0,
      memberReadAt: null,
      updatedAt: at,
      updatedBy: message.authorId,
    };
  }
  const base = { ...current, messageCount: current.messageCount + 1, updatedAt: at, updatedBy: message.authorId };
  if (message.note) return base;
  return {
    ...base,
    status: message.from === 'member' ? 'open' : input.close ? 'closed' : 'answered',
    lastMessageAt: at,
    lastFrom: message.from,
    lastText: oneLine(message.body).slice(0, INBOX_PREVIEW_LENGTH),
    memberUnread: message.from === 'team' ? current.memberUnread + 1 : current.memberUnread,
  };
}

/** A list's place: after the conversation last written to at `lastMessageAt`, by its ID. */
export function inboxCursor(thread: Pick<MembershipThreadRecord, 'lastMessageAt' | 'threadId'>): string {
  return `${thread.lastMessageAt}|${thread.threadId}`;
}

export function parseInboxCursor(value: string): { lastMessageAt: string; threadId: string } | null {
  const at = value.indexOf('|');
  if (at < 1) return null;
  const lastMessageAt = value.slice(0, at);
  const threadId = value.slice(at + 1);
  return Number.isNaN(Date.parse(lastMessageAt)) || !threadId ? null : { lastMessageAt, threadId };
}

/** Whether the member could get the team's email now, and if not why: from their address and the site's switch. */
export function inboxEmailSkip(mail: MailAddressState, allEmails: boolean): InboxEmailSkip | null {
  if (!allEmails) return 'email_off';
  switch (mail) {
    case 'ok':
      return null;
    case 'bounced':
    case 'complained':
      return 'undeliverable';
    default:
      return mail;
  }
}

// --- views --------------------------------------------------------------------------------------------------------

/** `GET /v1/admin/inbox`: one conversation in the list. */
export interface InboxThreadSummary {
  readonly threadId: string;
  readonly accountId: string;
  readonly memberName: string;
  readonly subject: string;
  readonly status: InboxStatus;
  readonly assignedTo: string | null;
  readonly assignedToName: string | null;
  readonly startedBy: InboxSide;
  readonly createdAt: string;
  readonly lastMessageAt: string;
  readonly lastFrom: InboxSide;
  readonly lastText: string;
}

export interface InboxPage {
  readonly threads: readonly InboxThreadSummary[];
  /** Pass as `after` for the next page; null at the end. */
  readonly next: string | null;
  /** How many need an answer: in all, and of those assigned to the caller. */
  readonly counts: { readonly open: number; readonly openMine: number };
}

/** A message or note as the team sees it. */
export interface InboxMessageView {
  readonly messageId: string;
  readonly from: InboxSide;
  readonly authorId: string;
  readonly authorName: string;
  readonly note: boolean;
  readonly body: string;
  readonly sentAt: string;
  readonly email: InboxEmail | null;
}

/** `GET /v1/admin/inbox/{threadId}`: the whole conversation, oldest first, with the member and whether email reaches them. */
export interface InboxThreadView extends InboxThreadSummary {
  readonly memberStatus: MemberStatus | null;
  readonly memberReadAt: string | null;
  readonly messages: readonly InboxMessageView[];
  /** Why the team's email would not reach the member now; null when it would. */
  readonly emailSkip: InboxEmailSkip | null;
}

/** `GET /v1/admin/inbox/team`: the Membership Admins, to assign a conversation to. */
export interface InboxTeamMember {
  readonly accountId: string;
  readonly name: string;
}

/** `GET /v1/membership-team`: one of the member's conversations with the team. */
export interface MyTeamThreadSummary {
  readonly threadId: string;
  readonly subject: string;
  /** Closed when the team closed it; the member's next message opens it again. */
  readonly closed: boolean;
  readonly lastMessageAt: string;
  readonly lastFromTeam: boolean;
  readonly lastText: string;
  readonly unread: number;
}

/** A message as the member sees it: the team's are from "the membership team", without the admin's name. */
export interface MyTeamMessageView {
  readonly messageId: string;
  readonly fromTeam: boolean;
  readonly body: string;
  readonly sentAt: string;
}

/** `GET /v1/membership-team/{threadId}`: oldest first, without the team's notes. */
export interface MyTeamThreadView extends MyTeamThreadSummary {
  readonly messages: readonly MyTeamMessageView[];
}
