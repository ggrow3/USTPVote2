import { describe, expect, it } from 'vitest';
import {
  closingSoonMessage,
  DEFAULT_NOTICE_SETTINGS,
  DEFAULT_NOTICE_TEXT,
  fillNoticeText,
  fromHeader,
  fromParts,
  shownFrom,
  noticeSettingsChanges,
  noticeSettingsSchema,
  noticeTemplateProblems,
  resolveNoticeSettings,
  votingOpenMessage,
  type NoticeMessageInput,
  type NoticeSettings,
} from '../index.js';

const ELECTION = {
  electionId: 'e1',
  title: 'Officers 2026',
  description: '',
  opensAt: '2026-11-02T14:00:00.000Z',
  closesAt: '2026-11-07T04:59:00.000Z',
};
const input = (text: NoticeMessageInput['text'] = null): NoticeMessageInput => ({
  election: ELECTION,
  origin: 'https://vote.example.org',
  name: 'Ada',
  contact: 'elections@example.org',
  now: new Date('2026-11-06T04:59:00.000Z'),
  text,
});
const body = (over: Partial<Record<string, unknown>> = {}) => ({ basedOn: 0, ...DEFAULT_NOTICE_SETTINGS, ...over });

describe('the default settings', () => {
  it('send nothing until a System Admin switches email on; then each email on, the reminder a day before, the built-in wording', () => {
    expect(DEFAULT_NOTICE_SETTINGS).toEqual({
      allEmails: false,
      kinds: {
        voting_open: { enabled: true, subject: null, intro: null },
        closing_soon: { enabled: true, subject: null, intro: null },
        voted: { enabled: true, subject: null, intro: null },
      },
      emails: { welcome: true, electionTests: true, memberTests: true },
      reminderHours: 24,
      contact: null,
      senderName: null,
    });
    expect(resolveNoticeSettings(undefined)).toEqual(DEFAULT_NOTICE_SETTINGS);
    // Settings saved before the sender's name was one keep the deployment's.
    expect(resolveNoticeSettings({ contact: 'elections@example.org' }).senderName).toBeNull();
    expect(resolveNoticeSettings({ reminderHours: 48 } as Partial<NoticeSettings>)).toEqual({ ...DEFAULT_NOTICE_SETTINGS, reminderHours: 48 });
    // Settings saved before the other emails had switches keep them on.
    expect(resolveNoticeSettings({ emails: { welcome: false } }).emails).toEqual({ welcome: false, electionTests: true, memberTests: true });
  });

  it('give the same emails as the built-in wording', () => {
    expect(votingOpenMessage(input())).toEqual(
      votingOpenMessage(input({ subject: DEFAULT_NOTICE_TEXT.voting_open.subject, intro: DEFAULT_NOTICE_TEXT.voting_open.intro })),
    );
    expect(votingOpenMessage(input()).subject).toBe('Voting is open: Officers 2026');
    expect(closingSoonMessage(input()).subject).toBe('Voting closes soon: Officers 2026');
  });
});

describe('wording a System Admin writes', () => {
  it('fills in the title, the closing time and the time left', () => {
    const values = { title: 'Officers', closes: 'Friday, 11:59 PM EST (Eastern Time)', time_left: 'about 24 hours' };
    expect(fillNoticeText('{title} closes {closes}; {time_left} left. {title}!', values)).toBe(
      'Officers closes Friday, 11:59 PM EST (Eastern Time); about 24 hours left. Officers!',
    );
  });

  it('becomes the subject, the heading and the opening, escaped in HTML, the rest still filled in', () => {
    const custom = closingSoonMessage(
      input({ subject: 'Last day to vote in {title} <b>', intro: 'Hi from the party.\n\nVoting closes {closes}, in {time_left}.' }),
    );
    expect(custom.subject).toBe('Last day to vote in Officers 2026 <b>');
    expect(custom.text).toContain('Hello Ada,\n\nHi from the party.\n\nVoting closes Friday, November 6, 2026, 11:59 PM EST (Eastern Time), in about 24 hours.');
    expect(custom.text).toContain('If you have voted since this was sent, thank you');
    expect(custom.text).toContain('Vote by Friday, November 6, 2026, 11:59 PM EST');
    expect(custom.html).toContain('>Last day to vote in Officers 2026 &lt;b&gt;</h1>');
    expect(custom.html).not.toContain('<b>');
  });

  it('keeps a subject to one line and caps it', () => {
    const long = votingOpenMessage({ ...input({ subject: `${'y'.repeat(150)} {title}`, intro: null }), election: { ...ELECTION, title: 'x'.repeat(150) } });
    expect(long.subject.length).toBe(200);
    expect(long.subject.endsWith('…')).toBe(true);
  });

  it('names only placeholders the emails fill in', () => {
    expect(noticeTemplateProblems('Vote in {title} by {closes} ({time_left})')).toEqual([]);
    expect(noticeTemplateProblems('Hi {name}')).toEqual(['{name} is not something the email fills in; use {title}, {closes}, {time_left}']);
    expect(noticeTemplateProblems('Vote {title')).toEqual(['a brace has no partner']);
    expect(noticeTemplateProblems('Vote }')).toEqual(['a brace has no partner']);
  });
});

