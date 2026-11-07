import { SendEmailCommand, SESv2Client, type SendEmailCommandInput } from '@aws-sdk/client-sesv2';
import { DeleteMessageBatchCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { ServerConfig } from '../config.js';
import type { BounceType, MailEvent, MailEventType } from 'ustp-domain';
import { MailNotSent, type MailEventSource, type MailMessage, type MailTransport } from './mail-transport.js';

/**
 * Amazon SES for the app's email (design §6.8): SESv2 `SendEmail`, and delivery reports from the SQS queue that the
 * configuration set's SNS topic feeds. Only the worker builds these, with an access key from Secret Manager that may
 * only send from the agreed address and read that queue (infra README "Email (Amazon SES)").
 */

/** The message tags SES copies into its delivery reports: what the message is, and what it belongs to. */
export const SES_KIND_TAG = 'kind';
export const SES_REF_TAG = 'ref';

export class SesTransport implements MailTransport {
  readonly delivery = 'mail';
  private next = 0;

  constructor(
    private readonly client: Pick<SESv2Client, 'send'>,
    private readonly options: { readonly configurationSet: string | null; readonly maxSendRate: number },
  ) {}

  /**
   * Refuses to start without what sending needs, so a misconfigured worker fails loudly rather than mail nobody. The
   * contact for questions may be set in the app instead of `NOTICE_CONTACT`, so the sender checks it, not this.
   */
  static fromConfig(config: ServerConfig): SesTransport {
    const { region, accessKeyId, secretAccessKey, configurationSet, maxSendRate } = config.ses;
    const missing = [
      !region && 'SES_REGION',
      !accessKeyId && 'AWS_SES_ACCESS_KEY_ID',
      !secretAccessKey && 'AWS_SES_SECRET_ACCESS_KEY',
      !config.webOrigin && 'WEB_ORIGIN',
    ].filter(Boolean);
    if (missing.length) throw new Error(`MAIL_TRANSPORT=ses needs ${missing.join(', ')}`);
    // One attempt: SES has no idempotency key, so a retry after a lost answer could send a second copy (design §6.8).
    const client = new SESv2Client({ region: region!, credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! }, maxAttempts: 1 });
    return new SesTransport(client, { configurationSet, maxSendRate });
  }

  async send(message: MailMessage): Promise<{ messageId: string }> {
    if (!message.to) throw new MailNotSent('refused', 'no address to send to');
    await this.pace();
    try {
      const out = await this.client.send(new SendEmailCommand(sesEmail(message, this.options.configurationSet)));
      if (!out.MessageId) throw new Error('SES answered without a message ID');
      return { messageId: out.MessageId };
    } catch (e) {
      const outcome = sesFailure(e);
      if (outcome) throw new MailNotSent(outcome, `SES ${(e as { name?: string }).name ?? 'error'}`);
      throw e;
    }
  }

  /** Spaces sends out to `maxSendRate` a second, however many run side by side. */
  private async pace(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + 1000 / this.options.maxSendRate;
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
  }
}

