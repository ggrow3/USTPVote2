import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  checkNoticeResend,
  noticeId,
  noticeSummary,
  type NoticeKind,
  type NoticeResendPayload,
  type NoticesView,
  type NoticeSummary,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { ElectionReader } from '../elections/election-reader.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { NoticeRepository } from './notice.repository.js';

/**
 * What Election Admins and Auditors see of an election's notices, and resending to those a notice failed for (design
 * §6.8). Counts only: no address and nobody's status. The api never sends mail and holds no mail credentials.
 */
@Injectable()
export class NoticesService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly notices: NoticeRepository,
    private readonly elections: ElectionReader,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async view(electionId: string): Promise<NoticesView> {
    if (!(await this.elections.find(electionId))) throw new NotFoundException('no such election');
    const notices = await this.notices.ofElection(electionId);
    return {
      delivery: { ses: 'mail' as const, outbox: 'outbox' as const, off: 'none' as const }[this.config.mailTransport],
      contact: this.config.noticeContact,
      notices: await Promise.all(notices.map(async (n) => noticeSummary(n, await this.notices.counts(n.noticeId)))),
    };
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

  /** Removes a deleted election's notices (design §6.1), after the deletion has committed. */
  forgetElection(electionId: string): Promise<void> {
    return this.notices.deleteForElection(electionId);
  }
}
