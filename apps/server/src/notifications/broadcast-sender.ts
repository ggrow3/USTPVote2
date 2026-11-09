import { Inject, Injectable, Logger } from '@nestjs/common';
import { broadcastMessage, isStaleClaim, MAX_SEND_ATTEMPTS, sendGate, type BroadcastRecipientRecord, type BroadcastRecord } from 'ustp-domain';
import { DirectoryService } from '../auth/directory.service.js';
import { alertLog } from '../common/logging.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { BroadcastRepository } from './broadcast.repository.js';
import { BroadcastAudienceReader } from './broadcasts.js';
import { MailHealthChecker } from './mail-health.js';
import { MAIL_TRANSPORT, type MailTransport } from './mail-transport.js';
import { Mailer } from './mailer.js';
import { NoticeSettingsService } from './notice-settings.js';

/** At most this long a tick, after the election emails, which come first. */
export const BROADCAST_TICK_BUDGET_MS = 15_000;
const BATCH = 50;

/**
 * Sends the emails admins wrote to members (design §10.12), a step of the worker's tick. It works out who gets one when it
 * starts, then sends a batch at a time through `Mailer`, which skips anyone who has since unsubscribed or been stopped.
 * While all email is off, no contact is set, or the setup check is failing, what is left waits. Each copy is claimed in a
 * transaction first, so it never goes twice; one a worker claimed and never finished is failed as `interrupted`.
 */
@Injectable()
export class BroadcastSender {
  private readonly logger = new Logger(BroadcastSender.name);

  constructor(
    private readonly broadcasts: BroadcastRepository,
    private readonly audience: BroadcastAudienceReader,
    private readonly mailer: Mailer,
    private readonly directory: DirectoryService,
    private readonly members: MemberDirectory,
    private readonly settings: NoticeSettingsService,
    private readonly health: MailHealthChecker,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Returns how many copies went. */
  async sendDue(budgetMs: number = BROADCAST_TICK_BUDGET_MS): Promise<number> {
    if (!this.transport || !this.config.webOrigin) return 0;
    const unfinished = await this.broadcasts.unfinished();
    if (!unfinished.length) return 0;
    const settings = await this.settings.current();
    const contact = settings.contact ?? this.config.noticeContact;
    if (!settings.allEmails || !contact) return 0;
    const deadline = Date.now() + budgetMs;
    let sent = 0;
    for (const broadcast of unfinished) {
      if (await this.mayGo(broadcast)) sent += await this.work(broadcast, contact, deadline);
    }
    return sent;
  }

  /** Never into a setup the email check finds failing, as for election email (design §6.8). */
  private async mayGo(broadcast: BroadcastRecord): Promise<boolean> {
    const now = new Date();
    const mail = this.transport!.delivery === 'mail';
    let gate = sendGate(await this.health.current(), now, mail);
    if (gate.stale) gate = sendGate(await this.health.ensureFresh(now), now, mail);
    if (gate.stale) return false; // another worker is running the check: go next tick
    if (!gate.failing.length) {
      if (broadcast.held) await this.broadcasts.update(broadcast.broadcastId, { held: null });
      return true;
    }
    if (JSON.stringify(broadcast.held?.checks) !== JSON.stringify(gate.failing)) {
      await this.broadcasts.update(broadcast.broadcastId, { held: { checks: gate.failing, since: broadcast.held?.since ?? now.toISOString() } });
      const line = `email to members held: "${broadcast.subject}" waits while the email setup check fails (${gate.failing.join(', ')}); see Admin › Email`;
      if (mail) alertLog('mail', line, { check: 'send_held' });
      else this.logger.warn(line);
    }
    return false;
  }

  private async work(broadcast: BroadcastRecord, contact: string, deadline: number): Promise<number> {
    const id = broadcast.broadcastId;
    if (broadcast.status === 'preparing') {
      const { to, preview } = await this.audience.resolve(broadcast.audience);
      await this.broadcasts.addRecipients(id, to, new Date().toISOString());
      await this.broadcasts.update(id, { status: 'sending', preview });
    }
    for (const r of await this.broadcasts.sending(id)) {
      if (isStaleClaim(r, new Date())) {
        await this.broadcasts.finish(id, r.accountId, { status: 'failed', outcome: 'interrupted' });
        this.logger.warn(`email ${id} to account ${r.accountId} was interrupted; whether it went is unknown`);
      }
    }
    let sent = 0;
    while (Date.now() < deadline) {
      // Stopped by an admin since the last batch: what is left stays unsent.
      if ((await this.broadcasts.find(id))?.status !== 'sending') return sent;
      const batch = await this.broadcasts.pending(id, BATCH);
      if (!batch.length) break;
      for (const recipient of batch) {
        if (Date.now() >= deadline) return sent;
        if (await this.send(broadcast, recipient, contact)) sent++;
      }
    }
    if (Date.now() < deadline && !(await this.broadcasts.sending(id)).length) {
      await this.broadcasts.update(id, { status: 'done', completedAt: new Date().toISOString() });
    }
    return sent;
  }

  private async send(broadcast: BroadcastRecord, recipient: BroadcastRecipientRecord, contact: string): Promise<boolean> {
    const id = broadcast.broadcastId;
    const { accountId } = recipient;
    const claimed = await this.broadcasts.claim(id, accountId, new Date());
    if (!claimed) return false;
    const finish = (fields: Partial<BroadcastRecipientRecord>) => this.broadcasts.finish(id, accountId, fields);
    const mailbox = (await this.directory.mailboxes([accountId])).get(accountId);
    if (!mailbox?.email) return finish({ status: 'skipped', outcome: 'no_address' }).then(() => false);
    if (!mailbox.verified) return finish({ status: 'skipped', outcome: 'unverified_address' }).then(() => false);
    const [[member], links] = await Promise.all([this.members.findMany([accountId]), this.mailer.links(accountId)]);
    const message = broadcastMessage({
      origin: this.config.webOrigin!,
      name: member?.preferredName || member?.legalName || null,
      contact,
      subject: broadcast.subject,
      body: broadcast.body,
      unsubscribe: links.page,
    });
    const result = await this.mailer.send(this.transport!, {
      to: mailbox.email,
      replyTo: this.config.mailReplyTo,
      listUnsubscribe: links.oneClick,
      ...message,
      meta: { kind: 'broadcast', ref: id, electionId: null, accountId, causedBy: broadcast.createdBy },
    });
    if (result.status === 'sent') {
      await finish({ status: 'sent', messageId: result.messageId, outcome: null });
      return true;
    }
    if (result.status === 'skipped') {
      await finish({ status: 'skipped', outcome: result.outcome });
      return false;
    }
    // The provider could not take it yet: try again next tick, a few times.
    const retry = result.outcome === 'unavailable' && claimed.attempts < MAX_SEND_ATTEMPTS;
    await finish({ status: retry ? 'pending' : 'failed', outcome: result.outcome });
    return false;
  }
}
