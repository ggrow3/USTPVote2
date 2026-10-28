import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  isClaimable,
  isRehearsalRoll,
  isReminderDue,
  isStaleClaim,
  isTestInFlight,
  isVotingOpen,
  MAX_SEND_ATTEMPTS,
  noticeDelivery,
  noticeId,
  noticeMessage,
  noticeReceipt,
  reminderTime,
  testNoticeTag,
  type ElectionRecord,
  type NoticeKind,
  type NoticeOutcome,
  type NoticeRecipientRecord,
  type NoticeRecord,
  type NoticeSentPayload,
  type NoticeSettings,
  type NoticeTestRecord,
  type SendResult,
} from 'ustp-domain';
import { DirectoryService, type Mailbox } from '../auth/directory.service.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { ElectionReader } from '../elections/election-reader.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { BOUNCE_SOURCE, MAIL_TRANSPORT, MailNotSent, OutboxTransport, type BounceSource, type MailTransport } from './mail-transport.js';
import { NoticeSettingsService } from './notice-settings.js';
import { NoticeRepository } from './notice.repository.js';

/** gRPC status ALREADY_EXISTS. */
const ALREADY_EXISTS = 6;

/** Recipients claimed and sent together; they are sent side by side. */
const BATCH = 10;

/** How long one tick may spend sending, so a large roll never holds up the rest of the tick for long. */
export const NOTICE_TICK_BUDGET_MS = 20_000;

/** How long one tick may spend reading bounce reports. */
export const BOUNCE_TICK_BUDGET_MS = 5_000;

/** Test emails a tick sends at most; each goes to one Election Admin. */
const TESTS_PER_TICK = 10;

/**
 * Sends election notices (design §6.8), a step of the worker's tick. Once an election is open it creates its
 * voting-open notice with one `pending` record per person on the roll, and a day before it closes the reminder, with one
 * per person who has not voted; then it sends them a batch at a time, within a time budget per tick, and ledgers
 * `notice.sent` with the counts when a round has finished. A reminder is not sent to someone who voted meanwhile.
 *
 * Each person gets one message per round, however ticks overlap or retry: a worker claims a recipient in a transaction
 * (`pending` → `sending`) before sending, and records the outcome after. A claim the worker never finished is failed as
 * `interrupted`, not sent again, since the message may have gone; an Election Admin can resend to those it failed for.
 *
 * Every send leaves a receipt (`notice_receipts`): each pass over a notice's recipients, and each test email an
 * Election Admin asked the api for, which this also sends, to that admin alone.
 */
@Injectable()
export class NoticeSender {
  private readonly logger = new Logger(NoticeSender.name);
  private readonly outbox: OutboxTransport;
  /** The System Admins' settings for this run, and the contact the emails give (theirs, else `NOTICE_CONTACT`). */
  private run: { readonly settings: NoticeSettings; readonly contact: string | null } | null = null;

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly notices: NoticeRepository,
    private readonly elections: ElectionReader,
    private readonly directory: DirectoryService,
    private readonly members: MemberDirectory,
    private readonly settings: NoticeSettingsService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
    @Inject(BOUNCE_SOURCE) private readonly bounces: BounceSource | null,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {
    this.outbox = new OutboxTransport(firebase.db);
  }

  /** Starts the notices of elections that have opened and sends what is due. Returns how many messages went. */
  async sendDue(budgetMs: number = NOTICE_TICK_BUDGET_MS): Promise<number> {
    if (!this.config.webOrigin) {
      this.logger.warn('election notices are not sent: WEB_ORIGIN is not set');
      return 0;
    }
    const deadline = Date.now() + budgetMs;
    await this.loadRun();
    for (const election of await this.elections.inState('open')) {
      await this.start(election, 'voting_open');
      await this.start(election, 'closing_soon');
    }
    let sent = 0;
    for (const notice of await this.notices.unfinished()) sent += await this.work(notice, deadline);
    return sent;
  }

  /** Reads the System Admins' settings for this run. */
  private async loadRun(): Promise<void> {
    const { version: _v, updatedAt: _at, updatedBy: _by, ...settings } = await this.settings.current();
    this.run = { settings, contact: settings.contact ?? this.config.noticeContact };
  }

