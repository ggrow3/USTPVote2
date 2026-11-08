import { describe, expect, it } from 'vitest';
import type { BroadcastCounts, BroadcastPreview } from 'ustp-domain';
import { approvalText, audienceText, broadcastStatusText, previewText } from './broadcast-text.js';

const NONE = { email_stopped: 0, unsubscribed: 0, not_opted_in: 0, no_address: 0, unverified: 0, undeliverable: 0 };
const counts = (over: Partial<BroadcastCounts> = {}): BroadcastCounts => ({ pending: 0, sent: 0, skipped: 0, failed: 0, delivered: 0, bounced: 0, complained: 0, ...over });
const status = (s: 'preparing' | 'sending' | 'done' | 'cancelled', c: Partial<BroadcastCounts> = {}, held: object | null = null) =>
  broadcastStatusText({ status: s, counts: counts(c), held: held as never, preview: null, completedAt: null, approval: null });

describe('who an email comes to', () => {
  it('says how many get it, and why the rest do not', () => {
    const preview: BroadcastPreview = { matched: 55, willGet: 40, skipped: { ...NONE, not_opted_in: 12, unsubscribed: 3 } };
    expect(previewText(preview)).toBe('Goes to 40 of the 55 members chosen. Left out: 12 did not opt in, 3 unsubscribed.');
    expect(previewText({ matched: 1, willGet: 1, skipped: NONE })).toBe('Goes to 1 of the 1 member chosen.');
    expect(previewText({ matched: 0, willGet: 0, skipped: NONE })).toBe('That choice takes in no Active members.');
  });

  it('names places, and never the members picked', () => {
    expect(audienceText({ kind: 'all_active' })).toBe('To all Active members who opted in');
    expect(audienceText({ kind: 'place', states: ['NY'], countries: ['CA'] })).toBe('To Active members who opted in, in New York (NY), Canada');
    expect(audienceText({ kind: 'picked', count: 2 })).toBe('To 2 members picked by hand, those who opted in');
  });
});

describe('where an email stands', () => {
  it('follows it from starting to finished', () => {
    expect(status('preparing')).toBe('Starting within a minute.');
    expect(status('sending', { sent: 10, pending: 30, delivered: 8 })).toBe('Sending: 10 sent, 30 to go. 8 delivered.');
    expect(status('done', { sent: 40, delivered: 38, bounced: 1, complained: 1 })).toBe('Sent to 40 members. 38 delivered, 1 bounced, 1 marked as spam.');
    expect(status('done', { sent: 1 })).toBe('Sent to 1 member.');
  });

  it('says what was stopped, held or skipped', () => {
    expect(status('cancelled', { sent: 10, pending: 30 })).toBe('Stopped: 10 sent, 30 not sent.');
    expect(status('sending', { sent: 10, pending: 30 }, { checks: ['dkim'], since: 'x' })).toBe('Held: nothing more goes while the email setup check fails. 10 sent so far.');
    expect(status('done', { sent: 2, skipped: 1, failed: 1 })).toBe('Sent to 2 members. 1 could not be sent, 1 skipped, as they had stopped email since.');
  });
});

describe('an email that needs approval', () => {
  const decided = (status: 'approved' | 'rejected', reason: string | null = null) => ({
    status,
    decidedByName: 'Sam Admin',
    decidedAt: '2026-11-08T10:00:00.000Z',
    reason,
  });

  it('says it waits, and who decided', () => {
    const base = { counts: counts(), held: null, preview: null, completedAt: null };
    expect(broadcastStatusText({ ...base, status: 'awaiting_approval', approval: { status: 'waiting', decidedByName: null, decidedAt: null, reason: null } })).toBe(
      'Waiting for a System Admin’s approval. Nothing has gone.',
    );
    expect(broadcastStatusText({ ...base, status: 'rejected', approval: decided('rejected', 'not now') })).toBe('Not approved by Sam Admin: “not now”. Nobody got it.');
    expect(approvalText({ approval: decided('approved') })).toMatch(/^Approved by Sam Admin on /);
    expect(approvalText({ approval: null })).toBeNull();
    expect(approvalText({ approval: decided('rejected', 'x') })).toBeNull();
  });
});