/** The `SendEmail` request: plain text and HTML in UTF-8, tagged with what it is so its delivery reports say so. */
export function sesEmail(message: MailMessage, configurationSet: string | null): SendEmailCommandInput {
  const utf8 = (Data: string) => ({ Data, Charset: 'UTF-8' });
  // RFC 8058: the mail client's own Unsubscribe button POSTs to this address, with no page in between.
  const Headers = message.listUnsubscribe
    ? [
        { Name: 'List-Unsubscribe', Value: `<${message.listUnsubscribe}>` },
        { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
      ]
    : undefined;
  return {
    FromEmailAddress: message.from,
    Destination: { ToAddresses: [message.to!] },
    ...(message.replyTo && { ReplyToAddresses: [message.replyTo] }),
    Content: { Simple: { Subject: utf8(message.subject), Body: { Text: utf8(message.text), Html: utf8(message.html) }, ...(Headers && { Headers }) } },
    ...(configurationSet && { ConfigurationSetName: configurationSet }),
    EmailTags: [
      { Name: SES_KIND_TAG, Value: message.meta.kind },
      ...(message.meta.ref ? [{ Name: SES_REF_TAG, Value: message.meta.ref }] : []),
    ],
  };
}

/** Errors in which SES answered, so the message was certainly not sent, but for a reason of its own (quota, keys). */
const UNAVAILABLE = new Set([
  'TooManyRequestsException',
  'LimitExceededException',
  'SendingPausedException',
  'ThrottlingException',
  'AccountSuspendedException',
  'MailFromDomainNotVerifiedException',
  'NotFoundException',
]);
/** Errors about this message or address: sending it again would fail the same way. */
const REFUSED = new Set(['MessageRejected', 'BadRequestException']);
/** Network errors raised before a request could reach SES. */
const NOT_CONNECTED = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

/**
 * What a failed `SendEmail` means: `refused` (not this message), `unavailable` (not now: SES answered with an error, or
 * could not be reached), or null when SES may have taken it (a timeout or a dropped connection), which is never sent
 * again by itself.
 */
export function sesFailure(e: unknown): 'refused' | 'unavailable' | null {
  const err = (e ?? {}) as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  if (err.name && REFUSED.has(err.name)) return 'refused';
  if ((err.name && UNAVAILABLE.has(err.name)) || err.$metadata?.httpStatusCode !== undefined) return 'unavailable';
  if (err.code && NOT_CONNECTED.has(err.code)) return 'unavailable';
  return null;
}

/** SES's names for the reports the worker reads; opens, clicks and subscriptions are not published to it. */
const EVENT_TYPES: Readonly<Record<string, MailEventType>> = {
  Send: 'send',
  Delivery: 'delivery',
  DeliveryDelay: 'delay',
  Bounce: 'bounce',
  Complaint: 'complaint',
  Reject: 'reject',
  'Rendering Failure': 'rendering_failure',
};

const BOUNCE_TYPES: Readonly<Record<string, BounceType>> = { Permanent: 'permanent', Transient: 'transient', Undetermined: 'undetermined' };

/**
 * A delivery report from an SQS message body: an SES event (event publishing, `eventType`, or a notification,
 * `notificationType`), raw or inside the SNS envelope. Null for anything else, or anything unreadable.
 */
export function sesMailEvent(body: string): MailEvent | null {
  try {
    let event = JSON.parse(body) as Record<string, any>;
    if (event?.Type === 'Notification' && typeof event.Message === 'string') event = JSON.parse(event.Message);
    const type = EVENT_TYPES[String(event?.eventType ?? event?.notificationType)];
    const mail = event?.mail;
    if (!type || typeof mail?.messageId !== 'string' || typeof mail.timestamp !== 'string') return null;
    const detail = event[{ send: 'send', delivery: 'delivery', delay: 'deliveryDelay', bounce: 'bounce', complaint: 'complaint', reject: 'reject', rendering_failure: 'failure' }[type]] ?? {};
    const tag = (name: string): string | null => {
      const value = mail.tags?.[name]?.[0];
      return typeof value === 'string' ? value : null;
    };
    const recipient =
      detail.bouncedRecipients?.[0]?.emailAddress ?? detail.complainedRecipients?.[0]?.emailAddress ?? detail.delayedRecipients?.[0]?.emailAddress;
    const destination = typeof recipient === 'string' ? recipient : typeof mail.destination?.[0] === 'string' ? mail.destination[0] : null;
    return {
      type,
      messageId: mail.messageId,
      sentAt: mail.timestamp,
      at: typeof detail.timestamp === 'string' ? detail.timestamp : mail.timestamp,
      kind: tag(SES_KIND_TAG),
      ref: tag(SES_REF_TAG),
      configurationSet: tag('ses:configuration-set'),
      destination,
      subject: typeof mail.commonHeaders?.subject === 'string' ? mail.commonHeaders.subject : null,
      bounce: type === 'bounce' ? { type: BOUNCE_TYPES[String(detail.bounceType)] ?? 'undetermined', subType: String(detail.bounceSubType ?? 'Undetermined') } : null,
      delay: type === 'delay' ? { type: String(detail.delayType ?? 'Undetermined'), until: typeof detail.expirationTime === 'string' ? detail.expirationTime : null } : null,
    };
  } catch {
    return null;
  }
}

/** The SQS queue SES delivery reports arrive on, read by the worker; nothing reaches the api from outside. */
export class SesEventQueue implements MailEventSource {
  constructor(
    private readonly client: Pick<SQSClient, 'send'>,
    private readonly queueUrl: string,
  ) {}

  static fromConfig(config: ServerConfig): SesEventQueue | null {
    const { region, accessKeyId, secretAccessKey, eventsQueueUrl } = config.ses;
    if (!eventsQueueUrl) return null;
    const client = new SQSClient({ region: region!, credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! } });
    return new SesEventQueue(client, eventsQueueUrl);
  }

  async receive(): Promise<{ receipt: string; event: MailEvent | null }[]> {
    const out = await this.client.send(
      new ReceiveMessageCommand({ QueueUrl: this.queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1, VisibilityTimeout: 60 }),
    );
    return (out.Messages ?? []).flatMap((m) => (m.ReceiptHandle ? [{ receipt: m.ReceiptHandle, event: sesMailEvent(m.Body ?? '') }] : []));
  }

  /** Removes handled reports; one not removed comes back, and is recorded again to the same effect. */
  async acknowledge(receipts: readonly string[]): Promise<void> {
    if (!receipts.length) return;
    await this.client.send(
      new DeleteMessageBatchCommand({ QueueUrl: this.queueUrl, Entries: receipts.map((ReceiptHandle, i) => ({ Id: String(i), ReceiptHandle })) }),
    );
  }
}
