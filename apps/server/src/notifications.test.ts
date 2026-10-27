import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DeleteMessageBatchCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAIL_FROM, loadConfig } from './config.js';
import { MailNotSent, type MailMessage } from './notifications/mail-transport.js';
import { sesBounce, SesBounceQueue, sesEmail, sesFailure, SesTransport } from './notifications/ses.js';

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
  tags: { noticeId: 'e1_voting_open', electionId: 'e1', accountId: 'a1' },
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
  it('asks for plain text and HTML in UTF-8, from the agreed address, tagged with the notice', () => {
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
      EmailTags: [{ Name: 'notice', Value: 'e1_voting_open' }],
    });
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

  it('will not start without its key, the contact or the web origin', () => {
    const config = loadConfig({ MAIL_TRANSPORT: 'ses', SES_REGION: 'us-east-1' });
    expect(() => SesTransport.fromConfig(config)).toThrow(
      'MAIL_TRANSPORT=ses needs AWS_SES_ACCESS_KEY_ID, AWS_SES_SECRET_ACCESS_KEY, NOTICE_CONTACT, WEB_ORIGIN',
    );
    const ready = loadConfig({
      MAIL_TRANSPORT: 'ses',
      SES_REGION: 'us-east-1',
      AWS_SES_ACCESS_KEY_ID: 'AKIA',
      AWS_SES_SECRET_ACCESS_KEY: 'secret',
      NOTICE_CONTACT: 'elections@example.org',
      WEB_ORIGIN: 'https://ustpvote2-dev.web.app',
    });
    expect(SesTransport.fromConfig(ready)).toBeInstanceOf(SesTransport);
    expect(SesBounceQueue.fromConfig(ready)).toBeNull(); // no queue: bounces are not counted
  });
});

describe('bounce reports from SQS', () => {
  const event = (over: Record<string, unknown> = {}) => ({
    eventType: 'Bounce',
    bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'ada@example.org' }] },
    mail: { messageId: 'ses-1', tags: { notice: ['e1_voting_open'], 'ses:configuration-set': ['ustp-notices'] } },
    ...over,
  });

  it('reads a permanent bounce, raw or in its SNS envelope, by message ID and notice', () => {
    expect(sesBounce(JSON.stringify(event()))).toEqual({ noticeId: 'e1_voting_open', messageId: 'ses-1' });
    expect(sesBounce(JSON.stringify({ Type: 'Notification', Message: JSON.stringify(event()) }))).toEqual({
      noticeId: 'e1_voting_open',
      messageId: 'ses-1',
    });
    const { eventType, ...notification } = event();
    expect(eventType).toBe('Bounce');
    expect(sesBounce(JSON.stringify({ ...notification, notificationType: 'Bounce' }))).toEqual({ noticeId: 'e1_voting_open', messageId: 'ses-1' });
  });

  it('drops transient bounces, complaints, deliveries, other mail and garbage', () => {
    expect(sesBounce(JSON.stringify(event({ bounce: { bounceType: 'Transient' } })))).toBeNull();
    expect(sesBounce(JSON.stringify(event({ eventType: 'Complaint' })))).toBeNull();
    expect(sesBounce(JSON.stringify(event({ eventType: 'Delivery' })))).toBeNull();
    expect(sesBounce(JSON.stringify(event({ mail: { messageId: 'ses-1', tags: {} } })))).toBeNull();
    expect(sesBounce('not json')).toBeNull();
    expect(sesBounce('null')).toBeNull();
  });

  it('receives a batch and deletes what was handled', async () => {
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789012/q';
    const client = fakeClient((command) =>
      command instanceof ReceiveMessageCommand
        ? { Messages: [{ Body: JSON.stringify(event()), ReceiptHandle: 'r1' }, { Body: '{}', ReceiptHandle: 'r2' }] }
        : {},
    );
    const queue = new SesBounceQueue(client, queueUrl);
    expect(await queue.receive()).toEqual({ bounces: [{ noticeId: 'e1_voting_open', messageId: 'ses-1' }], receipts: ['r1', 'r2'] });
    expect((client.sent[0] as ReceiveMessageCommand).input).toMatchObject({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 0 });
    await queue.acknowledge(['r1', 'r2']);
    expect(client.sent[1]).toBeInstanceOf(DeleteMessageBatchCommand);
    expect((client.sent[1] as DeleteMessageBatchCommand).input).toEqual({
      QueueUrl: queueUrl,
      Entries: [
        { Id: '0', ReceiptHandle: 'r1' },
        { Id: '1', ReceiptHandle: 'r2' },
      ],
    });
    await queue.acknowledge([]);
    expect(client.sent).toHaveLength(2);
  });
});
