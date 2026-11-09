import { BadRequestException, Inject, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import {
  INBOX_PAGE,
  checkMemberCanWrite,
  checkTeamCanWrite,
  inboxCursor,
  inboxEmailSkip,
  inboxMessage,
  parseInboxCursor,
  threadAfterInboxMessage,
  type InboxPage,
  type InboxQuery,
  type InboxStatus,
  type InboxTeamMember,
  type InboxThreadSummary,
  type InboxThreadView,
  type MemberRecord,
  type MembershipMessageRecord,
  type MembershipThreadRecord,
  type MyTeamThreadSummary,
  type MyTeamThreadView,
} from 'ustp-domain';
import { DirectoryService } from '../auth/directory.service.js';
import { assertCheck } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { MailRecords } from '../notifications/mail-records.js';
import { NoticeSettingsService } from '../notifications/notice-settings.js';
import { InboxNotices } from './inbox.service.js';
import { MembershipInboxRepository } from './membership-inbox.repository.js';

const DAY_MS = 86_400_000;
/** A member's conversations with the team listed at most, on their Messages page and on their record. */
const MEMBER_THREADS_SHOWN = 50;

/** Where a member reads a conversation with the team, and where the team does. */
export const memberThreadPath = (threadId: string) => `/messages/team/${threadId}`;
export const teamThreadPath = (threadId: string) => `/admin/inbox/${threadId}`;

const nameOf = (member: MemberRecord | null | undefined): string | null => (member ? member.preferredName || member.legalName : null);

/**
 * The membership inbox (design §10.13): conversations between the membership team, which is the Membership Admins, and
 * each member, either side starting one. The team shares them all, assigns them, closes them and adds notes; the member
 * sees "the membership team", never which admin wrote. What the team writes is emailed to the member by the worker
 * (`MembershipMailer`). Not ledgered: the conversation is its own record, and its emails are in the email log.
 */
@Injectable()
export class MembershipInboxService {
  constructor(
    private readonly firebase: Firebase,
    private readonly inbox: MembershipInboxRepository,
    private readonly notices: InboxNotices,
    private readonly members: MemberDirectory,
    private readonly directory: DirectoryService,
    private readonly mail: MailRecords,
    private readonly settings: NoticeSettingsService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Each account's name now: a member's own, else the account's display name. */
  private async names(accountIds: readonly (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(accountIds.filter((id): id is string => !!id))];
    const [records, names] = await Promise.all([this.members.findMany(ids), this.directory.displayNames(ids)]);
    return new Map(ids.flatMap((id, i) => {
      const name = nameOf(records[i]) ?? names.get(id);
      return name ? [[id, name] as const] : [];
    }));
  }

  private summary(thread: MembershipThreadRecord, names: Map<string, string>): InboxThreadSummary {
    return {
      threadId: thread.threadId,
      accountId: thread.accountId,
      memberName: names.get(thread.accountId) ?? 'A former member',
      subject: thread.subject,
      status: thread.status,
      assignedTo: thread.assignedTo,
      assignedToName: thread.assignedTo ? (names.get(thread.assignedTo) ?? 'A former admin') : null,
      startedBy: thread.startedBy,
      createdAt: thread.createdAt,
      lastMessageAt: thread.lastMessageAt,
      lastFrom: thread.lastFrom,
      lastText: thread.lastText,
    };
  }

  // --- the team -------------------------------------------------------------------------------------------------------

  /** A page of the shared inbox; or, with `account`, every conversation with that member. */
  async page(callerId: string, query: InboxQuery): Promise<InboxPage> {
    const status = query.status && query.status !== 'all' ? query.status : undefined;
    const assignedTo = query.assigned === 'me' ? callerId : query.assigned === 'nobody' ? null : undefined;
    let threads: MembershipThreadRecord[];
    let next: string | null = null;
    if (query.account) {
      threads = (await this.inbox.ofMember(query.account, MEMBER_THREADS_SHOWN)).filter(
        (t) => (!status || t.status === status) && (assignedTo === undefined || t.assignedTo === assignedTo),
      );
    } else {
      const after = query.after ? parseInboxCursor(query.after) : null;
      if (query.after && !after) throw new BadRequestException('invalid query parameter after');
      threads = await this.inbox.page({ status, assignedTo }, after, INBOX_PAGE + 1);
      if (threads.length > INBOX_PAGE) {
        threads = threads.slice(0, INBOX_PAGE);
        next = inboxCursor(threads.at(-1)!);
      }
    }
    const [names, counts] = await Promise.all([this.names(threads.flatMap((t) => [t.accountId, t.assignedTo])), this.inbox.openCounts(callerId)]);
    return { threads: threads.map((t) => this.summary(t, names)), next, counts };
  }

  /** The Membership Admins, to assign a conversation to. */
  team(): Promise<InboxTeamMember[]> {
    return this.directory.roleHolders('membership_admin');
  }

  private async teamView(thread: MembershipThreadRecord): Promise<InboxThreadView> {
    const [messages, member, mail, settings] = await Promise.all([
      this.inbox.messagesOf(thread.threadId),
      this.members.find(thread.accountId),
      this.mail.state(thread.accountId),
      this.settings.current(),
    ]);
    const names = await this.names([thread.accountId, thread.assignedTo, ...messages.map((m) => m.authorId)]);
    const allEmails = this.config.mailTransport !== 'off' && settings.allEmails;
    return {
      ...this.summary(thread, names),
      memberStatus: member?.status ?? null,
      memberReadAt: thread.memberReadAt,
      messages: messages.map((m) => ({
        messageId: m.messageId,
        from: m.from,
        authorId: m.authorId,
        authorName: names.get(m.authorId) ?? (m.from === 'team' ? 'A former admin' : 'A former member'),
        note: m.note,
        body: m.body,
        sentAt: m.sentAt,
        email: m.email,
      })),
      emailSkip: inboxEmailSkip(mail.state, allEmails),
    };
  }

  private async found(threadId: string): Promise<MembershipThreadRecord> {
    const thread = await this.inbox.thread(threadId);
    if (!thread) throw new NotFoundException('no such conversation');
    return thread;
  }

  /** A whole conversation, for the team; the caller's notification about it is read. */
  async thread(callerId: string, threadId: string): Promise<InboxThreadView> {
    const view = await this.teamView(await this.found(threadId));
    await this.notices.readAbout(callerId, 'membership_inbox', threadId);
    return view;
  }

  /** A Membership Admin writes to a member, starting a conversation; it is emailed to them by the worker. */
  async start(callerId: string, input: { accountId: string; subject: string; body: string }): Promise<InboxThreadView> {
    const threadRef = this.inbox.threadRef();
    const threadId = threadRef.id;
    const message = inboxMessage({
      messageId: this.inbox.messageRef().id,
      threadId,
      accountId: input.accountId,
      from: 'team',
      authorId: callerId,
      note: false,
      body: input.body,
      at: new Date().toISOString(),
    });
    const thread = threadAfterInboxMessage(null, { subject: input.subject }, message);
    await this.firebase.db.runTransaction(async (tx) => {
      const [[member], written] = await Promise.all([
        this.members.getAll(tx, [input.accountId]),
        this.inbox.writtenSince(tx, callerId, 'team', new Date(Date.parse(message.sentAt) - DAY_MS).toISOString()),
      ]);
      assertCheck(
        checkTeamCanWrite({ memberStatus: member?.status ?? null, newConversation: true, startedToday: written.started, messageCount: 0, self: input.accountId === callerId }),
      );
      const notify = await this.notices.prepare(tx, input.accountId, this.memberNotice(thread), message.sentAt);
      this.inbox.setThread(tx, thread);
      this.inbox.createMessage(tx, message, thread.lastMessageAt);
      notify();
    });
    return this.teamView(thread);
  }

  private memberNotice(thread: MembershipThreadRecord) {
    return { kind: 'membership_message' as const, ref: thread.threadId, title: `The membership team wrote to you: ${thread.subject}`, link: memberThreadPath(thread.threadId) };
  }

  /**
   * The team answers (closing it too, if asked), which goes to the member in the app and by email, or adds a note only
   * the team sees. An answer settles it, so every Membership Admin's notification about it is read.
   */
  async reply(callerId: string, threadId: string, input: { body: string; note?: boolean; close?: boolean }): Promise<InboxThreadView> {
    const note = !!input.note;
    const message = inboxMessage({ messageId: this.inbox.messageRef().id, threadId, accountId: '', from: 'team', authorId: callerId, note, body: input.body, at: new Date().toISOString() });
    const thread = await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.inbox.thread(threadId, tx);
      if (!current) throw new NotFoundException('no such conversation');
      assertCheck(checkTeamCanWrite({ memberStatus: null, newConversation: false, startedToday: 0, messageCount: current.messageCount, self: current.accountId === callerId }));
      const record: MembershipMessageRecord = { ...message, accountId: current.accountId };
      const next = threadAfterInboxMessage(current, { close: input.close }, record);
      const notify = note ? null : await this.notices.prepare(tx, current.accountId, this.memberNotice(next), record.sentAt);
      this.inbox.setThread(tx, next);
      this.inbox.createMessage(tx, record, next.lastMessageAt);
      notify?.();
      return next;
    });
    if (!note) {
      await this.inbox.keepMessages(threadId, thread.lastMessageAt);
      await this.notices.readAboutAll('membership_inbox', threadId);
    }
    return this.teamView(thread);
  }

  /** Closed when done, or open again when it needs an answer after all. */
  async setStatus(callerId: string, threadId: string, status: Extract<InboxStatus, 'open' | 'closed'>): Promise<InboxThreadView> {
    const thread = await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.inbox.thread(threadId, tx);
      if (!current) throw new NotFoundException('no such conversation');
      if (current.status === status) throw new ConflictException(`this conversation is ${status} already`);
      const next: MembershipThreadRecord = { ...current, status, updatedAt: new Date().toISOString(), updatedBy: callerId };
      this.inbox.setThread(tx, next);
      return next;
    });
    if (status === 'closed') await this.notices.readAboutAll('membership_inbox', threadId);
    return this.teamView(thread);
  }

  /** Assigns a conversation to one Membership Admin, who is told, or back to the whole team. */
  async assign(callerId: string, threadId: string, accountId: string | null): Promise<InboxThreadView> {
    if (accountId && !(await this.team()).some((a) => a.accountId === accountId)) {
      throw new ConflictException('only a Membership Admin can be given a conversation');
    }
    const thread = await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.inbox.thread(threadId, tx);
      if (!current) throw new NotFoundException('no such conversation');
      const next: MembershipThreadRecord = { ...current, assignedTo: accountId, updatedAt: new Date().toISOString(), updatedBy: callerId };
      this.inbox.setThread(tx, next);
      return next;
    });
    if (accountId && accountId !== callerId) {
      const names = await this.names([callerId, thread.accountId]);
      await this.notices.notify([accountId], {
        kind: 'membership_inbox',
        ref: threadId,
        title: `${names.get(callerId) ?? 'A Membership Admin'} gave you a conversation with ${names.get(thread.accountId) ?? 'a member'}: ${thread.subject}`,
        link: teamThreadPath(threadId),
      });
    }
    return this.teamView(thread);
  }

  // --- the member -----------------------------------------------------------------------------------------------------

  private mySummary(thread: MembershipThreadRecord): MyTeamThreadSummary {
    return {
      threadId: thread.threadId,
      subject: thread.subject,
      closed: thread.status === 'closed',
      lastMessageAt: thread.lastMessageAt,
      lastFromTeam: thread.lastFrom === 'team',
      lastText: thread.lastText,
      unread: thread.memberUnread,
    };
  }

  private async mine(accountId: string, threadId: string): Promise<MembershipThreadRecord> {
    const thread = await this.inbox.thread(threadId);
    // Someone else's is not there, as far as they can tell.
    if (!thread || thread.accountId !== accountId) throw new NotFoundException('no such conversation');
    return thread;
  }

  private async myView(thread: MembershipThreadRecord): Promise<MyTeamThreadView> {
    const messages = await this.inbox.messagesOf(thread.threadId);
    return {
      ...this.mySummary(thread),
      messages: messages.filter((m) => !m.note).map((m) => ({ messageId: m.messageId, fromTeam: m.from === 'team', body: m.body, sentAt: m.sentAt })),
    };
  }

  async myThreads(accountId: string): Promise<MyTeamThreadSummary[]> {
    return (await this.inbox.ofMember(accountId, MEMBER_THREADS_SHOWN)).map((t) => this.mySummary(t));
  }

  async myThread(accountId: string, threadId: string): Promise<MyTeamThreadView> {
    return this.myView(await this.mine(accountId, threadId));
  }

  /** A member writes to the team: a new conversation, or an answer in theirs. The team is notified. */
  async write(accountId: string, input: { threadId?: string; subject?: string; body: string }): Promise<MyTeamThreadView> {
    const threadId = input.threadId ?? this.inbox.threadRef().id;
    const message = inboxMessage({
      messageId: this.inbox.messageRef().id,
      threadId,
      accountId,
      from: 'member',
      authorId: accountId,
      note: false,
      body: input.body,
      at: new Date().toISOString(),
    });
    const { before, thread } = await this.firebase.db.runTransaction(async (tx) => {
      const [current, [member], written] = await Promise.all([
        input.threadId ? this.inbox.thread(input.threadId, tx) : Promise.resolve(null),
        this.members.getAll(tx, [accountId]),
        this.inbox.writtenSince(tx, accountId, 'member', new Date(Date.parse(message.sentAt) - DAY_MS).toISOString()),
      ]);
      if (input.threadId && (!current || current.accountId !== accountId)) throw new NotFoundException('no such conversation');
      assertCheck(
        checkMemberCanWrite({
          status: member?.status ?? null,
          sentToday: written.messages,
          newConversation: !current,
          startedToday: written.started,
          messageCount: current?.messageCount ?? 0,
        }),
      );
      const next = threadAfterInboxMessage(current, { subject: input.subject }, message);
      this.inbox.setThread(tx, next);
      this.inbox.createMessage(tx, message, next.lastMessageAt);
      return { before: current, thread: next };
    });
    if (before) await this.inbox.keepMessages(threadId, thread.lastMessageAt);
    await this.notifyTeam(thread, !before);
    return this.myView(thread);
  }

  /** Whoever the conversation is assigned to, or every Membership Admin, but never the member themselves. */
  private async notifyTeam(thread: MembershipThreadRecord, started: boolean): Promise<void> {
    const to = thread.assignedTo ? [thread.assignedTo] : (await this.team()).map((a) => a.accountId);
    const name = (await this.names([thread.accountId])).get(thread.accountId) ?? 'A member';
    await this.notices.notify(
      to.filter((id) => id !== thread.accountId),
      {
        kind: 'membership_inbox',
        ref: thread.threadId,
        title: started ? `${name} wrote to the membership team: ${thread.subject}` : `${name} answered: ${thread.subject}`,
        link: teamThreadPath(thread.threadId),
      },
    );
  }

  /** The member opened the conversation: the team's messages are read, and the team sees when. */
  async markRead(accountId: string, threadId: string): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.inbox.thread(threadId, tx);
      if (!current || current.accountId !== accountId) throw new NotFoundException('no such conversation');
      this.inbox.setThread(tx, { ...current, memberUnread: 0, memberReadAt: new Date().toISOString() });
    });
    await this.notices.readAbout(accountId, 'membership_message', threadId);
  }
}
