import { describe, expect, it } from 'vitest';
import type { CreateApplicationInput } from '../api.js';
import type { BylawsRecord } from '../records.js';
import { applicationWindowStart, checkApplicantEmail, decideApplication, submitApplication } from './application.js';
import {
  changeMemberStatus,
  checkMemberStatusRequest,
  memberStatusTransition,
  resignMembership,
  testVoterAdmission,
} from './member.js';
import type { MemberStatus } from './member-status.js';
import type { ApplicationRecord, MemberRecord } from './records.js';

const AT = '2026-10-25T12:00:00.000Z';
const LATER = '2026-11-01T09:30:00.000Z';

const bylaws: BylawsRecord = {
  version: '2026.1',
  title: 'Bylaws',
  text: 'Article I.',
  contentHash: 'a'.repeat(64),
  publishedAt: '2026-01-01T00:00:00.000Z',
  publishedBy: 'admin',
  amends: null,
  changeNote: null,
};

const input: CreateApplicationInput = {
  bylawsVersion: bylaws.version,
  bylawsHash: bylaws.contentHash,
  legalName: 'Ada Lovelace',
  preferredName: '',
  dateOfBirth: '1990-12-10',
  attestsAge: true,
  supportsPlatform: true,
  state: 'NY',
  city: 'Albany',
  postalCode: '122071234',
  phone: '(518) 555-0100',
  statement: 'Hello',
  newsletter: true,
};

function member(status: MemberStatus, memberSince: string | null = null): MemberRecord {
  return {
    accountId: 'acc-1',
    status,
    legalName: 'Ada Lovelace',
    preferredName: null,
    state: 'NY',
    contact: null,
    communications: null,
    bylawsVersion: bylaws.version,
    memberSince,
    statusChangedAt: AT,
  };
}

function submitted(): ApplicationRecord {
  const outcome = submitApplication({ applicationId: 'app-1', accountId: 'acc-1', input, bylaws, recent: 0, current: null, at: AT });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.value.application;
}

describe('member status transitions', () => {
  it('produce the member record, the ledger event and the history entry of one change', () => {
    const t = memberStatusTransition({
      accountId: 'acc-1',
      current: member('applicant'),
      to: 'active',
      actor: 'admin',
      reason: 'welcome',
      applicationId: 'app-1',
      at: LATER,
    });
    expect(t.member).toMatchObject({ status: 'active', memberSince: LATER, statusChangedAt: LATER, legalName: 'Ada Lovelace' });
    expect(t.event).toEqual({
      type: 'member.status_changed',
      actor: 'admin',
      subject: 'acc-1',
      payload: { from: 'applicant', to: 'active', reason: 'welcome', applicationId: 'app-1' },
    });
    expect(t.history(42)).toEqual({
      accountId: 'acc-1',
      from: 'applicant',
      to: 'active',
      reason: 'welcome',
      actor: 'admin',
      at: LATER,
      ledgerSeq: 42,
      applicationId: 'app-1',
    });
  });

  it('keep the date a member first became Active', () => {
    const t = memberStatusTransition({
      accountId: 'acc-1',
      current: member('suspended', AT),
      to: 'active',
      actor: 'admin',
      reason: 'reinstated',
      applicationId: null,
      at: LATER,
    });
    expect(t.member.memberSince).toBe(AT);
  });

  it('need profile fields for a first change', () => {
    expect(() =>
      memberStatusTransition({ accountId: 'acc-1', current: null, to: 'applicant', actor: 'acc-1', reason: null, applicationId: null, at: AT }),
    ).toThrow(/profile/);
  });
});

describe('resigning', () => {
  it('is refused to people without a membership, and to applicants', () => {
    expect(resignMembership(null, { reason: null, at: AT })).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(resignMembership(member('applicant'), { reason: null, at: AT })).toMatchObject({ ok: false, reason: /from applicant/ });
  });

  it('is the member’s own change', () => {
    const outcome = resignMembership(member('active', AT), { reason: 'moving', at: LATER });
    expect(outcome.ok && outcome.value.event).toMatchObject({ actor: 'acc-1', payload: { from: 'active', to: 'resigned', reason: 'moving' } });
  });
});

