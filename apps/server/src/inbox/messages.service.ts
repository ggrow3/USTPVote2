import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MESSAGES_SHOWN,
  checkCanMessage,
  otherMember,
  threadAfterMessage,
  threadIdOf,
  type MemberMessageRecord,
  type MemberRecord,
  type MessagePeopleMatch,
  type MessagePerson,
  type MessageReportRecord,
  type MessageReportView,
  type MessageView,
  type ThreadSummary,
  type ThreadView,
} from 'ustp-domain';
import { DirectoryService } from '../auth/directory.service.js';
import { assertCheck } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { InboxRepository } from './inbox.repository.js';
import { InboxNotices } from './inbox.service.js';

const THREADS_SHOWN = 50;
const REPORTS_SHOWN = 50;
const PEOPLE_SHOWN = 20;
const DAY_MS = 86_400_000;

/** The one notification Membership Admins have about reported messages while it is unread. */
const REPORTS_REF = 'reports';

const nameOf = (member: MemberRecord | null | undefined): string | null => (member ? member.preferredName || member.legalName : null);

/**
 * Messages between members (design §10.13): any Active member writes to any other, one to one. Only the two read a
 * conversation; a member can block another and report a message, which Membership Admins see alone. Not ledgered:
 * they are members' private words, kept a year.
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly firebase: Firebase,
    private readonly inbox: InboxRepository,
    private readonly notices: InboxNotices,
    private readonly members: MemberDirectory,
    private readonly directory: DirectoryService,
  ) {}

  /** Active members by name, to write to, the caller left out. */
  async people(accountId: string, name: string): Promise<MessagePeopleMatch[]> {
    const found = await this.members.searchActive(name, PEOPLE_SHOWN + 1);
    return found
      .filter((m) => m.accountId !== accountId)
      .slice(0, PEOPLE_SHOWN)
      .map((m) => ({ accountId: m.accountId, name: m.preferredName || m.legalName }));
  }

  /** People as the caller sees them: each one's name, and whether they can get messages now. */
  private async persons(accountIds: readonly string[]): Promise<Map<string, MessagePerson>> {
    const ids = [...new Set(accountIds)];
    const [records, names] = await Promise.all([this.members.findMany(ids), this.directory.displayNames(ids)]);
    return new Map(
      ids.map((id, i) => {
        const member = records[i];
        return [id, { accountId: id, name: nameOf(member) ?? names.get(id) ?? 'A former member', active: member?.status === 'active' }] as const;
      }),
    );
  }

  async threads(accountId: string): Promise<ThreadSummary[]> {
    const [threads, blocking] = await Promise.all([this.inbox.threadsOf(accountId, THREADS_SHOWN), this.inbox.blockedBy(accountId)]);
    const people = await this.persons(threads.map((t) => otherMember(t, accountId)));
    return threads.map((t) => {
      const other = otherMember(t, accountId);
      return {
        threadId: t.threadId,
        with: people.get(other)!,
        lastMessageAt: t.lastMessageAt,
        lastText: t.lastText,
        lastFromMe: t.lastSenderId === accountId,
        unread: t.unread[accountId] ?? 0,
        blocking: blocking.has(other),
      };
    });
  }

  /** The conversation with a person, by their account ID or the thread's; null when they have none yet. */
  async thread(accountId: string, threadId: string, before: string | null): Promise<ThreadView> {
    const thread = await this.inbox.thread(threadId);
    if (!thread) throw new NotFoundException('no such conversation');
    if (!thread.members.includes(accountId)) throw new ForbiddenException('this conversation is not yours');
    const other = otherMember(thread, accountId);
    const [messages, people, [blocking]] = await Promise.all([
      this.inbox.messagesOf(threadId, before, MESSAGES_SHOWN),
      this.persons([other]),
      this.inbox.blocks(undefined, [[accountId, other]]),
    ]);
    return {
      threadId,
      with: people.get(other)!,
      messages: messages.reverse().map((m) => this.view(accountId, m)),
      older: messages.length === MESSAGES_SHOWN ? messages[0]!.sentAt : null,
      blocking: blocking!,
    };
  }

  /** Who the caller would write to, before any message: for starting a conversation from a person. */
  async person(accountId: string, otherId: string): Promise<{ person: MessagePerson; threadId: string; exists: boolean; blocking: boolean }> {
    if (otherId === accountId) throw new ConflictException('you cannot write to yourself');
    const threadId = threadIdOf(accountId, otherId);
    const [people, thread, [blocking]] = await Promise.all([this.persons([otherId]), this.inbox.thread(threadId), this.inbox.blocks(undefined, [[accountId, otherId]])]);
    const person = people.get(otherId)!;
    if (!thread && !person.active) throw new NotFoundException('no Active member has that account');
    return { person, threadId, exists: !!thread, blocking: blocking! };
  }

  private view(accountId: string, m: MemberMessageRecord): MessageView {
    return { messageId: m.messageId, fromMe: m.from === accountId, body: m.body, sentAt: m.sentAt, reported: m.to === accountId && !!m.reportedAt };
  }

  /** Sends one message, starting the conversation if it is the first, and notifies the recipient. */
  async send(from: string, to: string, body: string): Promise<{ threadId: string; message: MessageView }> {
    const threadId = threadIdOf(from, to);
    const ref = this.inbox.messageRef();
    const now = new Date();
    const at = now.toISOString();
    const message: MemberMessageRecord = { messageId: ref.id, threadId, from, to, body, sentAt: at, reportedAt: null };
    await this.firebase.db.runTransaction(async (tx) => {
      const [thread, [sender, recipient], [blocking, blockedBy], sent] = await Promise.all([
        this.inbox.thread(threadId, tx),
        this.members.getAll(tx, [from, to]),
        this.inbox.blocks(tx, [
          [from, to],
          [to, from],
        ]),
        this.inbox.sentSince(tx, from, new Date(now.getTime() - DAY_MS).toISOString()),
      ]);
      assertCheck(
        checkCanMessage({
          from,
          to,
          fromStatus: sender?.status ?? null,
          toStatus: recipient?.status ?? null,
          blocking: blocking!,
          blockedBy: blockedBy!,
          sentToday: sent.messages,
          newConversation: !thread,
          startedToday: sent.started,
        }),
      );
      const notify = await this.notices.prepare(tx, to, { kind: 'message', ref: threadId, title: `${nameOf(sender) ?? 'A member'} sent you a message`, link: `/messages/${threadId}` }, at);
      this.inbox.createMessage(tx, message);
      this.inbox.setThread(tx, threadAfterMessage(thread, message));
      notify();
    });
    return { threadId, message: this.view(from, message) };
  }

  /** The caller has read the conversation: nothing unread in it, nor its notification. */
  async markRead(accountId: string, threadId: string): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const thread = await this.inbox.thread(threadId, tx);
      if (!thread) throw new NotFoundException('no such conversation');
      if (!thread.members.includes(accountId)) throw new ForbiddenException('this conversation is not yours');
      if (thread.unread[accountId]) this.inbox.setThread(tx, { ...thread, unread: { ...thread.unread, [accountId]: 0 } });
    });
    await this.notices.readAbout(accountId, 'message', threadId);
  }

  async block(accountId: string, otherId: string): Promise<void> {
    if (otherId === accountId) throw new ConflictException('you cannot block yourself');
    await this.inbox.setBlock({ blockerId: accountId, blockedId: otherId, at: new Date().toISOString() });
  }

  async unblock(accountId: string, otherId: string): Promise<void> {
    await this.inbox.deleteBlock(accountId, otherId);
  }

  /** Its recipient reports a message to the Membership Admins, who are notified; once per message. */
  async report(accountId: string, messageId: string, reason: string): Promise<MessageView> {
    const ref = this.inbox.reportRef();
    const at = new Date().toISOString();
    const message = await this.firebase.db.runTransaction(async (tx) => {
      const found = await this.inbox.message(messageId, tx);
      if (!found || !(found.to === accountId || found.from === accountId)) throw new NotFoundException('no such message');
      if (found.to !== accountId) throw new ConflictException('only the member a message was sent to can report it');
      if (found.reportedAt) throw new ConflictException('you have reported this message already');
      const report: MessageReportRecord = {
        reportId: ref.id,
        messageId,
        threadId: found.threadId,
        reportedBy: accountId,
        from: found.from,
        body: found.body,
        sentAt: found.sentAt,
        reason,
        status: 'open',
        createdAt: at,
        closedBy: null,
        closedAt: null,
        note: null,
      };
      this.inbox.createReport(tx, report);
      this.inbox.markMessageReported(tx, messageId, at);
      return { ...found, reportedAt: at };
    });
    const admins = await this.directory.roleHolders('membership_admin');
    await this.notices.notify(
      admins.map((a) => a.accountId).filter((id) => id !== message.from),
      { kind: 'message_report', ref: REPORTS_REF, title: 'A member reported a message', link: '/admin?tab=forum' },
    );
    return this.view(accountId, message);
  }

  // --- Membership Admins ----------------------------------------------------------------------------------------------

  async reports(): Promise<MessageReportView[]> {
    const records = await this.inbox.reports(REPORTS_SHOWN);
    const people = await this.persons(records.flatMap((r) => [r.from, r.reportedBy]));
    const closers = await this.directory.displayNames([...new Set(records.flatMap((r) => (r.closedBy ? [r.closedBy] : [])))]);
    return records.map(({ threadId: _threadId, closedBy, ...r }) => ({
      ...r,
      fromName: people.get(r.from)?.name ?? null,
      reportedByName: people.get(r.reportedBy)?.name ?? null,
      closedByName: closedBy ? (closers.get(closedBy) ?? null) : null,
    }));
  }

  async closeReport(accountId: string, reportId: string, note: string | undefined): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const report = await this.inbox.report(reportId, tx);
      if (!report) throw new NotFoundException('no such report');
      if (report.status === 'closed') throw new ConflictException('this report is closed already');
      this.inbox.updateReport(tx, reportId, { status: 'closed', closedBy: accountId, closedAt: new Date().toISOString(), note: note || null });
    });
  }
}
