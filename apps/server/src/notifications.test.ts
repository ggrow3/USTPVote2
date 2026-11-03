import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DeleteMessageBatchCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAIL_FROM, loadConfig } from './config.js';
import { actedOutReports, MailNotSent, sesEventBody, type MailMessage } from './notifications/mail-transport.js';
import { sesEmail, SesEventQueue, sesFailure, sesMailEvent, SesTransport } from './notifications/ses.js';

describe('election notice configuration', () => {
  const emulators = { FIRESTORE_EMULATOR_HOST: 'x', FIREBASE_AUTH_EMULATOR_HOST: 'y', GCLOUD_PROJECT: 'demo-p' };

  it('sends nothing in a real project unless switched on, and refuses the outbox there', () => {
    expect(loadConfig({})).toMatchObject({ mailTransport: 'off', webOrigin: null, mailReplyTo: null, noticeContact: null });
    expect(loadConfig({ MAIL_TRANSPORT: 'ses' }).mailTransport).toBe('ses');
    expect(() => loadConfig({ MAIL_TRANSPORT: 'outbox' })).toThrow(/only allowed with the Firebase emulators/);
    expect(() => loadConfig({ MAIL_TRANSPORT: 'pigeon' })).toThrow(/MAIL_TRANSPORT must be/);
  });

  it('records notices in the outbox with the emulators, linking to the local web app', () => {
    expect(loadConfig(emulators)).toMatchObject({ mailTransport: 'outbox', mailFrom: DEFAULT_MAIL_FROM, webOrigin: 'http://localhost:5173' });
    expect(DEFAULT_MAIL_FROM).toBe('USTP Elections <noreply@transhumanist-party.org>');
    expect(loadConfig({ ...emulators, MAIL_TRANSPORT: 'off' }).mailTransport).toBe('off');
  });

  it('takes the headers, the contact, the web origin and SES from the environment', () => {
    expect(
      loadConfig({
        WEB_ORIGIN: 'https://ustpvote2-dev.web.app/',
        MAIL_FROM: 'USTP Elections <elections@example.org>',
        MAIL_REPLY_TO: 'secretary@example.org',
        NOTICE_CONTACT: ' elections@example.org ',
        SES_REGION: 'us-east-1',
        SES_CONFIGURATION_SET: 'ustp-notices',
        SES_EVENTS_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123456789012/q',
        AWS_SES_ACCESS_KEY_ID: 'AKIA',
        AWS_SES_SECRET_ACCESS_KEY: 'secret',
        SES_MAX_SEND_RATE: '5',
      }),
    ).toMatchObject({
      webOrigin: 'https://ustpvote2-dev.web.app',
      mailFrom: 'USTP Elections <elections@example.org>',
      mailReplyTo: 'secretary@example.org',
      noticeContact: 'elections@example.org',
      ses: {
        region: 'us-east-1',
        configurationSet: 'ustp-notices',
        eventsQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/q',
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret',
        maxSendRate: 5,
      },
    });
    expect(loadConfig({}).ses.maxSendRate).toBe(10);
    expect(() => loadConfig({ SES_MAX_SEND_RATE: '0' })).toThrow(/SES_MAX_SEND_RATE must be a positive number/);
  });

  it('accepts only an origin for WEB_ORIGIN, since links are built from it', () => {
    expect(() => loadConfig({ WEB_ORIGIN: 'ustpvote2-dev.web.app' })).toThrow(/must be a URL/);
    expect(() => loadConfig({ WEB_ORIGIN: 'https://ustpvote2-dev.web.app/ballot' })).toThrow(/must be an origin/);
    expect(() => loadConfig({ WEB_ORIGIN: 'https://ustpvote2-dev.web.app/?x=1' })).toThrow(/must be an origin/);
    expect(() => loadConfig({ WEB_ORIGIN: 'ftp://example.org' })).toThrow(/must be an origin/);
  });
});

const MESSAGE: MailMessage = {
  to: 'ada@example.org',
  from: 'USTP Elections <noreply@transhumanist-party.org>',
  replyTo: null,
  subject: 'Voting is open: Officers',
  text: 'Hello Ada,',
  html: '<p>Hello Ada,</p>',
  meta: { kind: 'voting_open', ref: 'e1_voting_open', electionId: 'e1', accountId: 'a1' },
};

