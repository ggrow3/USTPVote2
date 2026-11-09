import { describe, expect, it } from 'vitest';
import { broadcastAudienceSchema, broadcastAudienceSummary, broadcastMessage, broadcastSchema, broadcastSkip, hasOptedInToEmail, inBroadcastAudience, MAX_BROADCAST_PICKED, type BroadcastAudience } from '../index.js';

/** An email an admin writes to members (design §10.12). */

const AT = '2026-01-01T00:00:00.000Z';
const member = (over: Partial<Parameters<typeof inBroadcastAudience>[1]> = {}): Parameters<typeof inBroadcastAudience>[1] => ({
  accountId: 'a1',
  status: 'active',
  country: 'US',
  state: 'NY',
  communications: { newsletter: AT, announcements: null },
  ...over,
});

describe('who an audience takes in', () => {
  const place = (states: string[], countries: string[]): BroadcastAudience => ({ kind: 'place', states, countries });

  it('is Active members only, however they are chosen', () => {
    for (const audience of [{ kind: 'all_active' }, place(['NY'], []), { kind: 'picked', accountIds: ['a1'] }] as BroadcastAudience[]) {
      expect(inBroadcastAudience(audience, member())).toBe(true);
      for (const status of ['applicant', 'lapsed', 'suspended', 'resigned', 'rejected'] as const) expect(inBroadcastAudience(audience, member({ status }))).toBe(false);
    }
  });

  it('matches a state in the United States, or the country', () => {
    expect(inBroadcastAudience(place(['CA'], []), member())).toBe(false);
    expect(inBroadcastAudience(place([], ['US']), member())).toBe(true);
    // Records made before the country was asked are in the United States.
    expect(inBroadcastAudience(place(['NY'], []), member({ country: undefined }))).toBe(true);
    const abroad = member({ country: 'GB', state: null });
    expect(inBroadcastAudience(place(['NY'], []), abroad)).toBe(false);
    expect(inBroadcastAudience(place([], ['GB']), abroad)).toBe(true);
  });

  it('matches the members picked', () => {
    expect(inBroadcastAudience({ kind: 'picked', accountIds: ['a2'] }, member())).toBe(false);
  });

  it('refuses a choice of nowhere, a place that is not one, and too many picked', () => {
    expect(broadcastAudienceSchema.safeParse(place([], [])).success).toBe(false);
    expect(broadcastAudienceSchema.safeParse(place(['ZZ'], [])).success).toBe(false);
    expect(broadcastAudienceSchema.safeParse(place([], ['ZZ'])).success).toBe(false);
    expect(broadcastAudienceSchema.safeParse({ kind: 'picked', accountIds: [] }).success).toBe(false);
    expect(broadcastAudienceSchema.safeParse({ kind: 'picked', accountIds: Array(MAX_BROADCAST_PICKED + 1).fill('a') }).success).toBe(false);
    expect(broadcastAudienceSchema.safeParse({ kind: 'status', status: 'lapsed' }).success).toBe(false);
  });

  it('is summarized without the members picked', () => {
    expect(broadcastAudienceSummary({ kind: 'picked', accountIds: ['a1', 'a2'] })).toEqual({ kind: 'picked', count: 2 });
    expect(broadcastAudienceSummary(place(['NY'], []))).toEqual(place(['NY'], []));
  });
});

describe('who among them gets it', () => {
  const ok = { member: member(), mailbox: { email: 'a@example.org', verified: true }, stop: null, suppressed: false };

  it('takes either opt-in', () => {
    expect(hasOptedInToEmail(member())).toBe(true);
    expect(hasOptedInToEmail(member({ communications: { newsletter: null, announcements: AT } }))).toBe(true);
    expect(hasOptedInToEmail(member({ communications: { newsletter: null, announcements: null } }))).toBe(false);
    expect(hasOptedInToEmail(member({ communications: null }))).toBe(false);
  });

  it('gives the first reason not to, an admin’s stop or unsubscribing first', () => {
    expect(broadcastSkip(ok)).toBeNull();
    const none = member({ communications: null });
    expect(broadcastSkip({ ...ok, member: none, stop: 'email_stopped' })).toBe('email_stopped');
    expect(broadcastSkip({ ...ok, member: none, stop: 'unsubscribed' })).toBe('unsubscribed');
    expect(broadcastSkip({ ...ok, member: none })).toBe('not_opted_in');
    expect(broadcastSkip({ ...ok, mailbox: undefined })).toBe('no_address');
    expect(broadcastSkip({ ...ok, mailbox: { email: null, verified: false } })).toBe('no_address');
    expect(broadcastSkip({ ...ok, mailbox: { email: 'a@example.org', verified: false } })).toBe('unverified');
    expect(broadcastSkip({ ...ok, suppressed: true })).toBe('undeliverable');
  });
});

describe('the email', () => {
  const input = { origin: 'https://vote.example.org', name: 'Ada', contact: 'elections@example.org', subject: 'News', body: 'First.\n\nSecond.', unsubscribe: 'https://vote.example.org/unsubscribe?token=t' };

  it('needs a one-line subject and some words', () => {
    const audience = { kind: 'all_active' };
    expect(broadcastSchema.safeParse({ subject: 'News', body: 'Hi', audience }).success).toBe(true);
    expect(broadcastSchema.safeParse({ subject: '  ', body: 'Hi', audience }).success).toBe(false);
    expect(broadcastSchema.safeParse({ subject: 'a\nb', body: 'Hi', audience }).success).toBe(false);
    expect(broadcastSchema.safeParse({ subject: 'News', body: ' ', audience }).success).toBe(false);
  });

  it('greets the member, keeps the paragraphs, and ends with the contact and their link', () => {
    const { subject, text, html } = broadcastMessage(input);
    expect(subject).toBe('News');
    expect(text.startsWith('Hello Ada,\n\nFirst.\n\nSecond.\n\n--')).toBe(true);
    expect(text).toContain('Questions about this email? Replies to this email are not read; write to elections@example.org.');
    expect(text).toContain(`Unsubscribe from all email from the party: ${input.unsubscribe}`);
    expect(text).toContain('you chose to get news and announcements');
    expect(html).toContain('<p>First.</p>');
    expect(html).toContain(`<a href="${input.unsubscribe.replace(/&/g, '&amp;')}"`);
  });

  it('escapes what the admin wrote, and keeps a subject to one line', () => {
    const { subject, html } = broadcastMessage({ ...input, subject: 'a\r\nb <i>', body: '<img src=x onerror=y> & more' });
    expect(subject).toBe('a b <i>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=y&gt; &amp; more');
    expect(html).toContain('<title>a b &lt;i&gt;</title>');
  });
});
