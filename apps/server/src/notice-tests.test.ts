import { ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DEFAULT_NOTICE_SETTINGS, type NoticeTestRecord, type Role } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { ROLES_KEY } from './auth/decorators.js';
import type { RequestContext } from './auth/principal.js';
import type { ServerConfig } from './config.js';
import type { ElectionReader } from './elections/election-reader.js';
import type { Firebase } from './infra/firebase.js';
import type { LedgerService } from './ledger/ledger.service.js';
import type { MailRepository } from './notifications/mail.repository.js';
import type { NoticeSettingsService } from './notifications/notice-settings.js';
import type { NoticeRepository } from './notifications/notice.repository.js';
import { NoticesController } from './notifications/notices.controller.js';
import { NoticesService, testRecipient } from './notifications/notices.service.js';

/** Test emails (design §6.8): who may ask for one, and that it only ever goes to the caller's own account. */

const ctx = (accountId: string | null, operator: string | null = null): RequestContext => ({
  principal: { uid: 'u', email: null, emailVerified: true, name: null, provider: 'password', mfa: true, authTime: 0 },
  accountId,
  roles: ['election_admin'],
  operator,
});

describe('who may ask for a test email', () => {
  const roles = (handler: keyof NoticesController) =>
    new Reflector().getAllAndOverride<Role[]>(ROLES_KEY, [NoticesController.prototype[handler], NoticesController]);

  it('is an Election Admin, as for a resend; Auditors only read the counts', () => {
    expect(roles('test')).toEqual(['election_admin']);
    expect(roles('resend')).toEqual(['election_admin']);
    expect(roles('view')).toEqual(['election_admin', 'auditor']);
  });
});

describe('testRecipient', () => {
  it('is the caller’s own account, or the signed-in System Admin’s when they act as a persona', () => {
    expect(testRecipient(ctx('ea'))).toBe('ea');
    expect(testRecipient(ctx('persona-ea', 'sa1'))).toBe('sa1');
    expect(() => testRecipient(ctx(null))).toThrow(ForbiddenException);
  });
});

describe('NoticesService.requestTest', () => {
  /** The service over fakes: one election, the caller's earlier tests, and what the transaction writes. */
  function service(over: { mailTransport?: ServerConfig['mailTransport']; contact?: string | null; candidate?: boolean; theirs?: NoticeTestRecord[] } = {}) {
    const created: unknown[] = [];
    const tx = { create: (_ref: unknown, data: unknown) => void created.push(data) };
    const firebase = { db: { runTransaction: <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) } } as unknown as Firebase;
    const elections = {
      find: async (id: string) => (id === 'e1' ? { electionId: 'e1' } : null),
      isCandidate: async () => over.candidate ?? false,
    } as unknown as ElectionReader;
    const notices = {
      testRef: () => ({ id: 't-new' }),
      testsTo: async () => over.theirs ?? [],
    } as unknown as NoticeRepository;
    const settings = {
      current: async () => ({ ...DEFAULT_NOTICE_SETTINGS, contact: over.contact === undefined ? 'elections@example.org' : over.contact }),
    } as unknown as NoticeSettingsService;
    const config = { mailTransport: over.mailTransport ?? 'ses', noticeContact: null } as unknown as ServerConfig;
    return { created, notices: new NoticesService(firebase, {} as LedgerService, notices, {} as MailRepository, elections, settings, config) };
  }

  it('queues a test addressed to the caller’s own account, never another', async () => {
    const { created, notices } = service();
    const summary = await notices.requestTest(ctx('ea'), 'e1', 'voting_open');
    expect(summary).toMatchObject({ testId: 't-new', kind: 'voting_open', status: 'pending', sent: false });
    expect(created).toEqual([expect.objectContaining({ testId: 't-new', electionId: 'e1', requestedBy: 'ea', accountId: 'ea', status: 'pending' })]);
  });

  it('sends a persona’s test to the System Admin acting as it, since a persona has no address', async () => {
    const { created, notices } = service();
    await notices.requestTest(ctx('persona-ea', 'sa1'), 'e1', 'closing_soon');
    expect(created).toEqual([expect.objectContaining({ requestedBy: 'persona-ea', accountId: 'sa1', kind: 'closing_soon' })]);
  });

  it('refuses a candidate in the election, as a resend does', async () => {
    const { created, notices } = service({ candidate: true });
    await expect(notices.requestTest(ctx('ea'), 'e1', 'voting_open')).rejects.toThrow(ForbiddenException);
    expect(created).toEqual([]);
  });

  it('refuses where no email would go: email off, or no contact for questions', async () => {
    await expect(service({ mailTransport: 'off' }).notices.requestTest(ctx('ea'), 'e1', 'voting_open')).rejects.toThrow(ConflictException);
    await expect(service({ contact: null }).notices.requestTest(ctx('ea'), 'e1', 'voting_open')).rejects.toThrow(ConflictException);
    // The outbox (emulators) is never mailed, so it needs no contact.
    await expect(service({ mailTransport: 'outbox', contact: null }).notices.requestTest(ctx('ea'), 'e1', 'voting_open')).resolves.toBeTruthy();
  });

  it('refuses a second test while one is on its way, and too many in a day', async () => {
    const earlier = (status: NoticeTestRecord['status']): NoticeTestRecord => ({
      testId: 't0',
      electionId: 'e1',
      kind: 'voting_open',
      requestedBy: 'ea',
      accountId: 'ea',
      requestedAt: new Date().toISOString(),
      status,
      claimedAt: null,
      doneAt: null,
      outcome: null,
      receiptId: null,
    });
    await expect(service({ theirs: [earlier('pending')] }).notices.requestTest(ctx('ea'), 'e1', 'voting_open')).rejects.toThrow(ConflictException);
    const busyDay = service({ theirs: Array.from({ length: 10 }, () => earlier('done')) });
    await expect(busyDay.notices.requestTest(ctx('ea'), 'e1', 'voting_open')).rejects.toSatisfy((e) => e instanceof HttpException && e.getStatus() === 429);
  });

  it('answers 404 for an election that does not exist', async () => {
    await expect(service().notices.requestTest(ctx('ea'), 'nope', 'voting_open')).rejects.toMatchObject({ status: 404 });
  });
});