describe('noticeSettingsSchema', () => {
  it('takes the whole settings with the version they were edited from', () => {
    expect(noticeSettingsSchema.safeParse(body()).success).toBe(true);
    const custom = body({
      kinds: {
        voting_open: { enabled: false, subject: 'Vote: {title}', intro: 'Hello.' },
        closing_soon: { enabled: true, subject: null, intro: null },
      },
      reminderHours: 48,
      contact: 'https://transhumanist-party.org/contact/',
    });
    expect(noticeSettingsSchema.parse(custom)).toEqual(custom);
    // A page opened before the other emails had switches leaves them out, and one opened before the sender's name too.
    const { emails: _emails, senderName: _name, ...older } = body();
    expect(noticeSettingsSchema.safeParse(older).success).toBe(true);
    expect(noticeSettingsSchema.parse(body({ senderName: '  U.S. Transhumanist Party, Elections ' })).senderName).toBe(
      'U.S. Transhumanist Party, Elections',
    );
    expect(noticeSettingsSchema.parse(body({ senderName: 'Élections Transhumanistes' })).senderName).toBe('Élections Transhumanistes');
  });

  it('takes a name only as the sender, on one line and up to 60 characters', () => {
    const fails = (senderName: unknown) => !noticeSettingsSchema.safeParse(body({ senderName })).success;
    expect(fails('x'.repeat(60))).toBe(false);
    expect(fails('x'.repeat(61))).toBe(true);
    expect(fails('   ')).toBe(true);
    expect(fails('Elections\nBcc: someone')).toBe(true);
    expect(fails('support@bank.example')).toBe(true);
    expect(fails('Elections <other@example.org>')).toBe(true);
    expect(fails('"Elections"')).toBe(true);
    expect(fails('back\\slash')).toBe(true);
  });

  it('refuses a lead time out of range, a bad contact, a two-line subject, unknown placeholders and stray fields', () => {
    const fails = (b: unknown) => !noticeSettingsSchema.safeParse(b).success;
    expect(fails(body({ reminderHours: 0 }))).toBe(true);
    expect(fails(body({ reminderHours: 169 }))).toBe(true);
    expect(fails(body({ reminderHours: 1.5 }))).toBe(true);
    expect(fails(body({ contact: 'call Dave' }))).toBe(true);
    expect(fails(body({ contact: 'http://example.org' }))).toBe(true);
    const kind = (k: Record<string, unknown>) =>
      body({ kinds: { ...DEFAULT_NOTICE_SETTINGS.kinds, voting_open: { ...DEFAULT_NOTICE_SETTINGS.kinds.voting_open, ...k } } });
    expect(fails(kind({ subject: 'one\ntwo' }))).toBe(true);
    expect(fails(kind({ intro: 'Hi {name}' }))).toBe(true);
    expect(fails(kind({ subject: '   ' }))).toBe(true);
    expect(fails(kind({ subject: 'x'.repeat(151) }))).toBe(true);
    expect(fails(body({ emails: { welcome: false } as never }))).toBe(true);
    expect(fails(body({ emails: { ...DEFAULT_NOTICE_SETTINGS.emails, newsletter: false } as never }))).toBe(true);
    expect(fails({ ...body(), from: 'me@example.org' })).toBe(true);
    expect(fails({ ...body(), basedOn: undefined })).toBe(true);
  });
});

