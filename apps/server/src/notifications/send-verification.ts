import { Injectable, Logger } from '@nestjs/common';
import { shortOf, verifySend, type SendVerificationRecord } from 'ustp-domain';
import { alertLog } from '../common/logging.js';
import { ElectionReader } from '../elections/election-reader.js';
import { MailRepository } from './mail.repository.js';
import { NoticeRepository } from './notice.repository.js';

/** Sends a tick checks at most. */
const SENDS_PER_TICK = 20;

/**
 * Checks each send of election email to a roll after it went (design §6.8), a step of the worker's tick: 30 minutes
 * after a send finished, it reads what the delivery reports said of each of its messages, records how many reached
 * their mail servers and how many did not (still delayed, bounced, rejected, or no report at all), and, for a send that
 * fell short, alerts the System Admins (their alert email, through Google, where mail goes through SES). The election's
 * email card shows each email's checks to Election Admins. Counts only, never who.
 */
@Injectable()
export class SendVerifier {
  private readonly logger = new Logger(SendVerifier.name);

  constructor(
    private readonly notices: NoticeRepository,
    private readonly mail: MailRepository,
    private readonly elections: ElectionReader,
  ) {}

  /** Checks the sends whose 30 minutes are up. Returns how many it checked. */
  async verifyDue(now: Date = new Date()): Promise<number> {
    let checked = 0;
    for (const pending of await this.notices.dueVerifications(now.toISOString(), SENDS_PER_TICK)) {
      const receipt = await this.notices.receipt(pending.receiptId);
      const ids = receipt?.messageIds ?? [];
      const found = new Map((await this.mail.messages(ids)).map((m) => [m.messageId, m.status]));
      const result = verifySend(pending, ids.map((id) => found.get(id) ?? null), now);
      await this.notices.verificationRef(pending.receiptId).set(result);
      if (result.status === 'short') await this.warnShort(result, receipt?.delivery === 'mail');
      checked++;
    }
    return checked;
  }

  private async warnShort(v: SendVerificationRecord, mail: boolean): Promise<void> {
    const title = (await this.elections.find(v.electionId))?.title ?? v.electionId;
    const line =
      `election email fell short: of ${v.messages} ${v.kind} emails for "${title}" sent ${v.finishedAt}, ${shortOf(v)} were not ` +
      `confirmed delivered after 30 minutes (${v.bounced} bounced, ${v.rejected} rejected, ${v.delayed} delayed, ${v.noReport} no report)`;
    if (mail) alertLog('mail', line, { check: 'send_verification', election: v.electionId });
    else this.logger.warn(line);
  }
}
