import { describe, expect, it } from 'vitest';
import {
  applyMailEvent,
  identityMailRecord,
  isNoticeMail,
  mailAddressKey,
  mailMessageRecord,
  nextSuppression,
  recipientStatusOf,
  type MailEvent,
  type MailMessageRecord,
} from '../index.js';

const SENT = '2026-11-03T12:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(SENT) + minutes * 60_000).toISOString();

const sent = (over: Partial<MailMessageRecord> = {}): MailMessageRecord => ({
  ...mailMessageRecord({ messageId: 'm1', kind: 'voting_open', ref: 'e1_voting_open', electionId: 'e1', accountId: 'a1', delivery: 'mail', at: SENT }),
  ...over,
});

const event = (type: MailEvent['type'], minutes: number, over: Partial<MailEvent> = {}): MailEvent => ({
  type,
  messageId: 'm1',
  sentAt: SENT,
  at: at(minutes),
  kind: 'voting_open',
  ref: 'e1_voting_open',
  configurationSet: 'ustp-mail-dev',
  destination: 'ada@example.org',
  bounce: null,
  delay: null,
  ...over,
});

const permanent = { type: 'permanent' as const, subType: 'General' };

describe('the record of a message sent', () => {
  it('starts as sent, counted only when really mailed', () => {
    expect(sent()).toMatchObject({ status: 'sent', sender: 'app', counted: true, deliveredAt: null, bounce: null });
    expect(sent({ ...mailMessageRecord({ messageId: 'm1', kind: 'welcome', ref: 'a1', electionId: null, accountId: 'a1', delivery: 'outbox', at: SENT }) }))
      .toMatchObject({ counted: false, delivery: 'outbox' });
  });

  it('of mail Identity Platform sent is made from its first report', () => {
    const record = identityMailRecord(event('send', 0, { kind: null, ref: null }), 'a7');
    expect(record).toMatchObject({ messageId: 'm1', accountId: 'a7', kind: 'account_email', sender: 'identity_platform', status: 'sent', sentAt: SENT });
  });
});

describe('applyMailEvent', () => {
  it('moves a message on as reports arrive, keeping when each happened', () => {
    const delayed = applyMailEvent(sent(), event('delay', 5, { delay: { type: 'MailboxFull', until: at(600) } }));
    expect(delayed).toMatchObject({ changed: true, suppress: null, record: { status: 'delayed', delayedAt: at(5), delay: { type: 'MailboxFull' } } });
    const delivered = applyMailEvent(delayed.record, event('delivery', 30));
    expect(delivered.record).toMatchObject({ status: 'delivered', delayedAt: at(5), deliveredAt: at(30), updatedAt: at(30) });
  });

  it('never moves a message back, whatever order the reports come in', () => {
    const delivered = applyMailEvent(sent(), event('delivery', 2)).record;
    const late = applyMailEvent(delivered, event('delay', 1, { delay: { type: 'TransientCommunicationFailure', until: null } }));
    expect(late.record.status).toBe('delivered');
    expect(late.record.delayedAt).toBe(at(1));
    expect(applyMailEvent(delivered, event('send', 0)).record.status).toBe('delivered');
  });

  it('changes nothing when a report comes twice', () => {
    const once = applyMailEvent(sent(), event('delivery', 2)).record;
    const twice = applyMailEvent(once, event('delivery', 2));
    expect(twice.changed).toBe(false);
    expect(twice.record).toBe(once);
  });

  it('stops mail to an address that bounced for good, or whose owner marked it as spam', () => {
    expect(applyMailEvent(sent(), event('bounce', 1, { bounce: permanent }))).toMatchObject({
      suppress: 'bounced',
      record: { status: 'bounced', bounce: permanent, bouncedAt: at(1), counted: true },
    });
    const complained = applyMailEvent(applyMailEvent(sent(), event('delivery', 1)).record, event('complaint', 9));
    expect(complained).toMatchObject({ suppress: 'complained', record: { status: 'complained', deliveredAt: at(1), complainedAt: at(9) } });
  });

  it('marks a soft bounce bounced without stopping mail to the address', () => {
    const soft = applyMailEvent(sent(), event('bounce', 1, { bounce: { type: 'transient', subType: 'MailboxFull' } }));
    expect(soft).toMatchObject({ suppress: null, record: { status: 'bounced', bounce: { type: 'transient' } } });
  });

  it('does not count a bounce SES gave because the address is on its suppression list', () => {
    const listed = applyMailEvent(sent(), event('bounce', 0, { bounce: { type: 'permanent', subType: 'OnAccountSuppressionList' } }));
    expect(listed).toMatchObject({ suppress: 'bounced', record: { counted: false } });
  });

  it('records a message the service rejected after all', () => {
    expect(applyMailEvent(sent(), event('rendering_failure', 0)).record).toMatchObject({ status: 'rejected', rejectedAt: at(0) });
    expect(applyMailEvent(sent(), event('reject', 0)).suppress).toBeNull();
  });
});

describe('what a notice recipient record says of a message', () => {
  it('follows its reports, a rejection counting as a bounce', () => {
    expect(['sent', 'delayed', 'delivered', 'bounced', 'complained', 'rejected'].map((s) => recipientStatusOf(s as never))).toEqual([
      'sent',
      'sent',
      'delivered',
      'bounced',
      'complained',
      'bounced',
    ]);
    expect(isNoticeMail('voting_open')).toBe(true);
    expect(isNoticeMail('notice_test')).toBe(false);
  });
});

describe('suppressed addresses', () => {
  it('are keyed by a hash of the address, the same however it is written', () => {
    expect(mailAddressKey(' Ada@Example.ORG ')).toBe(mailAddressKey('ada@example.org'));
    expect(mailAddressKey('ada@example.org')).not.toBe(mailAddressKey('ben@example.org'));
    expect(mailAddressKey('ada@example.org')).toMatch(/^[0-9a-f]{64}$/);
    expect(mailAddressKey('ada@example.org')).not.toContain('ada');
  });

  it('start with their first report, a complaint outweighing a bounce and the last report renewing it', () => {
    const key = mailAddressKey('ada@example.org');
    const first = nextSuppression(null, { addressKey: key, reason: 'bounced', event: event('bounce', 1, { bounce: permanent }), accountId: 'a1' });
    expect(first).toEqual({ addressKey: key, reason: 'bounced', subType: 'General', accountId: 'a1', since: at(1), lastEventAt: at(1), messageId: 'm1' });
    const later = nextSuppression(first, { addressKey: key, reason: 'complained', event: event('complaint', 50, { messageId: 'm2' }), accountId: null });
    expect(later).toEqual({ ...first, reason: 'complained', subType: null, lastEventAt: at(50) });
    expect(nextSuppression(later, { addressKey: key, reason: 'bounced', event: event('bounce', 20, { bounce: permanent }), accountId: 'a1' })).toEqual(later);
  });
});