  /**
   * Creates the election's notice of this kind once it is due, unless it has one, nobody is to get it, or a System
   * Admin has switched it off.
   */
  private async start(election: ElectionRecord, kind: NoticeKind): Promise<void> {
    const now = new Date();
    const { settings } = this.run!;
    if (!settings.kinds[kind].enabled) return;
    const due = kind === 'voting_open' ? isVotingOpen(election, now) : isReminderDue(election, now, settings.reminderHours);
    const id = noticeId(election.electionId, kind);
    if (!due || (await this.notices.find(id))) return;
    if (kind === 'closing_soon') {
      // The reminder comes after the voting-open notice has gone, never with it.
      const opening = await this.notices.find(noticeId(election.electionId, 'voting_open'));
      if (opening && opening.status !== 'done') return;
    }
    const roll = await this.elections.approvedRoll(election);
    if (!roll) {
      this.logger.warn(`open election ${election.electionId} has no roll, so no notice`);
      return;
    }
    const rehearsal = isRehearsalRoll(roll.criteria);
    const delivery = noticeDelivery({
      rehearsal,
      testingMode: this.config.testingMode,
      transport: this.transport?.delivery ?? 'none',
    });
    if (!delivery) return;
    if (delivery === 'mail' && !this.run!.contact) {
      this.logger.warn(`no notice for ${election.electionId} yet: no contact for election questions is set (NOTICE_CONTACT or the app's setting)`);
      return;
    }
    const at = now.toISOString();
    const record: NoticeRecord = {
      noticeId: id,
      electionId: election.electionId,
      kind,
      delivery,
      rehearsal,
      // Replaced by the number of recipient records once they are written; a reminder's leave out those who voted.
      recipients: roll.count,
      status: 'preparing',
      round: 1,
      roundRequestedBy: 'system',
      createdAt: at,
      roundStartedAt: at,
      completedAt: null,
    };
    await this.notices
      .ref(id)
      .create(record)
      .catch((e: { code?: number }) => {
        if (e.code !== ALREADY_EXISTS) throw e; // another tick started it
      });
  }

  /** Moves one notice on: recipient records, interrupted claims, sending, and finishing the round. */
  private async work(notice: NoticeRecord, deadline: number): Promise<number> {
    const election = await this.elections.find(notice.electionId);
    if (!election) return 0; // deleted; its notices go with it
    const transport = notice.delivery === 'outbox' ? this.outbox : this.transport;
    if (!transport) {
      this.logger.warn(`notice ${notice.noticeId} is waiting: this deployment sends no email (MAIL_TRANSPORT=off)`);
      return 0;
    }
    // Switched off by a System Admin, or nowhere for members to ask: what is left waits, and goes if that changes.
    if (!this.run!.settings.kinds[notice.kind].enabled) return 0;
    if (notice.delivery === 'mail' && !this.run!.contact) {
      this.logger.warn(`notice ${notice.noticeId} is waiting: no contact for election questions is set (NOTICE_CONTACT or the app's setting)`);
      return 0;
    }
    if (notice.status === 'preparing') {
      const roll = (await this.elections.approvedRoll(election))?.accountIds ?? [];
      // The reminder goes to those who have not voted: participation records say who did, never how.
      const voted = notice.kind === 'closing_soon' ? await this.elections.voted(election.electionId) : new Set<string>();
      await this.notices.addRecipients(notice.noticeId, roll.filter((id) => !voted.has(id)), new Date().toISOString());
      const recipients = await this.notices.total(notice.noticeId);
      await this.firebase.db.runTransaction(async (tx) => {
        if ((await this.notices.find(notice.noticeId, tx))?.status !== 'preparing') return;
        tx.update(this.notices.ref(notice.noticeId), { status: 'sending', recipients });
      });
    }
    await this.failInterrupted(notice);

    const open = isVotingOpen(election, new Date());
    const startedAt = new Date().toISOString();
    const results: SendResult[] = [];
    try {
      while (Date.now() < deadline) {
        const batch = await this.notices.claimable(notice.noticeId, notice.round, BATCH);
        if (!batch.length) break;
        if (!open) {
          await Promise.all(batch.map((r) => this.claim(notice, r.accountId, { status: 'failed', outcome: 'voting_closed' })));
          continue;
        }
        const sent = await this.sendBatch(notice, election, transport, batch);
        results.push(...sent);
        // The provider is down: try again next tick.
        if (sent.some((r) => r.status === 'failed' && r.outcome === 'unavailable')) break;
      }
    } finally {
      // What went, even when a later batch failed.
      await this.keepReceipt(notice, transport, startedAt, results);
    }
    await this.finishRound(notice);
    return results.filter((r) => r.status === 'sent').length;
  }

