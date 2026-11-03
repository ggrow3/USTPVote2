import {
  DeleteSuppressedDestinationCommand,
  GetAccountCommand,
  GetConfigurationSetCommand,
  GetConfigurationSetEventDestinationsCommand,
  GetEmailIdentityCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { MailQueueFacts, SesAccountFacts, SesConfigurationSetFacts, SesIdentityFacts, Unread } from 'ustp-domain';
import type { ServerConfig } from '../config.js';
import { accessToken } from '../infra/google-identity.js';

/** How long one read may take before the check reports it unread. */
const READ_TIMEOUT_MS = 5_000;

/**
 * Reads how Amazon SES is set up, for the email setup check (design §10.12): the account, the sender domain, the
 * configuration set and its event destinations, and the delivery-report queue with its dead-letter queue. Only the
 * worker builds it, with the same access key it sends with, whose IAM policy allows these reads
 * (`infra/terraform/aws`). A read that fails is reported by the AWS error's name, never its text.
 */
export class SesAccountReader {
  constructor(
    private readonly ses: Pick<SESv2Client, 'send'>,
    private readonly sqs: Pick<SQSClient, 'send'>,
    private readonly queueUrl: string | null,
  ) {}

  /** Null unless the worker sends through SES with a key. */
  static fromConfig(config: ServerConfig): SesAccountReader | null {
    const { region, accessKeyId, secretAccessKey, eventsQueueUrl } = config.ses;
    if (config.mailTransport !== 'ses' || !region || !accessKeyId || !secretAccessKey) return null;
    const credentials = { accessKeyId, secretAccessKey };
    return new SesAccountReader(new SESv2Client({ region, credentials }), new SQSClient({ region, credentials }), eventsQueueUrl);
  }

  async account(): Promise<SesAccountFacts | Unread> {
    return read(async () => {
      const out = await this.ses.send(new GetAccountCommand({}));
      return {
        productionAccess: out.ProductionAccessEnabled === true,
        sendingEnabled: out.SendingEnabled === true,
        enforcement: out.EnforcementStatus ?? null,
        maxSendRate: out.SendQuota?.MaxSendRate ?? 0,
        max24HourSend: out.SendQuota?.Max24HourSend ?? 0,
        sentLast24Hours: out.SendQuota?.SentLast24Hours ?? 0,
        suppressedReasons: out.SuppressionAttributes?.SuppressedReasons ?? [],
        engagementMetrics: out.VdmAttributes?.DashboardAttributes?.EngagementMetrics === 'ENABLED',
      };
    });
  }

  async identity(domain: string): Promise<SesIdentityFacts | Unread> {
    return read(async () => {
      const out = await this.ses.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
      return {
        verified: out.VerifiedForSendingStatus === true,
        dkim: out.DkimAttributes?.Status ?? null,
        mailFromDomain: out.MailFromAttributes?.MailFromDomain || null,
        mailFromStatus: out.MailFromAttributes?.MailFromDomainStatus ?? null,
        configurationSet: out.ConfigurationSetName ?? null,
      };
    });
  }

  async configurationSet(name: string): Promise<SesConfigurationSetFacts | Unread> {
    return read(async () => {
      const [set, destinations] = await Promise.all([
        this.ses.send(new GetConfigurationSetCommand({ ConfigurationSetName: name })),
        this.ses.send(new GetConfigurationSetEventDestinationsCommand({ ConfigurationSetName: name })),
      ]);
      return {
        sendingEnabled: set.SendingOptions?.SendingEnabled !== false,
        engagementMetrics: set.VdmOptions?.DashboardOptions?.EngagementMetrics === 'ENABLED',
        destinations: (destinations.EventDestinations ?? []).map((d) => ({
          enabled: d.Enabled === true,
          types: d.MatchingEventTypes ?? [],
          sns: !!d.SnsDestination?.TopicArn,
        })),
      };
    });
  }

  /** The queue, and its dead-letter queue found from its redrive policy; null when no queue is configured. */
  async queue(): Promise<MailQueueFacts | Unread | null> {
    if (!this.queueUrl) return null;
    const queueUrl = this.queueUrl;
    return read(async () => {
      const out = await this.sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'RedrivePolicy'],
        }),
      );
      const attributes = out.Attributes ?? {};
      const deadLetterUrl = queueUrlOf(redriveTarget(attributes.RedrivePolicy));
      let deadLetters: number | null = null;
      if (deadLetterUrl) {
        const dead = await this.sqs.send(new GetQueueAttributesCommand({ QueueUrl: deadLetterUrl, AttributeNames: ['ApproximateNumberOfMessages'] }));
        deadLetters = Number(dead.Attributes?.ApproximateNumberOfMessages ?? 0);
      }
      return {
        waiting: Number(attributes.ApproximateNumberOfMessages ?? 0),
        inFlight: Number(attributes.ApproximateNumberOfMessagesNotVisible ?? 0),
        redrive: !!deadLetterUrl,
        deadLetters,
      };
    });
  }

  /** Takes an address off the account's suppression list, if it is on it (design §6.8: its owner asked to try again). */
  async unsuppress(address: string): Promise<void> {
    try {
      await this.ses.send(new DeleteSuppressedDestinationCommand({ EmailAddress: address }));
    } catch (e) {
      if ((e as { name?: string }).name !== 'NotFoundException') throw e;
    }
  }
}

