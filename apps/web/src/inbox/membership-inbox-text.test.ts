import { INBOX_STATUSES } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { INBOX_STATUS_LABELS, emailSkipBanner, inboxAuthor, inboxEmailText, readByMember } from './membership-inbox-text.js';

describe('membership inbox wording', () => {
  it('names every status', () => {
    for (const s of INBOX_STATUSES) expect(INBOX_STATUS_LABELS[s]).toBeTruthy();
  });

  it('says what became of an email', () => {
    expect(inboxEmailText(null)).toBeNull();
    expect(inboxEmailText({ status: 'sent', reason: null, at: '2026-11-08T10:00:00.000Z' })).toBe('Emailed');
    expect(inboxEmailText({ status: 'pending', reason: null, at: null })).toBe('Email about to go');
    expect(inboxEmailText({ status: 'not_sent', reason: 'unsubscribed', at: '2026-11-08T10:00:00.000Z' })).toBe(
      'Not emailed: they unsubscribed from all email from the party',
    );
    expect(inboxEmailText({ status: 'not_sent', reason: null, at: null })).toBe('Not emailed: the mail service did not take it');
  });

  it('warns before writing when email will not reach the member', () => {
    expect(emailSkipBanner('Ada Brooks', 'email_off')).toBe(
      'Email will not reach Ada Brooks now: all of the site’s email is switched off. What you write is still on the site for them, under the bell.',
    );
  });

  it('knows whether the member read a message', () => {
    expect(readByMember(null, '2026-11-08T10:00:00.000Z')).toBe(false);
    expect(readByMember('2026-11-08T09:00:00.000Z', '2026-11-08T10:00:00.000Z')).toBe(false);
    expect(readByMember('2026-11-08T10:00:00.000Z', '2026-11-08T10:00:00.000Z')).toBe(true);
  });

  it('names who wrote, and marks notes', () => {
    expect(inboxAuthor({ from: 'team', authorName: 'Cy Diaz', note: false })).toBe('Cy Diaz, for the team');
    expect(inboxAuthor({ from: 'team', authorName: 'Cy Diaz', note: true })).toBe('Note by Cy Diaz, for the team only');
    expect(inboxAuthor({ from: 'member', authorName: 'Ada Brooks', note: false })).toBe('Ada Brooks');
  });
});
