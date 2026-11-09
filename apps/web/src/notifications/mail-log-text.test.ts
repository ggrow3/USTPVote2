import { describe, expect, it } from 'vitest';
import { MAIL_KINDS, MAIL_STATUSES } from 'ustp-domain';
import { LOG_KIND_LABELS, LOG_STATUS_COLOURS, LOG_STATUS_LABELS, logBounce, logCause, logKind, logRecipient, logStatus } from './mail-log-text.js';

describe('the email log’s wording', () => {
  it('names every kind and status', () => {
    for (const kind of MAIL_KINDS) expect(LOG_KIND_LABELS[kind]).toBeTruthy();
    for (const status of MAIL_STATUSES) {
      expect(LOG_STATUS_LABELS[status]).toBeTruthy();
      expect(LOG_STATUS_COLOURS[status]).toBeTruthy();
    }
  });

  it('says whom an email went to', () => {
    expect(logRecipient({ kind: 'broadcast', accountId: 'a1', accountName: 'Ada Brooks', accountEmail: 'ada@example.test' })).toBe('Ada Brooks (ada@example.test)');
    expect(logRecipient({ kind: 'broadcast', accountId: 'a1', accountName: 'ada@example.test', accountEmail: 'ada@example.test' })).toBe('ada@example.test');
    expect(logRecipient({ kind: 'welcome', accountId: 'a1', accountName: null, accountEmail: null })).toBe('An account with no name');
    expect(logRecipient({ kind: 'probe', accountId: null, accountName: null, accountEmail: null })).toMatch(/simulator/);
    expect(logRecipient({ kind: 'account_email', accountId: null, accountName: null, accountEmail: null })).toBe('An address no account has');
  });

  it('says who caused it', () => {
    expect(logCause({ sender: 'app', causedBy: 'system', causedByName: null })).toBe('The site, by itself');
    expect(logCause({ sender: 'app', causedBy: 'a2', causedByName: 'Ben Cruz' })).toBe('Ben Cruz');
    expect(logCause({ sender: 'app', causedBy: 'a2', causedByName: null })).toBe('A deleted account');
    expect(logCause({ sender: 'app', causedBy: null, causedByName: null })).toBe('Not recorded');
    expect(logCause({ sender: 'identity_platform', causedBy: null, causedByName: null })).toMatch(/Identity Platform/);
    // A welcome link an admin's browser asked Identity Platform for is the admin's.
    expect(logCause({ sender: 'identity_platform', causedBy: 'a2', causedByName: 'Ben Cruz' })).toBe('Ben Cruz');
  });

  it('says when a welcome was Identity Platform’s sign-in link, and that no report reaches one sent by Google', () => {
    expect(logKind({ kind: 'welcome', sender: 'app' })).toBe('Welcome to an added member');
    expect(logKind({ kind: 'welcome', sender: 'identity_platform' })).toBe('Welcome to an added member (Identity Platform’s sign-in link)');
    expect(logKind({ kind: 'sign_in_link', sender: 'identity_platform' })).toBe('Sign-in link (Identity Platform)');
    expect(logStatus({ status: 'sent', handOff: true })).toBe('Sent by Identity Platform, no reports');
    expect(logStatus({ status: 'sent', handOff: false })).toBe('Sent, no report yet');
    expect(logStatus({ status: 'delivered', handOff: false })).toBe('Delivered');
  });

  it('describes a bounce', () => {
    expect(logBounce({ bounce: null })).toBeNull();
    expect(logBounce({ bounce: { type: 'permanent', subType: 'NoEmail' } })).toBe('Bounced for good (NoEmail)');
    expect(logBounce({ bounce: { type: 'transient', subType: 'MailboxFull' } })).toBe('Bounced for now (MailboxFull)');
  });
});
