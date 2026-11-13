import { describe, expect, it } from 'vitest';
import { addDays, isTimeZone, mailDayQuerySchema, mailDaysQuerySchema, tallyMailDay, zoneDay, zoneDayBounds, zoneDayStart, type MailDayRecord } from './mail-days.js';
import { mailLogBounds, mailLogQuerySchema } from './mail-log.js';

describe('days in a time zone', () => {
  it('begins a day at its midnight there', () => {
    expect(zoneDayStart('2026-11-09', 'UTC')).toBe('2026-11-09T00:00:00.000Z');
    expect(zoneDayStart('2026-11-09', 'America/New_York')).toBe('2026-11-09T05:00:00.000Z');
    expect(zoneDayStart('2026-07-04', 'America/New_York')).toBe('2026-07-04T04:00:00.000Z');
    expect(zoneDayStart('2026-11-09', 'Asia/Kolkata')).toBe('2026-11-08T18:30:00.000Z');
    expect(zoneDayStart('2026-11-09', 'Pacific/Auckland')).toBe('2026-11-08T11:00:00.000Z');
  });

  it('gives a day the clocks change on its true length', () => {
    // New York's clocks went back an hour on 1 November 2026, and forward on 8 March.
    expect(zoneDayBounds('2026-11-01', 'America/New_York')).toEqual({ start: '2026-11-01T04:00:00.000Z', end: '2026-11-02T05:00:00.000Z' });
    expect(zoneDayBounds('2026-03-08', 'America/New_York')).toEqual({ start: '2026-03-08T05:00:00.000Z', end: '2026-03-09T04:00:00.000Z' });
  });

  it('finds the day an instant falls on there', () => {
    const late = new Date('2026-11-09T03:30:00.000Z');
    expect(zoneDay(late, 'UTC')).toBe('2026-11-09');
    expect(zoneDay(late, 'America/Los_Angeles')).toBe('2026-11-08');
    expect(zoneDay(new Date('2026-11-09T12:00:00.000Z'), 'Pacific/Kiritimati')).toBe('2026-11-10');
  });

  it('counts days across months and years', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('knows a time zone from a made-up one', () => {
    expect(isTimeZone('America/New_York')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});

describe('the queries', () => {
  it('takes the last 30 days in UTC by default, and up to 90', () => {
    expect(mailDaysQuerySchema.parse({})).toEqual({ days: 30, tz: 'UTC' });
    expect(mailDaysQuerySchema.parse({ days: '7', tz: 'America/Chicago' })).toEqual({ days: 7, tz: 'America/Chicago' });
    expect(mailDaysQuerySchema.safeParse({ days: '91' }).success).toBe(false);
    expect(mailDaysQuerySchema.safeParse({ days: '0' }).success).toBe(false);
    expect(mailDaysQuerySchema.safeParse({ tz: 'Nowhere/At_All' }).success).toBe(false);
  });

  it('takes one day that exists', () => {
    expect(mailDayQuerySchema.parse({ day: '2026-11-09' })).toEqual({ day: '2026-11-09', tz: 'UTC' });
    expect(mailDayQuerySchema.safeParse({ day: '2026-02-30' }).success).toBe(false);
    expect(mailDayQuerySchema.safeParse({ day: '9 Nov' }).success).toBe(false);
    expect(mailDayQuerySchema.safeParse({}).success).toBe(false);
    expect(mailDayQuerySchema.safeParse({ day: '2026-11-09', other: 1 }).success).toBe(false);
  });

  it('reads the email log’s days in the time zone given', () => {
    expect(mailLogBounds({ from: '2026-11-09', to: '2026-11-09' })).toEqual(['2026-11-09T00:00:00.000Z', '2026-11-10T00:00:00.000Z']);
    expect(mailLogBounds({ from: '2026-11-09', to: '2026-11-09', tz: 'America/New_York' })).toEqual(['2026-11-09T05:00:00.000Z', '2026-11-10T05:00:00.000Z']);
    expect(mailLogQuerySchema.safeParse({ tz: 'Nowhere/At_All' }).success).toBe(false);
  });
});

describe('a day’s tally', () => {
  const r = (accountId: string | null, to: string | null, kind: MailDayRecord['kind'], status: MailDayRecord['status']): MailDayRecord => ({ accountId, to, kind, status });

  it('counts each person’s emails, by kind and what became of them, those sent the most first', () => {
    const tally = tallyMailDay([
      r('ada', 'ada@example.test', 'broadcast', 'delivered'),
      r('ada', 'ada@example.test', 'voting_open', 'delivered'),
      r('ada', 'Ada@Example.test', 'voting_open', 'bounced'),
      r('ben', 'ben@example.test', 'broadcast', 'sent'),
      r(null, 'stranger@example.test', 'sign_in_link', 'delayed'),
      r(null, 'success@simulator.amazonses.com', 'probe', 'delivered'),
    ]);
    expect(tally.addresses).toBe(4);
    expect(tally.byKind).toEqual([
      { kind: 'broadcast', count: 2 },
      { kind: 'voting_open', count: 2 },
      { kind: 'probe', count: 1 },
      { kind: 'sign_in_link', count: 1 },
    ]);
    expect(tally.byStatus).toEqual([
      { status: 'delivered', count: 3 },
      { status: 'bounced', count: 1 },
      { status: 'delayed', count: 1 },
      { status: 'sent', count: 1 },
    ]);
    expect(tally.people[0]).toEqual({
      accountId: 'ada',
      addresses: ['Ada@Example.test', 'ada@example.test'],
      emails: 3,
      delivered: 2,
      waiting: 0,
      problems: 1,
      kinds: [
        { kind: 'voting_open', count: 2 },
        { kind: 'broadcast', count: 1 },
      ],
    });
    expect(tally.people.map((p) => p.accountId ?? p.addresses[0])).toEqual(['ada', 'ben', 'stranger@example.test', 'success@simulator.amazonses.com']);
    expect(tally.people[1]).toMatchObject({ emails: 1, waiting: 1, delivered: 0, problems: 0 });
  });

  it('keeps an account’s emails together when some were sent before addresses were kept', () => {
    const { people, addresses } = tallyMailDay([r('ada', null, 'welcome', 'delivered'), r('ada', 'ada@example.test', 'broadcast', 'delivered')]);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ accountId: 'ada', addresses: ['ada@example.test'], emails: 2 });
    expect(addresses).toBe(1);
  });

  it('puts the old records of addresses no account has together', () => {
    const { people } = tallyMailDay([r(null, null, 'sign_in_link', 'delivered'), r(null, null, 'password_reset', 'delivered')]);
    expect(people).toEqual([expect.objectContaining({ accountId: null, addresses: [], emails: 2 })]);
  });

  it('is empty on a day with no email', () => {
    expect(tallyMailDay([])).toEqual({ addresses: 0, byKind: [], byStatus: [], people: [] });
  });
});