/** Stands in for the AWS SDK client: records each command and answers as told. */
function fakeClient(answer: (command: unknown) => unknown) {
  const sent: unknown[] = [];
  return {
    sent,
    send: async (command: unknown) => {
      sent.push(command);
      const out = answer(command);
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

const awsError = (name: string, status?: number) =>
  Object.assign(new Error(name), { name, ...(status !== undefined && { $metadata: { httpStatusCode: status } }) });

describe('sending through Amazon SES', () => {
  it('asks for plain text and HTML in UTF-8, from the agreed address, tagged with what it is and nothing personal', () => {
    expect(sesEmail(MESSAGE, 'ustp-notices')).toEqual({
      FromEmailAddress: 'USTP Elections <noreply@transhumanist-party.org>',
      Destination: { ToAddresses: ['ada@example.org'] },
      Content: {
        Simple: {
          Subject: { Data: 'Voting is open: Officers', Charset: 'UTF-8' },
          Body: { Text: { Data: 'Hello Ada,', Charset: 'UTF-8' }, Html: { Data: '<p>Hello Ada,</p>', Charset: 'UTF-8' } },
        },
      },
      ConfigurationSetName: 'ustp-notices',
      EmailTags: [
        { Name: 'kind', Value: 'voting_open' },
        { Name: 'ref', Value: 'e1_voting_open' },
      ],
    });
    expect(sesEmail({ ...MESSAGE, meta: { kind: 'account_email', ref: null, electionId: null, accountId: 'a1' } }, null).EmailTags).toEqual([
      { Name: 'kind', Value: 'account_email' },
    ]);
    const plain = sesEmail({ ...MESSAGE, replyTo: 'secretary@example.org' }, null);
    expect(plain.ReplyToAddresses).toEqual(['secretary@example.org']);
    expect(plain).not.toHaveProperty('ConfigurationSetName');
  });

  it('returns the message ID SES gives', async () => {
    const client = fakeClient(() => ({ MessageId: 'ses-1' }));
    const ses = new SesTransport(client, { configurationSet: 'ustp-notices', maxSendRate: 1000 });
    expect(await ses.send(MESSAGE)).toEqual({ messageId: 'ses-1' });
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]).toBeInstanceOf(SendEmailCommand);
    expect((client.sent[0] as SendEmailCommand).input.Destination).toEqual({ ToAddresses: ['ada@example.org'] });
  });

  it('says whether a failed send certainly did not go, and why', async () => {
    const send = (error: Error) => new SesTransport(fakeClient(() => error), { configurationSet: null, maxSendRate: 1000 }).send(MESSAGE);
    await expect(send(awsError('MessageRejected', 400))).rejects.toMatchObject({ outcome: 'refused' });
    await expect(send(awsError('TooManyRequestsException', 429))).rejects.toMatchObject({ outcome: 'unavailable' });
    await expect(send(awsError('InternalFailure', 500))).rejects.toBeInstanceOf(MailNotSent);
    // A timeout: SES may have taken it, so it is not a MailNotSent, and the worker never sends it again by itself.
    await expect(send(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).rejects.not.toBeInstanceOf(MailNotSent);
    await expect(new SesTransport(fakeClient(() => ({})), { configurationSet: null, maxSendRate: 1000 }).send({ ...MESSAGE, to: null })).rejects.toMatchObject({
      outcome: 'refused',
    });
  });

  it('maps SES errors to outcomes', () => {
    expect(sesFailure(awsError('MessageRejected', 400))).toBe('refused');
    expect(sesFailure(awsError('BadRequestException', 400))).toBe('refused');
    expect(sesFailure(awsError('SendingPausedException', 400))).toBe('unavailable');
    expect(sesFailure(awsError('LimitExceededException', 400))).toBe('unavailable');
    expect(sesFailure(awsError('MailFromDomainNotVerifiedException', 400))).toBe('unavailable');
    expect(sesFailure(awsError('UnrecognizedClientException', 403))).toBe('unavailable');
    expect(sesFailure(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))).toBe('unavailable');
    expect(sesFailure(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBeNull();
    expect(sesFailure(new Error('?'))).toBeNull();
  });

  it('spaces sends out to the configured rate', async () => {
    const ses = new SesTransport(fakeClient(() => ({ MessageId: 'm' })), { configurationSet: null, maxSendRate: 20 });
    const started = Date.now();
    await Promise.all([ses.send(MESSAGE), ses.send(MESSAGE), ses.send(MESSAGE)]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(95); // the third waits two slots of 50 ms
  });

  it('will not start without its key or the web origin; the contact may come from the app', () => {
    const config = loadConfig({ MAIL_TRANSPORT: 'ses', SES_REGION: 'us-east-1' });
    expect(() => SesTransport.fromConfig(config)).toThrow(
      'MAIL_TRANSPORT=ses needs AWS_SES_ACCESS_KEY_ID, AWS_SES_SECRET_ACCESS_KEY, WEB_ORIGIN',
    );
    const ready = loadConfig({
      MAIL_TRANSPORT: 'ses',
      SES_REGION: 'us-east-1',
      AWS_SES_ACCESS_KEY_ID: 'AKIA',
      AWS_SES_SECRET_ACCESS_KEY: 'secret',
      WEB_ORIGIN: 'https://ustpvote2-dev.web.app',
    });
    expect(SesTransport.fromConfig(ready)).toBeInstanceOf(SesTransport);
    expect(SesEventQueue.fromConfig(ready)).toBeNull(); // no queue: no delivery reports
  });
});

describe('delivery reports from SQS', () => {
  const tags = { kind: ['voting_open'], ref: ['e1_voting_open'], 'ses:configuration-set': ['ustp-mail-dev'] };
  const event = (over: Record<string, unknown> = {}) => ({
    eventType: 'Bounce',
    bounce: {
      bounceType: 'Permanent',
      bounceSubType: 'General',
      timestamp: '2026-11-03T12:01:00.000Z',
      bouncedRecipients: [{ emailAddress: 'ada@example.org', diagnosticCode: 'smtp; 550 5.1.1 user unknown' }],
    },
    mail: { messageId: 'ses-1', timestamp: '2026-11-03T12:00:00.000Z', destination: ['ada@example.org'], tags },
    ...over,
  });
  const bounced = {
    type: 'bounce',
    messageId: 'ses-1',
    sentAt: '2026-11-03T12:00:00.000Z',
    at: '2026-11-03T12:01:00.000Z',
    kind: 'voting_open',
    ref: 'e1_voting_open',
    configurationSet: 'ustp-mail-dev',
    destination: 'ada@example.org',
    bounce: { type: 'permanent', subType: 'General' },
    delay: null,
  };

  it('reads a report, raw or in its SNS envelope, keeping no mail server text', () => {
    expect(sesMailEvent(JSON.stringify(event()))).toEqual(bounced);
    expect(sesMailEvent(JSON.stringify({ Type: 'Notification', Message: JSON.stringify(event()) }))).toEqual(bounced);
    const { eventType, ...notification } = event();
    expect(eventType).toBe('Bounce');
    expect(sesMailEvent(JSON.stringify({ ...notification, notificationType: 'Bounce' }))).toEqual(bounced);
    expect(JSON.stringify(sesMailEvent(JSON.stringify(event())))).not.toContain('550');
  });

  it('reads every kind of report the configuration set publishes', () => {
    const read = (over: Record<string, unknown>) => sesMailEvent(JSON.stringify(event(over)));
    expect(read({ eventType: 'Bounce', bounce: { bounceType: 'Transient', bounceSubType: 'MailboxFull' } })).toMatchObject({
      type: 'bounce',
      bounce: { type: 'transient', subType: 'MailboxFull' },
      at: '2026-11-03T12:00:00.000Z',
    });
    expect(read({ eventType: 'Delivery', delivery: { timestamp: '2026-11-03T12:00:05.000Z' } })).toMatchObject({ type: 'delivery', at: '2026-11-03T12:00:05.000Z' });
    expect(read({ eventType: 'Complaint', complaint: { complainedRecipients: [{ emailAddress: 'Ada@Example.org' }] } })).toMatchObject({
      type: 'complaint',
      destination: 'Ada@Example.org',
    });
    expect(read({ eventType: 'DeliveryDelay', deliveryDelay: { delayType: 'MailboxFull', expirationTime: '2026-11-04T12:00:00.000Z' } })).toMatchObject({
      type: 'delay',
      delay: { type: 'MailboxFull', until: '2026-11-04T12:00:00.000Z' },
    });
    expect(read({ eventType: 'Send', send: {} })).toMatchObject({ type: 'send' });
    expect(read({ eventType: 'Reject', reject: { reason: 'Bad content' } })).toMatchObject({ type: 'reject' });
    expect(read({ eventType: 'Rendering Failure', failure: {} })).toMatchObject({ type: 'rendering_failure' });
  });

  it('reads mail Identity Platform sent, which carries none of this app’s tags', () => {
    const plain = event({ eventType: 'Delivery', mail: { messageId: 'ses-9', timestamp: '2026-11-03T12:00:00.000Z', destination: ['ada@example.org'] } });
    expect(sesMailEvent(JSON.stringify(plain))).toMatchObject({ type: 'delivery', kind: null, ref: null, configurationSet: null, destination: 'ada@example.org' });
  });

  it('drops opens, clicks, other notifications and garbage', () => {
    expect(sesMailEvent(JSON.stringify(event({ eventType: 'Open' })))).toBeNull();
    expect(sesMailEvent(JSON.stringify(event({ eventType: 'Click' })))).toBeNull();
    expect(sesMailEvent(JSON.stringify(event({ mail: { tags } })))).toBeNull();
    expect(sesMailEvent('not json')).toBeNull();
    expect(sesMailEvent('null')).toBeNull();
  });

  it('receives a batch and deletes only what was handled', async () => {
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789012/q';
    const client = fakeClient((command) =>
      command instanceof ReceiveMessageCommand
        ? { Messages: [{ Body: JSON.stringify(event()), ReceiptHandle: 'r1' }, { Body: '{}', ReceiptHandle: 'r2' }, { Body: '{}' }] }
        : {},
    );
    const queue = new SesEventQueue(client, queueUrl);
    expect(await queue.receive()).toEqual([
      { receipt: 'r1', event: bounced },
      { receipt: 'r2', event: null },
    ]);
    expect((client.sent[0] as ReceiveMessageCommand).input).toMatchObject({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 });
    await queue.acknowledge(['r2']);
    expect(client.sent[1]).toBeInstanceOf(DeleteMessageBatchCommand);
    expect((client.sent[1] as DeleteMessageBatchCommand).input).toEqual({ QueueUrl: queueUrl, Entries: [{ Id: '0', ReceiptHandle: 'r2' }] });
    await queue.acknowledge([]);
    expect(client.sent).toHaveLength(2);
  });
});

describe('the outbox acting out SES', () => {
  it('delivers by default, and answers as the test domains and SES’s simulator say', () => {
    const types = (to: string | null) => actedOutReports(to).map((r) => r.eventType);
    expect(types('ada@example.test')).toEqual(['Delivery']);
    expect(types(null)).toEqual([]);
    expect(types('gone@bounce.test')).toEqual(['Bounce']);
    expect(types('spam@complaint.test')).toEqual(['Delivery', 'Complaint']);
    expect(types('slow@delay.test')).toEqual(['DeliveryDelay', 'Delivery']);
    expect(types('success+probe1@simulator.amazonses.com')).toEqual(['Delivery']);
    expect(types('bounce+probe1@simulator.amazonses.com')).toEqual(['Bounce']);
    expect(types('complaint@simulator.amazonses.com')).toEqual(['Delivery', 'Complaint']);
  });

  it('writes reports the SES parser reads', () => {
    const [report] = actedOutReports('full@soft.test');
    const body = sesEventBody({
      ...report!,
      messageId: 'o1',
      to: 'full@soft.test',
      sentAt: '2026-11-03T12:00:00.000Z',
      at: '2026-11-03T12:00:00.000Z',
      tags: { kind: 'welcome', ref: 'a1', 'ses:configuration-set': 'ustp-mail-dev' },
    });
    expect(sesMailEvent(body)).toEqual({
      type: 'bounce',
      messageId: 'o1',
      sentAt: '2026-11-03T12:00:00.000Z',
      at: '2026-11-03T12:00:00.000Z',
      kind: 'welcome',
      ref: 'a1',
      configurationSet: 'ustp-mail-dev',
      destination: 'full@soft.test',
      bounce: { type: 'transient', subType: 'MailboxFull' },
      delay: null,
    });
  });
});
