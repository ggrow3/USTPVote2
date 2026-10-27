import { describe, expect, it } from 'vitest';
import {
  checkNoticeResend,
  isClaimable,
  isNoticeKind,
  isStaleClaim,
  isVotingOpen,
  noticeDelivery,
  noticeId,
  noticeSummary,
  RECIPIENT_STATUSES,
  votingOpenMessage,
  votingWindow,
  zoneTime,
  type NoticeRecipientRecord,
  type NoticeRecord,
  type RecipientStatus,
} from '../index.js';

const ELECTION = {
  electionId: '0192f1c2-7a3b-7c4d-8e5f-001122334455',
  title: 'Officers 2026',
  description: 'Choose the chair.\n\nAnd vote on plank 12.',
  opensAt: '2026-11-02T14:00:00.000Z',
  closesAt: '2026-11-07T04:59:00.000Z',
};
const ORIGIN = 'https://vote.example.org';

describe('votingOpenMessage', () => {
  const message = votingOpenMessage({ election: ELECTION, origin: ORIGIN, name: 'Alex Rivera' });

  it('names the election in the subject and greets the member', () => {
    expect(message.subject).toBe('Voting is open: Officers 2026');
    expect(message.text.startsWith('Hello Alex Rivera,\n\n')).toBe(true);
    expect(votingOpenMessage({ election: ELECTION, origin: ORIGIN, name: null }).text.startsWith('Hello,\n\n')).toBe(true);
  });

  it('links the ballot, the calendar event and the Verify page, by what they open', () => {
    const ballot = `${ORIGIN}/ballot/${ELECTION.electionId}`;
    const calendar = `${ORIGIN}/v1/public/elections/${ELECTION.electionId}/calendar.ics`;
    for (const body of [message.text, message.html]) {
      expect(body).toContain(ballot);
      expect(body).toContain(calendar);
      expect(body).toContain(`${ORIGIN}/verify`);
    }
    expect(message.html).toContain(`<a href="${ballot}" style="color:#bd4e00">Open your ballot for “Officers 2026”</a>`);
    expect(message.html).toContain(`<a href="${calendar}" style="color:#bd4e00">Add the voting window to your calendar</a>`);
    expect(message.html).toContain('<a href="https://vote.example.org/verify" style="color:#bd4e00">open the Verify page</a>');
  });

  it('gives the window in every zone, Eastern first, with the deadline up front', () => {
    expect(message.text).toContain('Vote by Friday, November 6, 2026, 11:59 PM EST (Eastern Time).');
    expect(message.text).toContain('- Eastern Time: Monday, November 2, 2026, 9:00 AM EST to Friday, November 6, 2026, 11:59 PM EST');
    expect(message.text).toContain('- Pacific Time: Monday, November 2, 2026, 6:00 AM PST to Friday, November 6, 2026, 8:59 PM PST');
    expect(message.text).toContain('- Hawaii Time: Monday, November 2, 2026, 4:00 AM HST to Friday, November 6, 2026, 6:59 PM HST');
    expect(message.text).toContain('- UTC: Monday, November 2, 2026, 14:00 UTC to Saturday, November 7, 2026, 04:59 UTC');
    expect(message.html).toContain('<th scope="col"');
    expect(message.html).toContain('<th scope="row" style="text-align:left;padding:4px 12px 4px 0;font-weight:normal">Alaska Time</th>');
  });

  it('is accessible HTML: a language, a title, real text and headings, no images', () => {
    expect(message.html).toMatch(/^<!DOCTYPE html>\n<html lang="en">/);
    expect(message.html).toContain('<title>Voting is open: Officers 2026</title>');
    expect(message.html).toContain('<h1');
    expect(message.html).not.toMatch(/<img|background-image/);
  });

  it('carries the description as paragraphs and says how to check a vote', () => {
    expect(message.text).toContain('About this election\n\nChoose the chair.\n\nAnd vote on plank 12.');
    expect(message.html).toContain('<p>Choose the chair.</p>\n<p>And vote on plank 12.</p>');
    expect(message.text).toContain('keep it to yourself: it shows how you voted');
    expect(votingOpenMessage({ election: { ...ELECTION, description: '  ' }, origin: ORIGIN, name: null }).text).not.toContain('About this election');
  });

  it('escapes what admins and members typed, and keeps the subject to one line', () => {
    const hostile = votingOpenMessage({
      election: { ...ELECTION, title: 'Chair\r\nBcc: everyone@example.org <script>', description: '<img src=x onerror=alert(1)>' },
      origin: ORIGIN,
      name: 'Eve "<b>"',
    });
    expect(hostile.subject).toBe('Voting is open: Chair Bcc: everyone@example.org <script>');
    expect(hostile.subject).not.toMatch(/[\r\n]/);
    expect(hostile.html).not.toContain('<script>');
    expect(hostile.html).not.toContain('<img');
    expect(hostile.html).not.toContain('<b>');
    expect(hostile.html).toContain('Chair Bcc: everyone@example.org &lt;script&gt;');
    expect(hostile.html).toContain('Hello Eve &quot;&lt;b&gt;&quot;,');
    expect(hostile.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('shortens a very long title in the subject only', () => {
    const long = votingOpenMessage({ election: { ...ELECTION, title: 'x'.repeat(200) }, origin: ORIGIN, name: null });
    expect(long.subject).toBe(`Voting is open: ${'x'.repeat(149)}…`);
    expect(long.text).toContain('x'.repeat(200));
  });

  it('encodes the election ID in links', () => {
    const odd = votingOpenMessage({ election: { ...ELECTION, electionId: 'a/b c' }, origin: ORIGIN, name: null });
    expect(odd.text).toContain(`${ORIGIN}/ballot/a%2Fb%20c`);
  });
});

describe('zoneTime and votingWindow', () => {
  it('names daylight time and standard time by their abbreviations', () => {
    expect(zoneTime('2026-07-01T16:00:00Z', 'America/New_York')).toBe('Wednesday, July 1, 2026, 12:00 PM EDT');
    expect(zoneTime('2026-07-01T16:00:00Z', 'America/Los_Angeles')).toBe('Wednesday, July 1, 2026, 9:00 AM PDT');
    expect(zoneTime('2026-12-01T05:00:00Z', 'America/New_York')).toBe('Tuesday, December 1, 2026, 12:00 AM EST');
  });

  it('gives UTC on the 24-hour clock', () => {
    expect(zoneTime('2026-11-07T04:59:00Z', 'UTC')).toBe('Saturday, November 7, 2026, 04:59 UTC');
    expect(zoneTime('2026-11-07T00:00:00Z', 'UTC')).toBe('Saturday, November 7, 2026, 00:00 UTC');
  });

  it('has one row per zone, Eastern first and UTC last', () => {
    const rows = votingWindow(ELECTION.opensAt, ELECTION.closesAt);
    expect(rows.map((r) => r.name)).toEqual([
      'Eastern Time',
      'Central Time',
      'Mountain Time',
      'Pacific Time',
      'Alaska Time',
      'Hawaii Time',
      'UTC',
    ]);
  });
});

describe('sending each recipient once', () => {
  const recipient = (status: RecipientStatus, round = 1, claimedAt: string | null = null): NoticeRecipientRecord => ({
    accountId: 'a1',
    status,
    round,
    attempts: 1,
    claimedAt,
    sentAt: null,
    messageId: null,
    outcome: null,
    updatedAt: '2026-11-02T14:00:00.000Z',
  });

  it('lets a worker claim only what is still to send, or what an earlier round failed', () => {
    const claimable = (round: number) => RECIPIENT_STATUSES.filter((s) => isClaimable(recipient(s, 1), round));
    expect(claimable(1)).toEqual(['pending']);
    expect(claimable(2)).toEqual(['pending', 'failed']);
    // A failure in the current round waits for an Election Admin's resend.
    expect(isClaimable(recipient('failed', 2), 2)).toBe(false);
  });

  it('never lets a second worker claim one the first has claimed', () => {
    const first = recipient('pending');
    expect(isClaimable(first, 1)).toBe(true);
    const claimed = { ...first, status: 'sending' as const, claimedAt: '2026-11-02T14:00:00.000Z' };
    expect(isClaimable(claimed, 1)).toBe(false);
    expect(isClaimable(claimed, 2)).toBe(false);
    expect(isClaimable({ ...claimed, status: 'sent' }, 2)).toBe(false);
  });

  it('treats a claim as interrupted only after the claim limit', () => {
    const now = new Date('2026-11-02T14:10:00.000Z');
    expect(isStaleClaim(recipient('sending', 1, '2026-11-02T14:06:00.000Z'), now)).toBe(false);
    expect(isStaleClaim(recipient('sending', 1, '2026-11-02T14:05:00.000Z'), now)).toBe(true);
    expect(isStaleClaim(recipient('sending', 1, null), now)).toBe(true);
    expect(isStaleClaim(recipient('sent', 1, '2026-11-02T14:00:00.000Z'), now)).toBe(false);
  });
});

describe('notice rules', () => {
  const now = new Date('2026-11-03T12:00:00.000Z');
  const open = { state: 'open' as const, closesAt: ELECTION.closesAt };

  it('sends real members mail where it is set up, and a rehearsal to the outbox only in testing mode', () => {
    expect(noticeDelivery({ rehearsal: false, testingMode: false, transport: 'mail' })).toBe('mail');
    expect(noticeDelivery({ rehearsal: false, testingMode: true, transport: 'outbox' })).toBe('outbox');
    expect(noticeDelivery({ rehearsal: false, testingMode: false, transport: 'none' })).toBeNull();
    expect(noticeDelivery({ rehearsal: true, testingMode: false, transport: 'mail' })).toBeNull();
    expect(noticeDelivery({ rehearsal: true, testingMode: true, transport: 'mail' })).toBe('outbox');
    expect(noticeDelivery({ rehearsal: true, testingMode: true, transport: 'none' })).toBe('outbox');
  });

  it('knows when voting is open', () => {
    expect(isVotingOpen(open, now)).toBe(true);
    expect(isVotingOpen({ ...open, closesAt: '2026-11-03T12:00:00.000Z' }, now)).toBe(false);
    expect(isVotingOpen({ ...open, state: 'scheduled' }, now)).toBe(false);
  });

  it('allows a resend only while voting is open, after the round, when it failed for someone', () => {
    expect(checkNoticeResend(open, { status: 'done' }, 2, now)).toEqual({ ok: true });
    expect(checkNoticeResend(open, null, 0, now)).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(checkNoticeResend(open, { status: 'sending' }, 2, now)).toMatchObject({ ok: false, reason: expect.stringContaining('still being sent') });
    expect(checkNoticeResend(open, { status: 'done' }, 0, now)).toMatchObject({ ok: false, reason: expect.stringContaining('nothing to resend') });
    expect(checkNoticeResend({ ...open, state: 'closed' }, { status: 'done' }, 2, now)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not open'),
    });
  });

  it('names notices by election and kind, and summarises them as counts', () => {
    expect(noticeId('e1', 'voting_open')).toBe('e1_voting_open');
    expect(isNoticeKind('voting_open')).toBe(true);
    expect(isNoticeKind('closing_soon')).toBe(false);
    const record: NoticeRecord = {
      noticeId: 'e1_voting_open',
      electionId: 'e1',
      kind: 'voting_open',
      delivery: 'mail',
      rehearsal: false,
      recipients: 3,
      status: 'done',
      round: 1,
      roundRequestedBy: 'system',
      createdAt: '2026-11-02T14:00:00.000Z',
      roundStartedAt: '2026-11-02T14:00:00.000Z',
      completedAt: '2026-11-02T14:01:00.000Z',
    };
    const counts = { pending: 0, sent: 2, failed: 1, bounced: 0, skipped: 0 };
    expect(noticeSummary(record, counts)).toEqual({
      kind: 'voting_open',
      delivery: 'mail',
      rehearsal: false,
      status: 'done',
      round: 1,
      recipients: 3,
      counts,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
    });
  });
});
