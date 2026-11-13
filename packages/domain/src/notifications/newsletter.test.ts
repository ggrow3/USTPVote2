import { describe, expect, it } from 'vitest';
import {
  audienceHasSubscribers,
  broadcastAudienceSchema,
  broadcastRecipientKey,
  broadcastTotal,
  inBroadcastAudience,
} from './broadcasts.js';
import { newsletterConfirmMessage, newsletterMessage } from './message.js';
import {
  checkNewsletterLimits,
  isNewsletterTrapped,
  NEWSLETTER_PENDING_DAYS,
  NEWSLETTER_RESEND_MINUTES,
  NEWSLETTER_SIGNUPS_PER_DAY,
  NEWSLETTER_SIGNUPS_PER_SENDER_PER_DAY,
  newsletterConfirmLink,
  newsletterExpiry,
  newsletterSignup,
  newsletterSignupSchema,
  type NewsletterSubscriberRecord,
} from './newsletter.js';

const at = new Date('2026-11-12T12:00:00.000Z');
const input = newsletterSignupSchema.parse({ email: 'Ada@Example.org', name: 'Ada' });

function pending(over: Partial<NewsletterSubscriberRecord> = {}): NewsletterSubscriberRecord {
  const step = newsletterSignup({ current: null, input, subscriberId: 's1', addressKey: 'k1', at });
  if (step.kind !== 'create') throw new Error('expected a new record');
  return { ...step.record, ...over };
}

describe('newsletter sign-up', () => {
  it('takes an address and an optional one-line name, and a trap field people leave empty', () => {
    expect(newsletterSignupSchema.parse({ email: ' a@b.org ' })).toEqual({ email: 'a@b.org', name: '', website: '' });
    expect(newsletterSignupSchema.safeParse({ email: 'not an address' }).success).toBe(false);
    expect(newsletterSignupSchema.safeParse({ email: 'a@b.org', name: 'two\nlines' }).success).toBe(false);
    expect(newsletterSignupSchema.safeParse({ email: 'a@b.org', extra: 1 }).success).toBe(false);
    expect(isNewsletterTrapped({ website: '' })).toBe(false);
    expect(isNewsletterTrapped({ website: 'https://spam.example' })).toBe(true);
  });

  it('makes a new address wait for confirmation, with a confirmation due', () => {
    const record = pending();
    expect(record).toMatchObject({
      subscriberId: 's1',
      email: 'ada@example.org',
      addressKey: 'k1',
      name: 'Ada',
      status: 'pending',
      confirmDue: true,
      confirmAttempts: 0,
      confirmedAt: null,
      confirmTokenHash: null,
      unsubscribeToken: null,
    });
    expect(newsletterExpiry(record).toISOString()).toBe(new Date(at.getTime() + NEWSLETTER_PENDING_DAYS * 86_400_000).toISOString());
  });

  it('sends another link to one waiting only after an hour, and nothing to a confirmed address', () => {
    const waiting = pending({ confirmDue: false, confirmAttempts: 1 });
    const soon = new Date(at.getTime() + (NEWSLETTER_RESEND_MINUTES - 1) * 60_000);
    const later = new Date(at.getTime() + NEWSLETTER_RESEND_MINUTES * 60_000);
    expect(newsletterSignup({ current: waiting, input, subscriberId: 's2', addressKey: 'k1', at: soon }).kind).toBe('none');
    const again = newsletterSignup({ current: waiting, input: { ...input, name: '' }, subscriberId: 's2', addressKey: 'k1', at: later });
    expect(again).toMatchObject({ kind: 'resend', record: { subscriberId: 's1', confirmDue: true, confirmAttempts: 0, name: 'Ada', confirmRequestedAt: later.toISOString() } });
    const confirmed = pending({ status: 'confirmed', confirmDue: false, confirmedAt: at.toISOString() });
    expect(newsletterSignup({ current: confirmed, input, subscriberId: 's2', addressKey: 'k1', at: later }).kind).toBe('none');
  });

  it('holds each sender and the whole site to a day’s sign-ups', () => {
    expect(checkNewsletterLimits(null, 'x').ok).toBe(true);
    expect(checkNewsletterLimits({ total: 3, senders: { x: NEWSLETTER_SIGNUPS_PER_SENDER_PER_DAY - 1 } }, 'x').ok).toBe(true);
    expect(checkNewsletterLimits({ total: 3, senders: { x: NEWSLETTER_SIGNUPS_PER_SENDER_PER_DAY } }, 'x')).toMatchObject({ ok: false, refusal: 'rate_limited' });
    expect(checkNewsletterLimits({ total: NEWSLETTER_SIGNUPS_PER_DAY, senders: {} }, 'y')).toMatchObject({ ok: false, refusal: 'rate_limited' });
  });

  it('puts the token in the confirmation page’s query, as page visits record only the path', () => {
    expect(newsletterConfirmLink('https://vote.example', 'a+b/c')).toBe('https://vote.example/newsletter/confirm?token=a%2Bb%2Fc');
  });
});

