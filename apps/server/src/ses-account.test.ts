import {
  DeleteSuppressedDestinationCommand,
  GetAccountCommand,
  GetConfigurationSetCommand,
  GetConfigurationSetEventDestinationsCommand,
  GetEmailIdentityCommand,
} from '@aws-sdk/client-sesv2';
import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { queueUrlOf, SesAccountReader } from './notifications/ses-account.js';

const QUEUE = 'https://sqs.us-east-1.amazonaws.com/123456789012/ustp-mail-events-dev';

/** Stands in for an AWS SDK client: answers each command by its class, records what it was asked. */
function fake(answers: Map<unknown, (input: Record<string, unknown>) => unknown>) {
  const asked: { command: string; input: Record<string, unknown> }[] = [];
  return {
    asked,
    send: async (command: { constructor: unknown; input: Record<string, unknown> }) => {
      asked.push({ command: (command.constructor as { name: string }).name, input: command.input });
      const answer = answers.get(command.constructor);
      if (!answer) throw Object.assign(new Error('not faked'), { name: 'AccessDeniedException' });
      const out = answer(command.input);
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

describe('reading how SES is set up', () => {
  it('reads the account, the sender domain and the configuration set as the check needs them', async () => {
    const ses = fake(
      new Map<unknown, (input: Record<string, unknown>) => unknown>([
        [
          GetAccountCommand,
          () => ({
            ProductionAccessEnabled: true,
            SendingEnabled: true,
            EnforcementStatus: 'HEALTHY',
            SendQuota: { MaxSendRate: 14, Max24HourSend: 50_000, SentLast24Hours: 12 },
            SuppressionAttributes: { SuppressedReasons: ['BOUNCE'] },
          }),
        ],
        [
          GetEmailIdentityCommand,
          () => ({
            VerifiedForSendingStatus: true,
            DkimAttributes: { Status: 'SUCCESS' },
            MailFromAttributes: { MailFromDomain: 'mail.dev.example.org', MailFromDomainStatus: 'PENDING' },
            ConfigurationSetName: 'ustp-mail-dev',
          }),
        ],
        [GetConfigurationSetCommand, () => ({ SendingOptions: { SendingEnabled: true }, VdmOptions: { DashboardOptions: { EngagementMetrics: 'DISABLED' } } })],
        [
          GetConfigurationSetEventDestinationsCommand,
          () => ({ EventDestinations: [{ Name: 'to-sqs', Enabled: true, MatchingEventTypes: ['BOUNCE', 'DELIVERY'], SnsDestination: { TopicArn: 'arn:aws:sns:x' } }] }),
        ],
      ]),
    );
    const reader = new SesAccountReader(ses, fake(new Map()), null);
    expect(await reader.account()).toEqual({
      productionAccess: true,
      sendingEnabled: true,
      enforcement: 'HEALTHY',
      maxSendRate: 14,
      max24HourSend: 50_000,
      sentLast24Hours: 12,
      suppressedReasons: ['BOUNCE'],
      engagementMetrics: false,
    });
    expect(await reader.identity('dev.example.org')).toEqual({
      verified: true,
      dkim: 'SUCCESS',
      mailFromDomain: 'mail.dev.example.org',
      mailFromStatus: 'PENDING',
      configurationSet: 'ustp-mail-dev',
    });
    expect(ses.asked.find((a) => a.command === 'GetEmailIdentityCommand')!.input).toEqual({ EmailIdentity: 'dev.example.org' });
    expect(await reader.configurationSet('ustp-mail-dev')).toEqual({
      sendingEnabled: true,
      engagementMetrics: false,
      destinations: [{ enabled: true, types: ['BOUNCE', 'DELIVERY'], sns: true }],
    });
    expect(await reader.queue()).toBeNull(); // no queue configured
  });

  it('gives the error’s name for a read it could not make, never its text', async () => {
    const reader = new SesAccountReader(fake(new Map()), fake(new Map()), QUEUE);
    expect(await reader.account()).toEqual({ unread: 'AccessDeniedException' });
    expect(await reader.queue()).toEqual({ unread: 'AccessDeniedException' });
  });

  it('reads the queue and finds its dead-letter queue from the redrive policy', async () => {
    const sqs = fake(
      new Map<unknown, (input: Record<string, unknown>) => unknown>([
        [
          GetQueueAttributesCommand,
          (input) =>
            input.QueueUrl === QUEUE
              ? {
                  Attributes: {
                    ApproximateNumberOfMessages: '7',
                    ApproximateNumberOfMessagesNotVisible: '2',
                    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: 'arn:aws:sqs:us-east-1:123456789012:ustp-mail-events-dev-dlq', maxReceiveCount: 5 }),
                  },
                }
              : { Attributes: { ApproximateNumberOfMessages: '1' } },
        ],
      ]),
    );
    expect(await new SesAccountReader(fake(new Map()), sqs, QUEUE).queue()).toEqual({ waiting: 7, inFlight: 2, redrive: true, deadLetters: 1 });
    expect(sqs.asked[1]!.input.QueueUrl).toBe(`${QUEUE}-dlq`);
  });

  it('takes an address off the suppression list, whether or not it is on it', async () => {
    const notFound = Object.assign(new Error('nope'), { name: 'NotFoundException' });
    const ses = fake(new Map<unknown, (input: Record<string, unknown>) => unknown>([[DeleteSuppressedDestinationCommand, () => notFound]]));
    await expect(new SesAccountReader(ses, fake(new Map()), null).unsuppress('ada@example.org')).resolves.toBeUndefined();
    expect(ses.asked[0]!.input).toEqual({ EmailAddress: 'ada@example.org' });
  });

  it('is built only where the worker sends through SES with a key', () => {
    expect(SesAccountReader.fromConfig(loadConfig({}))).toBeNull();
    const ses = { MAIL_TRANSPORT: 'ses', SES_REGION: 'us-east-1', AWS_SES_ACCESS_KEY_ID: 'AKIA', AWS_SES_SECRET_ACCESS_KEY: 's' };
    expect(SesAccountReader.fromConfig(loadConfig(ses))).toBeInstanceOf(SesAccountReader);
    expect(queueUrlOf('arn:aws:sqs:eu-west-1:123456789012:q-dlq')).toBe('https://sqs.eu-west-1.amazonaws.com/123456789012/q-dlq');
    expect(queueUrlOf('nonsense')).toBeNull();
  });
});