describe('noticeSettingsChanges', () => {
  it('lists every setting that changed, with its old and new value', () => {
    const after: NoticeSettings = {
      allEmails: true,
      kinds: {
        voting_open: { enabled: true, subject: 'Vote: {title}', intro: null },
        closing_soon: { enabled: false, subject: null, intro: null },
        voted: { enabled: true, subject: null, intro: null },
      },
      emails: { welcome: false, electionTests: true, memberTests: false },
      reminderHours: 48,
      contact: 'elections@example.org',
      senderName: 'Transhumanist Party Elections',
    };
    expect(noticeSettingsChanges(DEFAULT_NOTICE_SETTINGS, after)).toEqual([
      { field: 'allEmails', from: false, to: true },
      { field: 'voting_open.subject', from: null, to: 'Vote: {title}' },
      { field: 'closing_soon.enabled', from: true, to: false },
      { field: 'emails.welcome', from: true, to: false },
      { field: 'emails.memberTests', from: true, to: false },
      { field: 'reminderHours', from: 24, to: 48 },
      { field: 'contact', from: null, to: 'elections@example.org' },
      { field: 'senderName', from: null, to: 'Transhumanist Party Elections' },
    ]);
    expect(noticeSettingsChanges(after, after)).toEqual([]);
  });
});

describe('the From header', () => {
  const DEPLOYMENT = 'USTP Elections <noreply@example.org>';

  it('is the deployment’s until a System Admin names the sender, then theirs with the deployment’s address', () => {
    expect(fromHeader(DEPLOYMENT, null)).toBe(DEPLOYMENT);
    expect(fromHeader(DEPLOYMENT, 'Transhumanist Party')).toBe('Transhumanist Party <noreply@example.org>');
    expect(fromHeader('noreply@example.org', 'Transhumanist Party')).toBe('Transhumanist Party <noreply@example.org>');
  });

  it('quotes a name with characters a bare one may not have', () => {
    expect(fromHeader(DEPLOYMENT, 'U.S. Transhumanist Party, Elections')).toBe('"U.S. Transhumanist Party, Elections" <noreply@example.org>');
    expect(fromHeader(DEPLOYMENT, 'Votes (dev)')).toBe('"Votes (dev)" <noreply@example.org>');
  });

  it('writes any other name as encoded words of at most 75 characters, never splitting a character', () => {
    const decode = (header: string) =>
      new TextDecoder().decode(
        new Uint8Array(
          [...header.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].flatMap(([, b64]) => [...atob(b64!)].map((c) => c.charCodeAt(0))),
        ),
      );
    const header = fromHeader(DEPLOYMENT, 'Élections Transhumanistes');
    expect(header).toBe('=?UTF-8?B?w4lsZWN0aW9ucyBUcmFuc2h1bWFuaXN0ZXM=?= <noreply@example.org>');
    const long = 'Ünïcödé '.repeat(7).trim() + ' 🗳️';
    const encoded = fromHeader(DEPLOYMENT, long);
    const words = encoded.replace(/ <noreply@example\.org>$/, '').split(' ');
    expect(words.length).toBeGreaterThan(1);
    for (const word of words) expect(word.length).toBeLessThanOrEqual(75);
    for (const word of words) expect(() => new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array([...atob(word.slice(10, -2))].map((c) => c.charCodeAt(0))))).not.toThrow();
    expect(decode(encoded)).toBe(long);
  });

  it('is shown as a mail app shows it', () => {
    expect(fromParts('"U.S. Party" <noreply@example.org>')).toEqual({ name: 'U.S. Party', address: 'noreply@example.org' });
    expect(fromParts('noreply@example.org')).toEqual({ name: null, address: 'noreply@example.org' });
    expect(shownFrom(DEPLOYMENT, null)).toBe(DEPLOYMENT);
    expect(shownFrom(DEPLOYMENT, 'Élections')).toBe('Élections <noreply@example.org>');
    expect(shownFrom('noreply@example.org', null)).toBe('noreply@example.org');
  });
});
