import { describe, expect, it } from 'vitest';
import {
  adminTestMessage,
  ADMIN_TESTS_PER_DAY,
  checkMailRequest,
  DEFAULT_NOTICE_SETTINGS,
  isUnsubscribeToken,
  mailAddressState,
  mailStop,
  mailStopSchema,
  memberTestMessage,
  noticeMessage,
  NOTICE_KINDS,
  noticeSettingsSchema,
  resolveNoticeSettings,
  unsubscribeLinks,
  welcomeMessage,
} from '../index.js';

/** Who gets none of the site's email (design §10.12). */

const TOKEN = 'a'.repeat(43);
const ORIGIN = 'https://vote.example.org';
const OK_ACCOUNT = { primaryEmail: 'ada@example.org', emailVerified: true };

describe('why an account gets no email', () => {
  it('is an admin’s stop before the member’s own choice, since the member cannot undo it', () => {
    expect(mailStop(null)).toBeNull();
    expect(mailStop({ unsubscribedAt: null, stoppedAt: null })).toBeNull();
    expect(mailStop({ unsubscribedAt: '2026-11-01', stoppedAt: null })).toBe('unsubscribed');
    expect(mailStop({ unsubscribedAt: '2026-11-01', stoppedAt: '2026-11-02' })).toBe('email_stopped');
  });

  it('comes before anything else about the address', () => {
    const bounced = { reason: 'bounced', since: '2026-10-01' } as const;
    expect(mailAddressState(OK_ACCOUNT, bounced, { unsubscribedAt: '2026-11-01', stoppedAt: null })).toEqual({ state: 'unsubscribed', since: '2026-11-01' });
    expect(mailAddressState(OK_ACCOUNT, null, { unsubscribedAt: '2026-11-01', stoppedAt: '2026-11-02' })).toEqual({ state: 'email_stopped', since: '2026-11-02' });
    expect(mailAddressState({ primaryEmail: null, emailVerified: false }, null, { unsubscribedAt: '2026-11-01', stoppedAt: null }).state).toBe('unsubscribed');
    expect(mailAddressState(OK_ACCOUNT, null, null)).toEqual({ state: 'ok', since: null });
    expect(mailAddressState(OK_ACCOUNT, bounced)).toEqual({ state: 'bounced', since: '2026-10-01' });
  });
});

describe('the link', () => {
  it('is an unguessable token, not the account', () => {
    expect(isUnsubscribeToken(TOKEN)).toBe(true);
    for (const bad of ['', 'short', `${TOKEN}a`, 'a'.repeat(42) + '/', null, undefined, ['x']]) expect(isUnsubscribeToken(bad)).toBe(false);
  });

  it('keeps the token out of the page’s path, since page visits record paths (design §10.7)', () => {
    expect(unsubscribeLinks(ORIGIN, TOKEN)).toEqual({
      page: `${ORIGIN}/unsubscribe?token=${TOKEN}`,
      oneClick: `${ORIGIN}/v1/public/unsubscribe/${TOKEN}`,
    });
  });

  it('is in every email, in its text and its HTML', () => {
    const page = unsubscribeLinks(ORIGIN, TOKEN).page;
    const election = {
      electionId: 'e1',
      title: 'Officers',
      description: '',
      opensAt: '2026-11-01T00:00:00.000Z',
      closesAt: '2026-11-08T00:00:00.000Z',
    };
    const person = { origin: ORIGIN, name: 'Ada', contact: 'elections@example.org', unsubscribe: page };
    const messages = [
      ...NOTICE_KINDS.map((kind) => noticeMessage(kind, { ...person, election, now: new Date('2026-11-03T00:00:00Z') })),
      noticeMessage('voting_open', { ...person, election, now: new Date('2026-11-03T00:00:00Z'), test: true }),
      welcomeMessage(person),
      memberTestMessage(person),
      adminTestMessage(person),
    ];
    for (const message of messages) {
      expect(message.text).toContain(`Unsubscribe from all email from the party: ${page}`);
      expect(message.html).toContain(`<a href="${page}"`);
      expect(message.html).toContain('>Unsubscribe</a> from all email from the party.');
    }
  });

  it('leads a preview, which has no member, to the page that says how', () => {
    const { text } = memberTestMessage({ origin: ORIGIN, name: null, contact: null });
    expect(text).toContain(`Unsubscribe from all email from the party: ${ORIGIN}/unsubscribe`);
    expect(text).not.toContain('token=');
  });
});

describe('an admin’s stop', () => {
  it('takes an address or an ID, and a written reason', () => {
    expect(mailStopSchema.safeParse({ email: 'ada@example.org', reason: 'asked' }).success).toBe(true);
    expect(mailStopSchema.safeParse({ accountId: 'a1', reason: 'asked' }).success).toBe(true);
    expect(mailStopSchema.safeParse({ email: 'ada@example.org', reason: '   ' }).success).toBe(false);
    expect(mailStopSchema.safeParse({ reason: 'asked' }).success).toBe(false);
    expect(mailStopSchema.safeParse({ email: 'ada@example.org', accountId: 'a1', reason: 'asked' }).success).toBe(false);
  });
});

describe('the switch for all email', () => {
  it('is off by default, and for settings saved before it existed', () => {
    expect(DEFAULT_NOTICE_SETTINGS.allEmails).toBe(false);
    expect(resolveNoticeSettings(undefined).allEmails).toBe(false);
    expect(resolveNoticeSettings({ reminderHours: 48 }).allEmails).toBe(false);
    expect(resolveNoticeSettings({ allEmails: true }).allEmails).toBe(true);
  });

  it('may be left out by a page opened before it existed', () => {
    const { allEmails: _, ...old } = DEFAULT_NOTICE_SETTINGS;
    expect(noticeSettingsSchema.safeParse({ ...old, basedOn: 0 }).success).toBe(true);
    expect(noticeSettingsSchema.safeParse({ ...old, basedOn: 0, allEmails: 'yes' }).success).toBe(false);
  });
});

describe('asking for a test email', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  const ask = (kind: 'test' | 'retry' | 'admin_test', state: Parameters<typeof checkMailRequest>[0]['state'], over: Partial<Parameters<typeof checkMailRequest>[0]> = {}) =>
    checkMailRequest({ kind, state, mailing: true, enabled: true, theirs: [], now, ...over });

  it('is refused to someone who gets no email, whoever they are', () => {
    for (const kind of ['test', 'retry', 'admin_test'] as const) {
      expect(ask(kind, 'unsubscribed')).toMatchObject({ ok: false });
      expect(ask(kind, 'email_stopped')).toMatchObject({ ok: false });
    }
  });

  it('lets a System Admin try more often than a member', () => {
    const asked = (n: number, kind: 'test' | 'admin_test') =>
      Array.from({ length: n }, () => ({ kind, status: 'done' as const, claimedAt: null, requestedAt: '2026-11-06T11:00:00Z' }));
    expect(ask('test', 'ok', { theirs: asked(3, 'test') })).toMatchObject({ ok: false });
    expect(ask('admin_test', 'ok', { theirs: asked(3, 'admin_test') }).ok).toBe(true);
    expect(ask('admin_test', 'ok', { theirs: asked(ADMIN_TESTS_PER_DAY, 'admin_test') })).toMatchObject({ ok: false });
  });
});
