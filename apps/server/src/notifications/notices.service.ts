import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  checkNoticeResend,
  checkNoticeTest,
  noticeId,
  noticeReceiptTotals,
  noticeSummary,
  noticeTestRecord,
  noticeTestSummary,
  type NoticeDelivery,
  type NoticeKind,
  type NoticeResendPayload,
  type NoticesView,
  type NoticeSummary,
  type NoticeTestSummary,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { ElectionReader } from '../elections/election-reader.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MailRepository } from './mail.repository.js';
import { NoticeSettingsService } from './notice-settings.js';
import { NoticeRepository } from './notice.repository.js';

/** The caller's own test emails the editor lists. */
const TESTS_SHOWN = 5;

/**
 * What Election Admins and Auditors see of an election's notices, resending to those a notice failed for, and test
 * emails to the Election Admin who asks (design §6.8). Counts only: no address and nobody's status. The api never
 * sends mail and holds no mail credentials: the worker sends what it queues.
 */
@Injectable()
export class NoticesService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly notices: NoticeRepository,
    private readonly mail: MailRepository,
    private readonly elections: ElectionReader,
    private readonly settings: NoticeSettingsService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async view(ctx: RequestContext, electionId: string): Promise<NoticesView> {
    if (!(await this.elections.find(electionId))) throw new NotFoundException('no such election');
    const [notices, settings, receipts, tests, health] = await Promise.all([
      this.notices.ofElection(electionId),
      this.settings.current(),
      this.notices.receiptCounts(electionId),
      this.notices.testsTo(electionId, testRecipient(ctx)),
      this.mail.health(),
    ]);
    const { version: _v, updatedAt: _at, updatedBy: _by, ...current } = settings;
    return {
      delivery: this.delivery(),
      contact: current.contact ?? this.config.noticeContact,
      settings: current,
      notices: await Promise.all(notices.map(async (n) => noticeSummary(n, await this.notices.counts(n.noticeId)))),
      receipts: noticeReceiptTotals(receipts),
      tests: tests.slice(0, TESTS_SHOWN).map(noticeTestSummary),
      setup: health?.overall ?? null,
    };
  }

  /**
   * Queues a test of the email for the caller alone, which the worker sends on its next tick to the address of the
   * caller's own account (the signed-in System Admin's when they act as a persona), marked as a test. By an Election
   * Admin who is not a candidate, as for a resend; only where the real email would be mailed; one at a time, and a
   * few a day. Not ledgered: it reaches nobody else and changes nothing about the election; the worker keeps a receipt.
   */
  async requestTest(ctx: RequestContext, electionId: string, kind: NoticeKind): Promise<NoticeTestSummary> {
    const actor = requireAccount(ctx);
    const recipient = testRecipient(ctx);
    const settings = await this.settings.current();
    const ref = this.notices.testRef();
    const test = await this.firebase.db.runTransaction(async (tx) => {
      const election = await this.elections.find(electionId, tx);
      if (!election) throw new NotFoundException('no such election');
      if (await this.elections.isCandidate(tx, electionId, actor)) {
        throw new ForbiddenException('you are a candidate in this election, so you cannot administer it');
      }
      const now = new Date();
      const theirs = await this.notices.testsTo(electionId, recipient, tx);
      assertCheck(checkNoticeTest({ delivery: this.delivery(), contact: settings.contact ?? this.config.noticeContact, theirs, now }));
      const record = noticeTestRecord({ testId: ref.id, electionId, kind, caller: { accountId: actor, operator: ctx.operator }, now });
      tx.create(ref, record);
      return record;
    });
    return noticeTestSummary(test);
  }

  /** How this deployment sends election email. */
  private delivery(): NoticeDelivery | 'none' {
    return { ses: 'mail' as const, outbox: 'outbox' as const, off: 'none' as const }[this.config.mailTransport];
  }

  /**
   * Starts a new round of the notice for the recipients it failed for, which the worker sends on its next tick. Only
   * while voting is open, once the last round has finished; not by a candidate in the election. Ledgered.
   */
  async resend(ctx: RequestContext, electionId: string, kind: NoticeKind): Promise<NoticeSummary> {
    const actor = requireAccount(ctx);
    const id = noticeId(electionId, kind);
    await this.firebase.db.runTransaction(async (tx) => {
      const election = await this.elections.find(electionId, tx);
      if (!election) throw new NotFoundException('no such election');
      if (await this.elections.isCandidate(tx, electionId, actor)) {
        throw new ForbiddenException('you are a candidate in this election, so you cannot administer it');
      }
      const notice = await this.notices.find(id, tx);
      const failed = notice ? (await this.notices.counts(id, tx)).failed : 0;
      assertCheck(checkNoticeResend(election, notice, failed, new Date()));
      const round = notice!.round + 1;
      const payload: NoticeResendPayload = { electionId, kind, round, failed };
      await this.ledger.record(tx, [{ type: 'notice.resend_requested', actor, subject: electionId, payload: { ...payload } }]);
      const now = new Date().toISOString();
      tx.update(this.notices.ref(id), { status: 'sending', round, roundRequestedBy: actor, roundStartedAt: now, completedAt: null });
    });
    const notice = (await this.notices.find(id))!;
    return noticeSummary(notice, await this.notices.counts(id));
  }

  /**
   * Removes a deleted election's notices, receipts, test emails and the records of their messages (design §6.1), after
   * the deletion has committed.
   */
  async forgetElection(electionId: string): Promise<void> {
    await Promise.all([this.notices.deleteForElection(electionId), this.mail.forgetElection(electionId)]);
  }
}

/**
 * Whose inbox the caller's test emails go to: their own account, or, when a System Admin acts as a test persona (design
 * §10.4), the System Admin's, since a persona has no address.
 */
export function testRecipient(ctx: RequestContext): string {
  return ctx.operator ?? requireAccount(ctx);
}