describe('admin status changes', () => {
  it('are never about the admin themselves, and never make an applicant', () => {
    expect(checkMemberStatusRequest('acc-1', 'acc-1', 'suspended')).toMatchObject({ ok: false, refusal: 'forbidden' });
    expect(checkMemberStatusRequest('admin', 'acc-1', 'applicant')).toMatchObject({
      ok: false,
      refusal: 'conflict',
      reason: 'members re-apply themselves',
    });
    expect(checkMemberStatusRequest('admin', 'acc-1', 'suspended').ok).toBe(true);
  });

  it('leave a pending application to be decided, and need a reason', () => {
    const request = { to: 'suspended' as const, reason: 'conduct', actor: 'admin', at: LATER };
    expect(changeMemberStatus(null, request)).toMatchObject({ ok: false, refusal: 'not_found', reason: 'no such member' });
    expect(changeMemberStatus(member('applicant'), request)).toMatchObject({ ok: false, reason: 'decide the pending application instead' });
    expect(changeMemberStatus(member('active', AT), { ...request, reason: ' ' })).toMatchObject({ ok: false, reason: /reason/ });
    const outcome = changeMemberStatus(member('active', AT), request);
    expect(outcome.ok && outcome.value.member).toMatchObject({ status: 'suspended', memberSince: AT });
  });
});

describe('test voter personas', () => {
  it('join as Active members at once, recorded as a test persona', () => {
    const t = testVoterAdmission({ accountId: 'p-1', label: 'Test voter 1', actor: 'sa', bylawsVersion: '2026.1', at: AT });
    expect(t.member).toMatchObject({ status: 'active', legalName: 'Test voter 1', state: 'DC', memberSince: AT, contact: null });
    expect(t.event.payload).toEqual({ from: null, to: 'active', reason: 'test persona', applicationId: null });
  });
});

describe('applications', () => {
  it('need a verified email and count within the window', () => {
    expect(checkApplicantEmail(false)).toMatchObject({ ok: false, refusal: 'forbidden' });
    expect(checkApplicantEmail(true).ok).toBe(true);
    expect(applicationWindowStart(new Date(AT))).toBe('2026-09-25T12:00:00.000Z');
  });

  it('are made against the current bylaws, within the limit, by someone who may apply', () => {
    const base = { applicationId: 'app-1', accountId: 'acc-1', input, bylaws, recent: 0, current: null, at: AT };
    expect(submitApplication({ ...base, bylaws: null })).toMatchObject({ ok: false, reason: 'no bylaws have been published yet' });
    expect(submitApplication({ ...base, input: { ...input, bylawsHash: 'b'.repeat(64) } })).toMatchObject({
      ok: false,
      reason: /bylaws have changed/,
    });
    expect(submitApplication({ ...base, recent: 3 })).toMatchObject({ ok: false, refusal: 'rate_limited' });
    expect(submitApplication({ ...base, current: member('active') })).toMatchObject({ ok: false, reason: /from active to applicant/ });
    expect(submitApplication({ ...base, current: member('rejected') }).ok).toBe(true);
  });

  it('store the answers normalised, and give the member record only what membership uses', () => {
    const outcome = submitApplication({ applicationId: 'app-1', accountId: 'acc-1', input, bylaws, recent: 2, current: null, at: AT });
    if (!outcome.ok) throw new Error(outcome.reason);
    const { application, transition } = outcome.value;
    expect(application).toMatchObject({
      status: 'pending',
      submittedAt: AT,
      bylawsHash: bylaws.contentHash,
      preferredName: null,
      contact: { city: 'Albany', postalCode: '12207-1234', phone: '+15185550100' },
      communications: { newsletter: AT, announcements: null },
      attestations: { minimumAge: 18, supportsPlatform: true },
      volunteer: false,
      decidedBy: null,
    });
    expect(transition.member).toMatchObject({ status: 'applicant', memberSince: null, contact: application.contact });
    expect(transition.member).not.toHaveProperty('dateOfBirth');
    expect(transition.event.payload).toEqual({ from: null, to: 'applicant', reason: null, applicationId: 'app-1' });
  });

  it('are decided once, by someone else, while the applicant waits', () => {
    const application = submitted();
    const approve = { decision: 'approve' as const, reason: 'welcome' };
    const base = { application, current: member('applicant'), decider: 'admin', input: approve, at: LATER };
    expect(decideApplication({ ...base, application: null })).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(decideApplication({ ...base, decider: 'acc-1' })).toMatchObject({ ok: false, refusal: 'forbidden' });
    expect(decideApplication({ ...base, application: { ...application, status: 'rejected' } })).toMatchObject({
      ok: false,
      reason: 'application is already rejected',
    });
    expect(decideApplication({ ...base, current: member('resigned') })).toMatchObject({
      ok: false,
      reason: 'the applicant is no longer awaiting a decision',
    });

    const approved = decideApplication(base);
    if (!approved.ok) throw new Error(approved.reason);
    expect(approved.value.application).toMatchObject({ status: 'approved', decidedBy: 'admin', decidedAt: LATER, decisionReason: 'welcome' });
    expect(approved.value.transition.member).toMatchObject({ status: 'active', memberSince: LATER });

    const rejected = decideApplication({ ...base, input: { decision: 'reject', reason: 'not eligible' } });
    expect(rejected.ok && [rejected.value.application.status, rejected.value.transition.member.status]).toEqual(['rejected', 'rejected']);
  });
});
