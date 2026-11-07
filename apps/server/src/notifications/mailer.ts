import { Inject, Injectable, Logger } from '@nestjs/common';
import { mailAddressKey, mailMessageRecord, mailStop, unsubscribeLinks, type MailStop, type UnsubscribeLinks } from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { MailPreferences } from './mail-preferences.js';
import { MailNotSent, type MailMessage, type MailTransport } from './mail-transport.js';
import { MailRepository } from './mail.repository.js';
import { NoticeSettingsService } from './notice-settings.js';

/** How a send went: the provider took it (with its ID for it), did not, or it was not tried. */
export type MailResult =
  | { readonly status: 'sent'; readonly messageId: string }
  | { readonly status: 'failed'; readonly outcome: 'refused' | 'unavailable' | 'error' }
  | { readonly status: 'skipped'; readonly outcome: 'undeliverable' | MailStop };

/**
 * Sends one of the app's emails (design §6.8), the one way they all go: nothing to anyone while all email is off, which
 * it is until a System Admin switches it on, nothing to a member who unsubscribed or whose email an admin stopped
 * (§10.12), and not to an address that bounced for good or was marked as spam (`undeliverable`); else through the
 * transport, keeping a record of each message the provider took so its delivery reports have somewhere to go. The address
 * is used for the send only: it is in neither the record nor the logs. A message to nobody (a rehearsal's) and the setup
 * check's to Amazon's simulator reach no one, so they go regardless; and a System Admin's test to themselves goes while
 * email is off, since that is how they see that it works before switching it on.
 */
@Injectable()
export class Mailer {
  private readonly logger = new Logger(Mailer.name);

  constructor(
    private readonly mail: MailRepository,
    private readonly preferences: MailPreferences,
    private readonly settings: NoticeSettingsService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** The links an email to this account carries, to stop all of it. */
  async links(accountId: string): Promise<UnsubscribeLinks> {
    return unsubscribeLinks(this.config.webOrigin!, await this.preferences.token(accountId));
  }

  async send(transport: MailTransport, message: MailMessage): Promise<MailResult> {
    const { kind, ref, electionId, accountId } = message.meta;
    if (message.to && kind !== 'probe') {
      if (kind !== 'admin_test' && !(await this.settings.current()).allEmails) return { status: 'failed', outcome: 'unavailable' };
      const stop = accountId ? mailStop(await this.preferences.find(accountId)) : null;
      if (stop) return { status: 'skipped', outcome: stop };
    }
    if (message.to && (await this.mail.suppression(mailAddressKey(message.to)))) return { status: 'skipped', outcome: 'undeliverable' };
    let messageId: string;
    try {
      ({ messageId } = await transport.send(message));
    } catch (e) {
      const outcome = e instanceof MailNotSent ? e.outcome : 'error';
      // Never the error's text, which can quote the address.
      const line = `${kind} email ${ref ?? ''} to account ${accountId ?? 'none'} not sent (${errorName(e)})`;
      if (outcome === 'unavailable') this.logger.warn(line);
      else this.logger.error(line);
      return { status: 'failed', outcome };
    }
    const record = mailMessageRecord({ messageId, kind, ref, electionId, accountId, delivery: transport.delivery, at: new Date().toISOString() });
    await this.mail.create(record).catch((e: unknown) => {
      // The message went; only what its reports say of it is lost.
      this.logger.error(`${kind} email ${messageId} sent, but not recorded: ${errorName(e)}`);
    });
    return { status: 'sent', messageId };
  }
}

/** What went wrong, as a code: never the error's text, which can quote the address. */
export function errorName(e: unknown): string {
  return e instanceof MailNotSent ? e.outcome : e instanceof Error ? e.name : 'error';
}