  /** The receipt of one pass over a notice's recipients, if it handled anyone. */
  private async keepReceipt(notice: NoticeRecord, transport: MailTransport, startedAt: string, results: readonly SendResult[]): Promise<void> {
    const ref = this.notices.receiptRef();
    const receipt = noticeReceipt({
      receiptId: ref.id,
      electionId: notice.electionId,
      kind: notice.kind,
      test: false,
      noticeId: notice.noticeId,
      round: notice.round,
      delivery: transport.delivery,
      triggeredBy: notice.roundRequestedBy,
      recipientAccountId: null,
      startedAt,
      finishedAt: new Date().toISOString(),
      results,
    });
    if (receipt) await ref.create(receipt);
  }

  private async sendBatch(
    notice: NoticeRecord,
    election: ElectionRecord,
    transport: MailTransport,
    batch: readonly NoticeRecipientRecord[],
  ): Promise<SendResult[]> {
    const claimed = (await Promise.all(batch.map((r) => this.claim(notice, r.accountId, null)))).filter((r) => r !== null);
    const ids = claimed.map((r) => r.accountId);
    const [mailboxes, members, voted] = await Promise.all([
      this.directory.mailboxes(ids),
      this.members.findMany(ids),
      notice.kind === 'closing_soon' ? this.elections.voted(election.electionId, ids) : new Set<string>(),
    ]);
    return Promise.all(
      claimed.map(async (r, i): Promise<SendResult> => {
        if (voted.has(r.accountId)) {
          await this.finish(notice, r.accountId, { status: 'skipped', outcome: 'voted' });
          return { status: 'skipped', outcome: 'voted' };
        }
        const member = members[i];
        return this.deliver(notice, election, transport, r, mailboxes.get(r.accountId), member?.preferredName || member?.legalName || null);
      }),
    );
  }

