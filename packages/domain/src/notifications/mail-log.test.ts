import { describe, expect, it } from 'vitest';
import { mailMessageRecord, type MailMessageRecord } from './mail.js';
import { mailLogBounds, mailLogCursor, mailLogIndex, mailLogQuerySchema, matchesMailLog, parseMailLogCursor } from './mail-log.js';

const record = (over: Partial<MailMessageRecord> = {}): MailMessageRecord => ({
  ...mailMessageRecord({
    messageId: 'm1',
    kind: 'broadcast',
    ref: 'b1',
    electionId: null,
    accountId: 'a1',
    causedBy: 'admin-1',
    delivery: 'mail',
    at: '2026-11-08T10:00:00.000Z',
  }),
  ...over,
});

describe('the email log query', () => {
  it('takes every filter, and none', () => {
    expect(mailLogQuerySchema.parse({})).toEqual({});
    expect(mailLogQuerySchema.parse({ account: 'a1', causedBy: 'system', kind: 'voting_open', status: 'bounced', from: '2026-11-01', to: '2026-11-08' })).toMatchObject({
      kind: 'voting_open',
    });
  });

  it('refuses unknown kinds, bad days and a range the wrong way round', () => {
    expect(mailLogQuerySchema.safeParse({ kind: 'spam' }).success).toBe(false);
    expect(mailLogQuerySchema.safeParse({ from: '8 Nov' }).success).toBe(false);
    expect(mailLogQuerySchema.safeParse({ from: '2026-11-08', to: '2026-11-01' }).success).toBe(false);
    expect(mailLogQuerySchema.safeParse({ other: 1 }).success).toBe(false);
  });

  it('reads by the most selective filter given', () => {
    expect(mailLogIndex({ account: 'a1', kind: 'welcome', status: 'sent' })).toBe('accountId');
    expect(mailLogIndex({ causedBy: 'x', kind: 'welcome' })).toBe('causedBy');
    expect(mailLogIndex({ kind: 'welcome', status: 'sent' })).toBe('kind');
    expect(mailLogIndex({ status: 'sent' })).toBe('status');
    expect(mailLogIndex({})).toBeNull();
  });
});

describe('matching a record', () => {
  it('applies each filter', () => {
    expect(matchesMailLog(record(), {})).toBe(true);
    expect(matchesMailLog(record(), { account: 'a1', causedBy: 'admin-1', kind: 'broadcast', status: 'sent' })).toBe(true);
    expect(matchesMailLog(record(), { account: 'a2' })).toBe(false);
    expect(matchesMailLog(record(), { causedBy: 'system' })).toBe(false);
    expect(matchesMailLog(record(), { kind: 'welcome' })).toBe(false);
    expect(matchesMailLog(record(), { status: 'delivered' })).toBe(false);
  });

  it('treats a record made before causes were kept as caused by nobody known', () => {
    const { causedBy: _causedBy, ...old } = record();
    expect(matchesMailLog(old as MailMessageRecord, { causedBy: 'admin-1' })).toBe(false);
    expect(matchesMailLog(old as MailMessageRecord, {})).toBe(true);
  });

  it('counts both days of the range in full, in UTC', () => {
    expect(mailLogBounds({ from: '2026-11-08', to: '2026-11-08' })).toEqual(['2026-11-08T00:00:00.000Z', '2026-11-09T00:00:00.000Z']);
    expect(matchesMailLog(record({ sentAt: '2026-11-08T23:59:59.999Z' }), { from: '2026-11-08', to: '2026-11-08' })).toBe(true);
    expect(matchesMailLog(record({ sentAt: '2026-11-09T00:00:00.000Z' }), { to: '2026-11-08' })).toBe(false);
    expect(matchesMailLog(record({ sentAt: '2026-11-07T23:59:59.999Z' }), { from: '2026-11-08' })).toBe(false);
  });
});

describe('the cursor', () => {
  it('round-trips, and refuses what it did not make', () => {
    const cursor = mailLogCursor(record());
    expect(parseMailLogCursor(cursor)).toEqual({ sentAt: '2026-11-08T10:00:00.000Z', messageId: 'm1' });
    expect(parseMailLogCursor('nonsense')).toBeNull();
    expect(parseMailLogCursor('yesterday|m1')).toBeNull();
    expect(parseMailLogCursor('2026-11-08T10:00:00.000Z|')).toBeNull();
  });

  it('keeps a message ID that has a bar in it', () => {
    expect(parseMailLogCursor('2026-11-08T10:00:00.000Z|a|b')).toEqual({ sentAt: '2026-11-08T10:00:00.000Z', messageId: 'a|b' });
  });
});