/** Runs a read within the time limit, giving the AWS error's name if it fails. */
async function read<T>(run: () => Promise<T>): Promise<T | Unread> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<Unread>((resolve) => {
    timer = setTimeout(() => resolve({ unread: 'Timeout' }), READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([run(), timeout]);
  } catch (e) {
    return { unread: (e as { name?: string }).name ?? 'Error' };
  } finally {
    clearTimeout(timer);
  }
}

/** The dead-letter queue's ARN in an SQS redrive policy, if any. */
function redriveTarget(policy: string | undefined): string | null {
  if (!policy) return null;
  try {
    const target = (JSON.parse(policy) as { deadLetterTargetArn?: unknown }).deadLetterTargetArn;
    return typeof target === 'string' ? target : null;
  } catch {
    return null;
  }
}

/** An SQS queue's URL from its ARN (`arn:aws:sqs:<region>:<account>:<name>`). */
export function queueUrlOf(arn: string | null): string | null {
  const m = arn ? /^arn:aws:sqs:([a-z0-9-]+):(\d{12}):([A-Za-z0-9_-]+)$/.exec(arn) : null;
  return m ? `https://sqs.${m[1]}.amazonaws.com/${m[2]}/${m[3]}` : null;
}

/** How Identity Platform sends its email, from its project configuration (`firebaseauth.configs.get`). */
export interface IdentityPlatformEmail {
  readonly method: string;
  readonly host: string | null;
  readonly senderEmail: string | null;
}

/**
 * Reads Identity Platform's email settings for the setup check (design §10.12), with the worker's own token from the
 * metadata server; never the SMTP password, which the check does not need.
 */
export class IdentityPlatformReader {
  constructor(
    private readonly projectId: string,
    private readonly token: () => Promise<string> = accessToken,
  ) {}

  /** Null where the worker cannot tell which project it is in (the emulators). */
  static fromConfig(config: ServerConfig): IdentityPlatformReader | null {
    return config.mailTransport === 'ses' && config.projectId ? new IdentityPlatformReader(config.projectId) : null;
  }

  async email(): Promise<IdentityPlatformEmail | Unread> {
    return read(async () => {
      const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(this.projectId)}/config`;
      const res = await fetch(url, { headers: { authorization: `Bearer ${await this.token()}` }, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { name: res.status === 403 ? 'PermissionDenied' : `HTTP${res.status}` });
      const config = (await res.json()) as { notification?: { sendEmail?: { method?: string; smtp?: { host?: string; senderEmail?: string } } } };
      const send = config.notification?.sendEmail;
      return { method: send?.method ?? 'DEFAULT', host: send?.smtp?.host ?? null, senderEmail: send?.smtp?.senderEmail ?? null };
    });
  }
}
