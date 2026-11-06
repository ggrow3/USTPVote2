import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { Collections, isWelcomeInFlight, welcomeEmailRecord, type WelcomeDelivery, type WelcomeEmailRecord } from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { NoticeSettingsService } from './notice-settings.js';

/**
 * Welcome emails to members a Membership Admin added (design §5.13), as the api asks for them: where the deployment
 * sends mail and System Admins have them switched on (§6.8), each is queued in `welcome_emails/{accountId}` for the
 * worker (`WelcomeSender`); otherwise the admin's browser asks Identity Platform to send its sign-in link, and nothing is
 * stored here.
 */
@Injectable()
export class WelcomeEmails {
  constructor(
    private readonly firebase: Firebase,
    private readonly settings: NoticeSettingsService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** How this deployment welcomes an added member now. */
  async delivery(): Promise<WelcomeDelivery> {
    if (this.config.mailTransport === 'off') return 'identity_platform';
    return (await this.settings.current()).emails.welcome ? 'mail' : 'identity_platform';
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

  /** The latest welcome email, outside a transaction, for the member's profile. */
  async find(accountId: string): Promise<WelcomeEmailRecord | null> {
    return ((await this.ref(accountId).get()).data() as WelcomeEmailRecord | undefined) ?? null;
  }

  private ref(accountId: string) {
    return this.firebase.db.collection(Collections.welcomeEmails).doc(accountId);
  }
}
