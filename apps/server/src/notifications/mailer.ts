import { Injectable, Logger } from '@nestjs/common';
import { mailAddressKey, mailMessageRecord } from 'ustp-domain';
import { MailNotSent, type MailMessage, type MailTransport } from './mail-transport.js';
import { MailRepository } from './mail.repository.js';

/** How a send went: the provider took it (with its ID for it), did not, or it was not tried. */
export type MailResult =
  | { readonly status: 'sent'; readonly messageId: string }
  | { readonly status: 'failed'; readonly outcome: 'refused' | 'unavailable' | 'error' }
  | { readonly status: 'skipped'; readonly outcome: 'undeliverable' };

/**
 * Sends one of the app's emails (design §6.8): not to an address that bounced for good or was marked as spam
 * (`undeliverable`), else through the transport, keeping a record of each message the provider took so its delivery
 * reports have somewhere to go. The address is used for the send only: it is in neither the record nor the logs.
 */
@Injectable()
export class Mailer {
  private readonly logger = new Logger(Mailer.name);

  constructor(private readonly mail: MailRepository) {}

  async send(transport: MailTransport, message: MailMessage): Promise<MailResult> {
    const { kind, ref, electionId, accountId } = message.meta;
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
