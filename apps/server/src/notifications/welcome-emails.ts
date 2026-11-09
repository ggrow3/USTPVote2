import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  asWelcomeLink,
  Collections,
  isUnclaimedSignInLink,
  isWelcomeInFlight,
  nearestWelcomeLink,
  uuidv7,
  welcomeEmailRecord,
  welcomeLinkRecord,
  welcomeLinkSent,
  type WelcomeDelivery,
  type WelcomeEmailRecord,
} from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { MailRepository } from './mail.repository.js';
import { NoticeSettingsService } from './notice-settings.js';

/**
 * Welcome emails to members a Membership Admin added (design §5.13), as the api asks for them: where the deployment
 * sends mail and System Admins have them switched on (§6.8), each is queued in `welcome_emails/{accountId}` for the
 * worker (`WelcomeSender`); otherwise the admin's browser asks Identity Platform to send its sign-in link, and then says
 * so (`recordLink`), so it is in the email log and on the member's page all the same.
 */
@Injectable()
export class WelcomeEmails {
  constructor(
    private readonly firebase: Firebase,
    private readonly settings: NoticeSettingsService,
    private readonly mail: MailRepository,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** How this deployment welcomes an added member now. */
  async delivery(): Promise<WelcomeDelivery> {
    if (this.config.mailTransport === 'off') return 'identity_platform';
    const settings = await this.settings.current();
    return settings.allEmails && settings.emails.welcome ? 'mail' : 'identity_platform';
  }

  /** Queues the welcome email for a member being added, in the adding transaction, when mail is how it goes. */
  queue(tx: Transaction, delivery: WelcomeDelivery, accountId: string, requestedBy: string, at: string): void {
    if (delivery === 'mail') tx.set(this.ref(accountId), welcomeEmailRecord(accountId, requestedBy, at));
  }

  /** Reads an added member's latest welcome email in `tx`, for asking again; null if none was queued. */
  async latest(tx: Transaction, accountId: string): Promise<WelcomeEmailRecord | null> {
    return ((await tx.get(this.ref(accountId))).data() as WelcomeEmailRecord | undefined) ?? null;
  }

  /** Queues it again (after `latest`, in the same transaction); refused while one is still on its way. */
  again(tx: Transaction, delivery: WelcomeDelivery, latest: WelcomeEmailRecord | null, accountId: string, requestedBy: string): void {
    if (delivery !== 'mail') return;
    if (latest && isWelcomeInFlight(latest, new Date())) throw new ConflictException('a welcome email is on its way already');
    tx.set(this.ref(accountId), welcomeEmailRecord(accountId, requestedBy, new Date().toISOString()));
  }

  /**
   * Identity Platform's report of a sign-in link to this account sent near `at` that is nobody's welcome yet, where it
   * sends through SES and its report came before the admin's browser said it sent the link; read before `recordLink`'s
   * transaction, which reads it again.
   */
  async reportedLink(accountId: string, at: string): Promise<string | null> {
    return nearestWelcomeLink((await this.mail.messagesNear(accountId, at)).filter(isUnclaimedSignInLink), at)?.messageId ?? null;
  }

  /**
   * Records a welcome sign-in link the admin's browser says Identity Platform took (design §5.13): in the email log as
   * the admin's (`mail_messages`), and as the member's latest welcome. Identity Platform's own report of it, when it came
   * first (`reported`), becomes the welcome rather than a second line in the log. Refused while a welcome email of the
   * site's own is on its way. It reads in `tx` before it writes: call it after the transaction's other reads.
   */
  async recordLink(tx: Transaction, accountId: string, to: string | null, requestedBy: string, at: string, reported: string | null): Promise<void> {
    const latest = await this.latest(tx, accountId);
    if (latest && isWelcomeInFlight(latest, new Date(at))) throw new ConflictException('a welcome email is on its way already');
    const report = reported ? await this.mail.message(reported, tx) : null;
    const message =
      report && isUnclaimedSignInLink(report)
        ? asWelcomeLink(report, { accountId, causedBy: requestedBy })
        : welcomeLinkRecord({ messageId: `welcome-link-${uuidv7()}`, accountId, to, causedBy: requestedBy, at });
    this.mail.setMessage(tx, message);
    tx.set(this.ref(accountId), welcomeLinkSent({ accountId, requestedBy, at, messageId: message.messageId, delivery: message.handOff ? null : message.status }));
  }

  /** The latest welcome email, outside a transaction, for the member's profile. */
  async find(accountId: string): Promise<WelcomeEmailRecord | null> {
    return ((await this.ref(accountId).get()).data() as WelcomeEmailRecord | undefined) ?? null;
  }

  private ref(accountId: string) {
    return this.firebase.db.collection(Collections.welcomeEmails).doc(accountId);
  }
}