  /**
   * Claims a recipient in a transaction: `sending` for this worker to send, or straight to an outcome (`then`). Null
   * when it is no longer claimable, because another worker got there first.
   */
  private claim(
    notice: NoticeRecord,
    accountId: string,
    then: { status: 'failed'; outcome: NoticeOutcome } | null,
  ): Promise<NoticeRecipientRecord | null> {
    const ref = this.notices.recipientRef(notice.noticeId, accountId);
    return this.firebase.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as NoticeRecipientRecord | undefined;
      if (!current || !isClaimable(current, notice.round)) return null;
      const now = new Date().toISOString();
      const next: NoticeRecipientRecord = then
        ? { ...current, ...then, round: notice.round, claimedAt: null, updatedAt: now }
        : {
            ...current,
            status: 'sending',
            round: notice.round,
            attempts: current.round === notice.round ? current.attempts + 1 : 1,
            claimedAt: now,
            outcome: null,
            updatedAt: now,
          };
      tx.set(ref, next);
      return next;
    });
  }

  /** Sends one claimed recipient's message and records how it went. The address is used here and stored nowhere. */
  private async deliver(
    notice: NoticeRecord,
    election: ElectionRecord,
    transport: MailTransport,
    recipient: NoticeRecipientRecord,
    mailbox: Mailbox | undefined,
    name: string | null,
  ): Promise<SendResult> {
    const finish = (fields: Partial<NoticeRecipientRecord>) => this.finish(notice, recipient.accountId, fields);
    const skip = (outcome: NoticeOutcome) => finish({ status: 'skipped', outcome }).then((): SendResult => ({ status: 'skipped', outcome }));
    // A rehearsal's test voters have no address; their messages go to the outbox, addressed to nobody.
    if (!notice.rehearsal) {
      if (!mailbox?.email) return skip('no_address');
      if (!mailbox.verified) return skip('unverified_address');
    }
    const { settings, contact } = this.run!;
    const message = noticeMessage(notice.kind, {
      election,
      origin: this.config.webOrigin!,
      name,
      contact,
      now: new Date(),
      text: settings.kinds[notice.kind],
    });
    try {
      const { messageId } = await transport.send({
        to: notice.rehearsal ? null : mailbox!.email,
        from: this.config.mailFrom,
        replyTo: this.config.mailReplyTo,
        ...message,
        tags: { noticeId: notice.noticeId, electionId: notice.electionId, accountId: recipient.accountId },
      });
      await finish({ status: 'sent', sentAt: new Date().toISOString(), messageId, outcome: null });
      return { status: 'sent', messageId };
    } catch (e) {
      if (e instanceof MailNotSent && e.outcome === 'unavailable') {
        const retry = recipient.attempts < MAX_SEND_ATTEMPTS;
        await finish({ status: retry ? 'pending' : 'failed', outcome: 'unavailable' });
        return { status: 'failed', outcome: 'unavailable' };
      }
      // Never the error's text, which can quote the address.
      this.logger.error(`notice ${notice.noticeId} to account ${recipient.accountId} not sent (${errorName(e)})`);
      const outcome = e instanceof MailNotSent ? e.outcome : 'error';
      await finish({ status: 'failed', outcome });
      return { status: 'failed', outcome };
    }
  }

  /**
   * Sends the test emails Election Admins asked for (design §6.8), each marked as a test, through this deployment's
   * mail, to the address of the account it names, which is the asking admin's own; and fails as `interrupted` those a
   * worker claimed and never finished, rather than risk a second copy. Each one sent leaves a receipt. Returns how many
   * went.
   */
  async sendTests(): Promise<number> {
    if (!this.config.webOrigin) return 0; // the notices step says why
    const tests = await this.notices.unfinishedTests(TESTS_PER_TICK);
    if (!tests.length) return 0;
    await this.loadRun();
    let sent = 0;
    for (const test of tests) {
      if (test.status === 'pending') {
        if (await this.sendTest(test)) sent++;
      } else if (!isTestInFlight(test, new Date())) {
        await this.moveTest(test.testId, 'sending', { status: 'done', claimedAt: null, doneAt: new Date().toISOString(), outcome: 'interrupted' });
      }
    }
    return sent;
  }

  /**
   * Moves a test email on from `from` in a transaction: a pending one, or a claim that was interrupted. False when it
   * is no longer there, because another worker got to it first.
   */
  private moveTest(testId: string, from: NoticeTestRecord['status'], next: Partial<NoticeTestRecord>): Promise<boolean> {
    const ref = this.notices.testRef(testId);
    return this.firebase.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as NoticeTestRecord | undefined;
      if (current?.status !== from || (from === 'sending' && isTestInFlight(current, new Date()))) return false;
      tx.update(ref, next);
      return true;
    });
  }

  /** Claims, sends and records one test email, with its receipt. */
  private async sendTest(test: NoticeTestRecord): Promise<boolean> {
    const startedAt = new Date().toISOString();
    if (!(await this.moveTest(test.testId, 'pending', { status: 'sending', claimedAt: startedAt }))) return false;
    const election = await this.elections.find(test.electionId);
    if (!election) return false; // deleted; its tests go with it
    const result = await this.deliverTest(test, election);
    const ref = this.notices.receiptRef();
    const finishedAt = new Date().toISOString();
    const receipt = noticeReceipt({
      receiptId: ref.id,
      electionId: test.electionId,
      kind: test.kind,
      test: true,
      noticeId: null,
      round: null,
      delivery: this.transport?.delivery ?? 'mail',
      triggeredBy: test.requestedBy,
      recipientAccountId: test.accountId,
      startedAt,
      finishedAt,
      results: [result],
    })!;
    const batch = this.firebase.db.batch();
    batch.create(ref, receipt);
    batch.update(this.notices.testRef(test.testId), {
      status: 'done',
      claimedAt: null,
      doneAt: finishedAt,
      outcome: result.status === 'sent' ? null : result.outcome,
      receiptId: receipt.receiptId,
    });
    await batch.commit();
    return result.status === 'sent';
  }

  /** Sends one test email to its account's own address, which is read here and stored nowhere. */
  private async deliverTest(test: NoticeTestRecord, election: ElectionRecord): Promise<SendResult> {
    const transport = this.transport;
    const { settings, contact } = this.run!;
    // Email switched off, or the contact removed, since it was asked for: nothing goes, as for the real email.
    if (!transport || (transport.delivery === 'mail' && !contact)) return { status: 'failed', outcome: 'unavailable' };
    const mailbox = (await this.directory.mailboxes([test.accountId])).get(test.accountId);
    if (!mailbox?.email) return { status: 'skipped', outcome: 'no_address' };
    if (!mailbox.verified) return { status: 'skipped', outcome: 'unverified_address' };
    const [member] = await this.members.findMany([test.accountId]);
    const now = new Date();
    // The reminder says how long is left: as it will say when it goes, or now, once it is due.
    const hours = settings.reminderHours;
    const at = test.kind === 'closing_soon' && !isReminderDue(election, now, hours) ? reminderTime(election, hours) : now;
    const message = noticeMessage(test.kind, {
      election,
      origin: this.config.webOrigin!,
      name: member?.preferredName || member?.legalName || null,
      contact,
      now: at,
      text: settings.kinds[test.kind],
      test: true,
    });
    try {
      const { messageId } = await transport.send({
        to: mailbox.email,
        from: this.config.mailFrom,
        replyTo: this.config.mailReplyTo,
        ...message,
        tags: { noticeId: testNoticeTag(test.electionId, test.kind), electionId: test.electionId, accountId: test.accountId },
      });
      return { status: 'sent', messageId };
    } catch (e) {
      this.logger.error(`test email ${test.testId} to account ${test.accountId} not sent (${errorName(e)})`);
      return { status: 'failed', outcome: e instanceof MailNotSent ? e.outcome : 'error' };
    }
  }

  /** Records a claimed recipient's outcome and releases the claim. */
  private async finish(notice: NoticeRecord, accountId: string, fields: Partial<NoticeRecipientRecord>): Promise<void> {
    await this.notices.recipientRef(notice.noticeId, accountId).update({ ...fields, claimedAt: null, updatedAt: new Date().toISOString() });
  }

  /**
   * Reads the provider's bounce reports (design §6.8) for up to `budgetMs` and marks each bounced message's recipient
   * `bounced`. Reports about anything else are dropped. Returns how many recipients it marked.
   */
  async recordBounces(budgetMs: number = BOUNCE_TICK_BUDGET_MS): Promise<number> {
    if (!this.bounces) return 0;
    const deadline = Date.now() + budgetMs;
    let recorded = 0;
    while (Date.now() < deadline) {
      const { bounces, receipts } = await this.bounces.receive();
      if (!receipts.length) break;
      for (const { noticeId: id, messageId } of bounces) {
        const recipient = await this.notices.byMessageId(id, messageId);
        if (!recipient) continue;
        const ref = this.notices.recipientRef(id, recipient.accountId);
        const marked = await this.firebase.db.runTransaction(async (tx) => {
          const current = (await tx.get(ref)).data() as NoticeRecipientRecord | undefined;
          if (current?.status !== 'sent' || current.messageId !== messageId) return false; // recorded already
          tx.update(ref, { status: 'bounced', updatedAt: new Date().toISOString() });
          return true;
        });
        if (marked) recorded++;
      }
      await this.bounces.acknowledge(receipts);
    }
    return recorded;
  }

  /** Claims older than the claim limit were interrupted: failed, so the message is never sent twice. */
  private async failInterrupted(notice: NoticeRecord): Promise<void> {
    for (const r of await this.notices.sending(notice.noticeId)) {
      if (!isStaleClaim(r, new Date())) continue;
      const ref = this.notices.recipientRef(notice.noticeId, r.accountId);
      await this.firebase.db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data() as NoticeRecipientRecord | undefined;
        if (!current || !isStaleClaim(current, new Date())) return;
        tx.update(ref, { status: 'failed', outcome: 'interrupted', claimedAt: null, updatedAt: new Date().toISOString() });
      });
      this.logger.warn(`notice ${notice.noticeId} to account ${r.accountId} was interrupted; whether it went is unknown`);
    }
  }

  /** Once every recipient of the round has an outcome: ledger the counts and mark the notice done, once. */
  private async finishRound(notice: NoticeRecord): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.notices.find(notice.noticeId, tx);
      if (!current || current.status !== 'sending' || current.round !== notice.round) return;
      const [counts, retry] = await Promise.all([
        this.notices.counts(notice.noticeId, tx),
        current.round > 1 ? this.notices.failedBefore(notice.noticeId, current.round, tx) : 0,
      ]);
      if (counts.pending > 0 || retry > 0) return;
      const { sent, failed, bounced, skipped } = counts;
      const payload: NoticeSentPayload = {
        electionId: current.electionId,
        kind: current.kind,
        round: current.round,
        delivery: current.delivery,
        recipients: current.recipients,
        sent,
        failed,
        bounced,
        skipped,
      };
      await this.ledger.record(tx, [{ type: 'notice.sent', actor: 'system', subject: current.electionId, payload: { ...payload } }]);
      tx.update(this.notices.ref(notice.noticeId), { status: 'done', completedAt: new Date().toISOString() });
    });
  }
}

/** What went wrong, as a code: never the error's text, which can quote the address. */
function errorName(e: unknown): string {
  return e instanceof MailNotSent ? e.outcome : e instanceof Error ? e.name : 'error';
}