describe('the newsletter’s emails', () => {
  it('confirms with a link, and says what happens if it was not them', () => {
    const m = newsletterConfirmMessage({ origin: 'https://vote.example', name: 'Ada <b>', contact: 'help@example.org', confirm: 'https://vote.example/newsletter/confirm?token=t', pendingDays: 7 });
    expect(m.subject).toContain('Confirm');
    expect(m.text).toContain('Hello Ada <b>,');
    expect(m.text).toContain('To get it, open the confirmation page, https://vote.example/newsletter/confirm?token=t, and press Confirm there.');
    expect(m.text).toContain('within 7 days');
    expect(m.html).toContain('Ada &lt;b&gt;');
    expect(m.text).not.toContain('Unsubscribe');
  });

  it('gives a subscriber the words, why they get it and their own link off the list', () => {
    const m = newsletterMessage({ origin: 'https://vote.example', name: null, contact: 'help@example.org', subject: 'News', body: 'One.\n\nTwo.', unsubscribe: 'https://vote.example/unsubscribe?token=u' });
    expect(m.text).toContain('Hello,');
    expect(m.text).toContain('One.\n\nTwo.');
    expect(m.text).toContain('signed up for the US Transhumanist Party');
    expect(m.text).toContain('Leave the newsletter (your address is deleted, and nothing more comes): https://vote.example/unsubscribe?token=u');
    expect(m.text).not.toContain('chose to get news and announcements');
  });
});

describe('emails to the newsletter’s subscribers', () => {
  const active = { accountId: 'a', status: 'active' as const, country: 'US', state: 'CA', communications: { newsletter: 'x', announcements: null } };

  it('take subscribers alone, or with all Active members, never with a place or a hand-picked list', () => {
    expect(broadcastAudienceSchema.safeParse({ kind: 'subscribers' }).success).toBe(true);
    expect(broadcastAudienceSchema.safeParse({ kind: 'all_active', withSubscribers: true }).success).toBe(true);
    expect(broadcastAudienceSchema.safeParse({ kind: 'place', countries: ['US'], states: [], withSubscribers: true }).success).toBe(false);
    expect(audienceHasSubscribers({ kind: 'subscribers' })).toBe(true);
    expect(audienceHasSubscribers({ kind: 'all_active', withSubscribers: true })).toBe(true);
    expect(audienceHasSubscribers({ kind: 'all_active' })).toBe(false);
    expect(inBroadcastAudience({ kind: 'subscribers' }, active)).toBe(false);
    expect(inBroadcastAudience({ kind: 'all_active', withSubscribers: true }, active)).toBe(true);
  });

  it('count members and subscribers together, and key each copy apart', () => {
    const skipped = { email_stopped: 0, unsubscribed: 0, not_opted_in: 0, no_address: 0, unverified: 0, undeliverable: 0 };
    expect(broadcastTotal({ willGet: 3 })).toBe(3);
    expect(broadcastTotal({ willGet: 3, subscribers: { listed: 5, willGet: 4, skipped: { member_copy: 1, stopped: 0, undeliverable: 0 } } })).toBe(7);
    expect(broadcastTotal({ willGet: 0, subscribers: null, ...{ matched: 0, skipped } })).toBe(0);
    expect(broadcastRecipientKey({ accountId: 'acc', subscriberId: null })).toBe('acc');
    expect(broadcastRecipientKey({ accountId: null, subscriberId: 'sub' })).toBe('s-sub');
  });
});
