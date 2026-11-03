import { describe, expect, it } from 'vitest';
import {
  checkNoticeResend,
  closingSoonMessage,
  DEFAULT_NOTICE_SETTINGS,
  emailStepStatus,
  hasReminder,
  isClaimable,
  isNoticeKind,
  isReminderDue,
  isStaleClaim,
  isVotingOpen,
  NOTICE_CONTACT_PLACEHOLDER,
  noticeDelivery,
  noticeId,
  noticeMessage,
  noticeReceiptTotals,
  noticeSteps,
  noticeSummary,
  RECIPIENT_STATUSES,
  reminderTime,
  timeLeft,
  votedMessage,
  votingOpenMessage,
  votingWindow,
  zoneTime,
  type NoticeMessageInput,
  type NoticeRecipientRecord,
  type NoticeRecord,
  type NoticeSettings,
  type NoticesView,
  type NoticeSummary,
  type RecipientStatus,
  type StepStatus,
} from '../index.js';

const ELECTION = {
  electionId: '0192f1c2-7a3b-7c4d-8e5f-001122334455',
  title: 'Officers 2026',
  description: 'Choose the chair.\n\nAnd vote on plank 12.',
  opensAt: '2026-11-02T14:00:00.000Z',
  closesAt: '2026-11-07T04:59:00.000Z',
};
const ORIGIN = 'https://vote.example.org';
const input = (over: Partial<NoticeMessageInput> = {}): NoticeMessageInput => ({
  election: ELECTION,
  origin: ORIGIN,
  name: 'Alex Rivera',
  contact: 'elections@example.org',
  now: new Date('2026-11-06T04:59:00.000Z'),
  ...over,
});

