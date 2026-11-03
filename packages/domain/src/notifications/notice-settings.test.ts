import { describe, expect, it } from 'vitest';
import {
  closingSoonMessage,
  DEFAULT_NOTICE_SETTINGS,
  DEFAULT_NOTICE_TEXT,
  fillNoticeText,
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
  it('keep the emails as they were: all on, the reminder a day before, the built-in wording', () => {
    expect(DEFAULT_NOTICE_SETTINGS).toEqual({
      kinds: {
        voting_open: { enabled: true, subject: null, intro: null },
        closing_soon: { enabled: true, subject: null, intro: null },
        voted: { enabled: true, subject: null, intro: null },
      },
      reminderHours: 24,
      contact: null,
    });
    expect(resolveNoticeSettings(undefined)).toEqual(DEFAULT_NOTICE_SETTINGS);
    expect(resolveNoticeSettings({ reminderHours: 48 } as Partial<NoticeSettings>)).toEqual({ ...DEFAULT_NOTICE_SETTINGS, reminderHours: 48 });
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
    expect(fails({ ...body(), from: 'me@example.org' })).toBe(true);
    expect(fails({ ...body(), basedOn: undefined })).toBe(true);
  });
});

describe('noticeSettingsChanges', () => {
  it('lists every setting that changed, with its old and new value', () => {
    const after: NoticeSettings = {
      kinds: {
        voting_open: { enabled: true, subject: 'Vote: {title}', intro: null },
        closing_soon: { enabled: false, subject: null, intro: null },
        voted: { enabled: true, subject: null, intro: null },
      },
      reminderHours: 48,
      contact: 'elections@example.org',
    };
    expect(noticeSettingsChanges(DEFAULT_NOTICE_SETTINGS, after)).toEqual([
      { field: 'voting_open.subject', from: null, to: 'Vote: {title}' },
      { field: 'closing_soon.enabled', from: true, to: false },
      { field: 'reminderHours', from: 24, to: 48 },
      { field: 'contact', from: null, to: 'elections@example.org' },
    ]);
    expect(noticeSettingsChanges(after, after)).toEqual([]);
  });
});
