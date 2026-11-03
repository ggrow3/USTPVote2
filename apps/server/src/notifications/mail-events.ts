import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  applyMailEvent,
  Collections,
  identityMailRecord,
  isNoticeMail,
  mailAddressKey,
  nextSuppression,
  recipientStatusOf,
  type MailEvent,
  type MailMessageRecord,
  type NoticeRecipientRecord,
  type NoticeTestRecord,
  type RecipientStatus,
  type WelcomeEmailRecord,
} from 'ustp-domain';
import { DirectoryService } from '../auth/directory.service.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { MAIL_EVENT_SOURCE, type MailEventSource } from './mail-transport.js';
import { MailRepository } from './mail.repository.js';
import { NoticeRepository } from './notice.repository.js';

/** How long one tick may spend reading delivery reports. */
export const MAIL_EVENT_TICK_BUDGET_MS = 10_000;

/** Recipient statuses that follow a message's delivery reports, once the provider has taken it. */
const REPORTED: readonly RecipientStatus[] = ['sent', 'delivered', 'complained', 'bounced'];

type Outcome = 'recorded' | 'unchanged' | 'later';

/**
 * Reads the mail provider's delivery reports (design §6.8), a step of the worker's tick, and records what each says: on
 * the message's record (`mail_messages`), on the notice recipient, test email or welcome email it was, and, for a
 * permanent bounce or a complaint, as an address not to mail again (`mail_suppressions`). Mail Identity Platform sent
 * carries none of this app's tags: its first report makes its record, found to be an account's by the address it went
 * to, which is used for that and stored nowhere. Reports are removed from the queue once recorded; one about a message of
 * this app's not yet recorded is left to come back.
 */
@Injectable()
export class MailEventRecorder {
  private readonly logger = new Logger(MailEventRecorder.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly mail: MailRepository,
    private readonly notices: NoticeRepository,
    private readonly directory: DirectoryService,
    @Inject(MAIL_EVENT_SOURCE) private readonly source: MailEventSource | null,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Records the reports waiting, for up to `budgetMs`. Returns how many changed what is known of a message. */
  async record(budgetMs: number = MAIL_EVENT_TICK_BUDGET_MS): Promise<number> {
    if (!this.source) return 0;
    const deadline = Date.now() + budgetMs;
    let recorded = 0;
    while (Date.now() < deadline) {
      const received = await this.source.receive();
      if (!received.length) break;
      const done: string[] = [];
      for (const { receipt, event } of received) {
        const outcome: Outcome = event ? await this.apply(event) : 'unchanged';
        if (outcome === 'recorded') recorded++;
        if (outcome !== 'later') done.push(receipt);
      }
      await this.source.acknowledge(done);
      if (!done.length) break; // only reports to read again later
    }
    return recorded;
  }

  private async apply(event: MailEvent): Promise<Outcome> {
    const own = this.config.ses.configurationSet;
    if (own && event.configurationSet && event.configurationSet !== own) {
      this.logger.warn(`a delivery report from configuration set ${event.configurationSet} was dropped: this deployment's is ${own}`);
      return 'unchanged';
    }
    let fresh: MailMessageRecord | null = null;
    if (!(await this.mail.message(event.messageId))) {
      // This app's messages are recorded when sent; a report that came first is read again later.
      if (event.kind) return event.type === 'send' ? 'unchanged' : 'later';
      const accountId = event.destination ? await this.directory.accountWithEmail(event.destination) : null;
      fresh = identityMailRecord(event, accountId);
    }
    return this.firebase.db.runTransaction(async (tx): Promise<Outcome> => {
      const current = (await this.mail.message(event.messageId, tx)) ?? fresh;
      if (!current) return 'later';
      const effect = applyMailEvent(current, event);
      const { record } = effect;
      const write = effect.changed || current === fresh;
      if (!write && !effect.suppress) return 'unchanged';

      const db = this.firebase.db;
      const recipientRef = isNoticeMail(record.kind) && record.ref && record.accountId ? this.notices.recipientRef(record.ref, record.accountId) : null;
      const testRef = record.kind === 'notice_test' && record.ref ? this.notices.testRef(record.ref) : null;
      const welcomeRef = record.kind === 'welcome' && record.accountId ? db.collection(Collections.welcomeEmails).doc(record.accountId) : null;
      const key = effect.suppress && event.destination ? mailAddressKey(event.destination) : null;
      const [recipient, test, welcome, suppression] = await Promise.all([
        recipientRef ? tx.get(recipientRef).then((s) => s.data() as NoticeRecipientRecord | undefined) : undefined,
        testRef ? tx.get(testRef).then((s) => s.data() as NoticeTestRecord | undefined) : undefined,
        welcomeRef ? tx.get(welcomeRef).then((s) => s.data() as WelcomeEmailRecord | undefined) : undefined,
        key ? this.mail.suppression(key, tx) : null,
      ]);

      const now = new Date().toISOString();
      if (write) this.mail.setMessage(tx, record);
      const status = recipientStatusOf(record.status);
      if (recipient && recipient.messageId === record.messageId && REPORTED.includes(recipient.status) && recipient.status !== status) {
        tx.update(recipientRef!, { status, updatedAt: now });
      }
      if (test?.status === 'done' && test.outcome === null && test.delivery !== record.status) tx.update(testRef!, { delivery: record.status });
      if (welcome && welcome.messageId === record.messageId && welcome.delivery !== record.status) tx.update(welcomeRef!, { delivery: record.status });
      if (key) {
        const next = nextSuppression(suppression, { addressKey: key, reason: effect.suppress!, event, accountId: record.accountId });
        if (JSON.stringify(next) !== JSON.stringify(suppression)) this.mail.setSuppression(tx, next);
      }
      return write ? 'recorded' : 'unchanged';
    });
  }
}