describe('votingOpenMessage', () => {
  const message = votingOpenMessage(input());

  it('names the election in the subject and greets the member', () => {
    expect(message.subject).toBe('Voting is open: Officers 2026');
    expect(message.text.startsWith('Hello Alex Rivera,\n\n')).toBe(true);
    expect(votingOpenMessage(input({ name: null })).text.startsWith('Hello,\n\n')).toBe(true);
  });

  it('links the ballot, the calendar event and the Verify page, by what they open', () => {
    const ballot = `${ORIGIN}/ballot/${ELECTION.electionId}`;
    const calendar = `${ORIGIN}/v1/public/elections/${ELECTION.electionId}/calendar.ics`;
    for (const body of [message.text, message.html]) {
      expect(body).toContain(ballot);
      expect(body).toContain(calendar);
      expect(body).toContain(`${ORIGIN}/verify`);
    }
    expect(message.text).toContain(`Open your ballot (you will be asked to sign in): ${ballot}`);
    expect(message.text).toContain(`Add the voting window to your calendar (an .ics file): ${calendar}`);
    expect(message.text).toContain(`Once voting has closed, open the Verify page, ${ORIGIN}/verify, and load the receipt.`);
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
    expect(votingOpenMessage(input({ election: { ...ELECTION, description: '  ' } })).text).not.toContain('About this election');
  });

  it('says replies are not read and where to ask, linking an address or a page', () => {
    expect(message.text).toContain('Questions about this election? Replies to this email are not read; write to elections@example.org.');
    expect(message.html).toContain('write to <a href="mailto:elections@example.org" style="color:#bd4e00">elections@example.org</a>.');
    const page = votingOpenMessage(input({ contact: 'https://transhumanist-party.org/contact/' }));
    expect(page.html).toContain('<a href="https://transhumanist-party.org/contact/" style="color:#bd4e00">');
    const unknown = votingOpenMessage(input({ contact: null }));
    expect(unknown.text).toContain(`write to ${NOTICE_CONTACT_PLACEHOLDER}.`);
    expect(unknown.html).toContain('write to [contact for election questions, to be confirmed].');
  });

  it('escapes what admins and members typed, and keeps the subject to one line', () => {
    const hostile = votingOpenMessage(
      input({
        election: { ...ELECTION, title: 'Chair\r\nBcc: everyone@example.org <script>', description: '<img src=x onerror=alert(1)>' },
        name: 'Eve "<b>"',
        contact: '<a href=x>@evil',
      }),
    );
    expect(hostile.subject).toBe('Voting is open: Chair Bcc: everyone@example.org <script>');
    expect(hostile.subject).not.toMatch(/[\r\n]/);
    expect(hostile.html).not.toContain('<script>');
    expect(hostile.html).not.toContain('<img');
    expect(hostile.html).not.toContain('<b>');
    expect(hostile.html).not.toContain('<a href=x>');
    expect(hostile.html).toContain('Chair Bcc: everyone@example.org &lt;script&gt;');
    expect(hostile.html).toContain('Hello Eve &quot;&lt;b&gt;&quot;,');
    expect(hostile.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('shortens a very long title in the subject only', () => {
    const long = votingOpenMessage(input({ election: { ...ELECTION, title: 'x'.repeat(200) } }));
    expect(long.subject).toBe(`Voting is open: ${'x'.repeat(149)}…`);
    expect(long.text).toContain('x'.repeat(200));
  });

  it('encodes the election ID in links', () => {
    const odd = votingOpenMessage(input({ election: { ...ELECTION, electionId: 'a/b c' } }));
    expect(odd.text).toContain(`${ORIGIN}/ballot/a%2Fb%20c`);
  });
});

describe('closingSoonMessage', () => {
  const message = closingSoonMessage(input());

  it('tells someone who has not voted how long is left, and thanks anyone who voted since', () => {
    expect(message.subject).toBe('Voting closes soon: Officers 2026');
    expect(message.text).toContain('You have not voted yet in “Officers 2026”, an election of the US Transhumanist Party, and voting closes in about 24 hours.');
    expect(message.text).toContain('If you have voted since this was sent, thank you: there is nothing more to do.');
    expect(message.text).toContain('Vote by Friday, November 6, 2026, 11:59 PM EST (Eastern Time).');
    expect(message.html).toContain('Open your ballot for “Officers 2026”');
  });

  it('gives the closing time in every zone and says what was used to send it', () => {
    expect(message.text).toContain('When voting closes\n\n- Eastern Time: Friday, November 6, 2026, 11:59 PM EST\n- Central Time:');
    expect(message.text).toContain('- UTC: Saturday, November 7, 2026, 04:59 UTC');
    expect(message.html).toContain('<th scope="col" style="text-align:left;padding:4px 12px 4px 0;border-bottom:1px solid #757575">Voting closes</th>');
    expect(message.text).toContain('Only whether you had voted was used to send it, never how anyone votes.');
    expect(message.text).not.toContain('About this election');
    expect(message.text).toContain('Replies to this email are not read; write to elections@example.org.');
  });

  it('is what noticeMessage gives for each kind', () => {
    expect(noticeMessage('closing_soon', input())).toEqual(message);
    expect(noticeMessage('voting_open', input())).toEqual(votingOpenMessage(input()));
  });

  it('rounds the time left to the hour', () => {
    expect(timeLeft(ELECTION.closesAt, new Date('2026-11-06T06:31:00.000Z'))).toBe('about 22 hours');
    expect(timeLeft(ELECTION.closesAt, new Date('2026-11-06T06:29:00.000Z'))).toBe('about 23 hours');
    expect(timeLeft(ELECTION.closesAt, new Date('2026-11-07T03:40:00.000Z'))).toBe('about an hour');
    expect(timeLeft(ELECTION.closesAt, new Date('2026-11-07T04:40:00.000Z'))).toBe('less than an hour');
  });
});

describe('votedMessage', () => {
  const message = votedMessage(input({ castAt: '2026-11-03T15:04:00.000Z' }));

  it('says the ballot was recorded and when, in Eastern Time', () => {
    expect(message.subject).toBe('Your vote was recorded: Officers 2026');
    expect(message.text).toContain('Hello Alex Rivera,');
    expect(message.text).toContain('Your ballot in “Officers 2026”, an election of the US Transhumanist Party, was recorded.');
    expect(message.text).toContain('Your ballot was recorded Tuesday, November 3, 2026, 10:04 AM EST (Eastern Time).');
  });

  it('tells someone who did not vote what to do, and how to check a vote afterwards', () => {
    expect(message.text).toContain('If you did not vote, someone may have signed in as you');
    expect(message.text).toContain('https://vote.example.org/verify');
    expect(message.text).toContain('elections@example.org');
  });

  it('says only when, never how: no choice, commitment or receipt', () => {
    expect(message.text).not.toMatch(/commitment|chose|choice:/i);
    expect(message.html).not.toMatch(/<img/i);
    expect(noticeMessage('voted', input({ castAt: '2026-11-03T15:04:00.000Z' }))).toEqual(message);
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
    expect(isClaimable({ ...claimed, status: 'bounced' }, 2)).toBe(false);
    expect(isClaimable({ ...claimed, status: 'skipped' }, 2)).toBe(false);
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
  const open = { state: 'open' as const, opensAt: ELECTION.opensAt, closesAt: ELECTION.closesAt };

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

  it('reminds a day before the close, only where voting is open longer than a day', () => {
    expect(reminderTime(open).toISOString()).toBe('2026-11-06T04:59:00.000Z');
    expect(hasReminder(open)).toBe(true);
    expect(hasReminder({ opensAt: '2026-11-06T04:59:00.000Z', closesAt: ELECTION.closesAt })).toBe(false);
    expect(hasReminder({ opensAt: '2026-11-07T04:44:00.000Z', closesAt: ELECTION.closesAt })).toBe(false);
    expect(isReminderDue(open, new Date('2026-11-06T04:58:59.000Z'))).toBe(false);
    expect(isReminderDue(open, new Date('2026-11-06T04:59:00.000Z'))).toBe(true);
    expect(isReminderDue(open, new Date('2026-11-07T04:59:00.000Z'))).toBe(false); // closed
    expect(isReminderDue({ ...open, state: 'scheduled' }, new Date('2026-11-06T05:00:00.000Z'))).toBe(false);
  });

  it('never resends a vote confirmation', () => {
    expect(checkNoticeResend(open, { status: 'done', kind: 'voted' }, 2, now)).toMatchObject({ ok: false, reason: expect.stringContaining('once') });
  });

  it('allows a resend only while voting is open, after the round, when it failed for someone', () => {
    expect(checkNoticeResend(open, { status: 'done', kind: 'voting_open' }, 2, now)).toEqual({ ok: true });
    expect(checkNoticeResend(open, null, 0, now)).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(checkNoticeResend(open, { status: 'sending', kind: 'voting_open' }, 2, now)).toMatchObject({ ok: false, reason: expect.stringContaining('still being sent') });
    expect(checkNoticeResend(open, { status: 'done', kind: 'voting_open' }, 0, now)).toMatchObject({ ok: false, reason: expect.stringContaining('nothing to resend') });
    expect(checkNoticeResend({ ...open, state: 'closed' }, { status: 'done', kind: 'voting_open' }, 2, now)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not open'),
    });
  });

  it('names notices by election and kind, and summarises them as counts', () => {
    expect(noticeId('e1', 'voting_open')).toBe('e1_voting_open');
    expect(noticeId('e1', 'closing_soon')).toBe('e1_closing_soon');
    expect(isNoticeKind('voting_open')).toBe(true);
    expect(isNoticeKind('closing_soon')).toBe(true);
    expect(isNoticeKind('you_voted')).toBe(false);
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
    const counts = { pending: 0, sent: 1, delivered: 1, complained: 0, failed: 1, bounced: 0, skipped: 0 };
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

describe('the emails in the workflow', () => {
  const election = { state: 'open' as const, opensAt: ELECTION.opensAt, closesAt: ELECTION.closesAt };
  const summary = (kind: NoticeSummary['kind'], status: NoticeSummary['status']): NoticeSummary => ({
    kind,
    delivery: 'mail',
    rehearsal: false,
    status,
    round: 1,
    recipients: 3,
    counts: { pending: 0, sent: 3, delivered: 0, complained: 0, failed: 0, bounced: 0, skipped: 0 },
    createdAt: ELECTION.opensAt,
    completedAt: null,
  });
  const view = (delivery: NoticesView['delivery'], notices: NoticeSummary[] = [], settings: NoticeSettings = DEFAULT_NOTICE_SETTINGS): NoticesView => ({
    delivery,
    contact: 'elections@example.org',
    settings,
    notices,
    receipts: noticeReceiptTotals([]),
    tests: [],
    setup: null,
  });
  const steps = (over: Partial<Parameters<typeof noticeSteps>[0]> = {}) =>
    noticeSteps({ election, rehearsal: false, testingMode: false, view: view('mail'), now: new Date('2026-11-03T12:00:00Z'), ...over }).map(
      (s) => `${s.kind}:${s.status}`,
    );

  it('follows the notices the worker started: sending, or done', () => {
    const started = view('mail', [summary('voting_open', 'done'), summary('closing_soon', 'sending')]);
    expect(steps({ view: started })).toEqual(['voting_open:done', 'closing_soon:current', 'voted:current']);
  });

  it('says what is due, to come or past before the worker starts one', () => {
    expect(steps()).toEqual(['voting_open:current', 'closing_soon:upcoming', 'voted:current']);
    expect(steps({ now: new Date('2026-11-06T06:00:00Z') })).toEqual(['voting_open:current', 'closing_soon:current', 'voted:current']);
    expect(steps({ election: { ...election, state: 'scheduled' } })).toEqual(['voting_open:upcoming', 'closing_soon:upcoming', 'voted:upcoming']);
    expect(steps({ election: { ...election, state: 'closed' } })).toEqual(['voting_open:not_reached', 'closing_soon:not_reached', 'voted:not_reached']);
    // Before the view loads, how email goes out is not known yet; it is taken to be set up.
    expect(steps({ view: null })).toEqual(['voting_open:current', 'closing_soon:upcoming', 'voted:current']);
  });

  it('marks what will not come: email not set up, a rehearsal outside testing mode, no reminder in a short window', () => {
    expect(steps({ view: view('none') })).toEqual(['voting_open:not_reached', 'closing_soon:not_reached', 'voted:not_reached']);
    expect(steps({ rehearsal: true })).toEqual(['voting_open:not_reached', 'closing_soon:not_reached', 'voted:not_reached']);
    expect(steps({ rehearsal: true, testingMode: true, view: view('none') })).toEqual(['voting_open:current', 'closing_soon:upcoming', 'voted:current']);
    const day = { ...election, opensAt: '2026-11-06T04:59:00.000Z' };
    expect(steps({ election: day, now: new Date('2026-11-06T06:00:00Z') })).toEqual(['voting_open:current', 'closing_soon:not_reached', 'voted:current']);
  });

  it('follows the System Admins: an email switched off, no contact for questions, another lead time', () => {
    const off = (kind: 'voting_open' | 'closing_soon' | 'voted') => ({
      ...DEFAULT_NOTICE_SETTINGS,
      kinds: { ...DEFAULT_NOTICE_SETTINGS.kinds, [kind]: { ...DEFAULT_NOTICE_SETTINGS.kinds[kind], enabled: false } },
    });
    expect(steps({ view: view('mail', [], off('closing_soon')) })).toEqual(['voting_open:current', 'closing_soon:not_reached', 'voted:current']);
    expect(steps({ view: view('mail', [], off('voting_open')) })).toEqual(['voting_open:not_reached', 'closing_soon:upcoming', 'voted:current']);
    expect(steps({ view: { ...view('mail'), contact: null } })).toEqual(['voting_open:not_reached', 'closing_soon:not_reached', 'voted:not_reached']);
    // The outbox needs no contact: it is never mailed.
    expect(steps({ view: { ...view('outbox'), contact: null } })).toEqual(['voting_open:current', 'closing_soon:upcoming', 'voted:current']);
    const twoDays = { ...DEFAULT_NOTICE_SETTINGS, reminderHours: 48 };
    expect(steps({ view: view('mail', [], twoDays), now: new Date('2026-11-05T05:00:00Z') })).toEqual(['voting_open:current', 'closing_soon:current', 'voted:current']);
    const absent = noticeSteps({ election, rehearsal: false, testingMode: false, view: { ...view('mail', [], off('voting_open')), contact: null }, now: new Date('2026-11-03T12:00:00Z') });
    expect(absent.map((s) => s.absent)).toEqual(['off', 'no_contact', 'no_contact']);
  });

  it('says why an email will not come', () => {
    const why = (over: Partial<Parameters<typeof noticeSteps>[0]> = {}) =>
      noticeSteps({ election, rehearsal: false, testingMode: false, view: view('mail'), now: new Date('2026-11-03T12:00:00Z'), ...over }).map((s) => s.absent);
    expect(why()).toEqual([null, null, null]);
    expect(why({ view: view('none') })).toEqual(['not_set_up', 'not_set_up', 'not_set_up']);
    expect(why({ rehearsal: true })).toEqual(['rehearsal', 'rehearsal', 'rehearsal']);
    expect(why({ election: { ...election, opensAt: '2026-11-06T04:59:00.000Z' } })).toEqual([null, 'short_window', null]);
    expect(why({ election: { ...election, state: 'closed' } })).toEqual(['closed', 'closed', 'closed']);
  });

  it('sums them up for the list: going, none, to come, or done', () => {
    const of = (...s: StepStatus[]) => emailStepStatus(s.map((status, i) => ({ kind: i ? 'closing_soon' : 'voting_open', status, notice: null, absent: null })));
    expect(of('done', 'current')).toBe('current');
    expect(of('not_reached', 'not_reached')).toBe('not_reached');
    expect(of('done', 'upcoming')).toBe('upcoming');
    expect(of('done', 'not_reached')).toBe('done');
    expect(of('done', 'done')).toBe('done');
  });
});
