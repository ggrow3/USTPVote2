import { describe, expect, it } from 'vitest';
import type { CreateApplicationInput, MemberCorrectionInput, MemberDetailsInput } from '../api.js';
import type { BylawsRecord } from '../records.js';
import { applicationWindowStart, checkApplicantEmail, decideApplication, submitApplication } from './application.js';
import {
  adminStatusChanges,
  changeMemberStatus,
  checkMemberCorrectionRequest,
  checkMemberStatusRequest,
  correctMemberDetails,
  memberStatusTransition,
  resignMembership,
  testVoterAdmission,
  updateOwnDetails,
} from './member.js';
import { MEMBER_STATUSES, type MemberStatus } from './member-status.js';
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
  formVersion: 2,
  usVoteEligible: true,
  agreesWithCoreIdeals: false,
  country: 'US',
  state: 'NY',
  city: 'Albany',
  postalCode: '122071234',
  phone: '(518) 555-0100',
  statement: 'Hello',
  newsletter: true,
};

/** An application from Canada: no state, and only what the applicant chose to give of the rest. */
const abroad: CreateApplicationInput = {
  ...input,
  country: 'CA',
  state: undefined,
  region: 'Ontario',
  city: undefined,
  postalCode: 'k1a  0b1',
  phone: '+1 613 555 0100',
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
    usVoteEligible: null,
    agreesWithCoreIdeals: null,
    bylawsVersion: bylaws.version,
    memberSince,
    statusChangedAt: AT,
  };
}

function submitted(): ApplicationRecord {
  const outcome = submitApplication({
    applicationId: 'app-1',
    accountId: 'acc-1',
    input,
    bylaws,
    formVersion: 2,
    recent: 0,
    current: null,
    at: AT,
  });
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

describe('status changes an admin is offered', () => {
  it('are the ones the admin console has always offered, in its order', () => {
    expect(Object.fromEntries(MEMBER_STATUSES.map((s) => [s, adminStatusChanges(s)]))).toEqual({
      applicant: [],
      active: ['suspended', 'lapsed', 'resigned'],
      lapsed: ['active', 'resigned'],
      suspended: ['active', 'resigned'],
      resigned: [],
      rejected: [],
    });
  });

  it('are exactly the changes the commands accept', () => {
    for (const from of MEMBER_STATUSES) {
      for (const to of MEMBER_STATUSES) {
        const accepted =
          checkMemberStatusRequest('admin', 'acc-1', to).ok &&
          changeMemberStatus(member(from), { to, reason: 'conduct', actor: 'admin', at: LATER }).ok;
        expect(adminStatusChanges(from).includes(to), `${from} → ${to}`).toBe(accepted);
      }
    }
  });
});

describe('test voter personas', () => {
  it('join as Active members at once, recorded as a test persona', () => {
    const t = testVoterAdmission({ accountId: 'p-1', label: 'Test voter 1', actor: 'sa', bylawsVersion: '2026.1', at: AT });
    expect(t.member).toMatchObject({
      status: 'active',
      legalName: 'Test voter 1',
      state: 'DC',
      memberSince: AT,
      contact: null,
      usVoteEligible: null,
      agreesWithCoreIdeals: null,
    });
    expect(t.event.payload).toEqual({ from: null, to: 'active', reason: 'test persona', applicationId: null });
  });
});

describe('applications', () => {
  it('need a verified email and count within the window', () => {
    expect(checkApplicantEmail(false)).toMatchObject({ ok: false, refusal: 'forbidden' });
    expect(checkApplicantEmail(true).ok).toBe(true);
    expect(applicationWindowStart(new Date(AT))).toBe('2026-09-25T12:00:00.000Z');
  });

  it('are made against the current bylaws and form, within the limit, by someone who may apply', () => {
    const base = { applicationId: 'app-1', accountId: 'acc-1', input, bylaws, formVersion: 2, recent: 0, current: null, at: AT };
    expect(submitApplication({ ...base, bylaws: null })).toMatchObject({ ok: false, reason: 'no bylaws have been published yet' });
    expect(submitApplication({ ...base, input: { ...input, bylawsHash: 'b'.repeat(64) } })).toMatchObject({
      ok: false,
      reason: /bylaws have changed/,
    });
    expect(submitApplication({ ...base, formVersion: 3 })).toMatchObject({
      ok: false,
      refusal: 'conflict',
      reason: /application form has changed/,
    });
    expect(submitApplication({ ...base, recent: 3 })).toMatchObject({ ok: false, refusal: 'rate_limited' });
    expect(submitApplication({ ...base, current: member('active') })).toMatchObject({ ok: false, reason: /from active to applicant/ });
    expect(submitApplication({ ...base, current: member('rejected') }).ok).toBe(true);
  });

  it('store the answers normalised, and give the member record only what membership uses', () => {
    const outcome = submitApplication({
      applicationId: 'app-1',
      accountId: 'acc-1',
      input,
      bylaws,
      formVersion: 2,
      recent: 2,
      current: null,
      at: AT,
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    const { application, transition } = outcome.value;
    expect(application).toMatchObject({
      status: 'pending',
      submittedAt: AT,
      bylawsHash: bylaws.contentHash,
      preferredName: null,
      contact: { city: 'Albany', postalCode: '12207-1234', phone: '+15185550100' },
      communications: { newsletter: AT, announcements: null },
      attestations: { minimumAge: 18 },
      formVersion: 2,
      usVoteEligible: true,
      agreesWithCoreIdeals: false,
      volunteer: false,
      decidedBy: null,
    });
    expect(transition.member).toMatchObject({
      status: 'applicant',
      memberSince: null,
      contact: application.contact,
      usVoteEligible: true,
      agreesWithCoreIdeals: false,
    });
    expect(transition.member).not.toHaveProperty('dateOfBirth');
    expect(transition.event.payload).toEqual({ from: null, to: 'applicant', reason: null, applicationId: 'app-1' });
  });

  it('keep the country, and of a US address only its state, city and ZIP code', () => {
    const base = { applicationId: 'app-1', accountId: 'acc-1', bylaws, formVersion: 2, recent: 0, current: null, at: AT };
    const us = submitApplication({ ...base, input: { ...input, region: 'Upstate' } });
    if (!us.ok) throw new Error(us.reason);
    expect(us.value.application).toMatchObject({ country: 'US', state: 'NY', region: null });
    expect(us.value.transition.member).toMatchObject({ country: 'US', state: 'NY', region: null });
  });

  it('take an application from outside the US without a state, city or ZIP code', () => {
    const base = { applicationId: 'app-1', accountId: 'acc-1', bylaws, formVersion: 2, recent: 0, current: null, at: AT };
    const outcome = submitApplication({ ...base, input: abroad });
    if (!outcome.ok) throw new Error(outcome.reason);
    const place = {
      country: 'CA',
      state: null,
      region: 'Ontario',
      contact: { city: null, postalCode: 'K1A 0B1', phone: '+16135550100' },
    };
    expect(outcome.value.application).toMatchObject(place);
    expect(outcome.value.transition.member).toMatchObject(place);

    const ignored = submitApplication({ ...base, input: { ...abroad, state: 'NY', region: '', postalCode: '' } });
    expect(ignored.ok && ignored.value.application).toMatchObject({ state: null, region: null, contact: { postalCode: null } });
  });

  it('place members from before the country was asked in the United States', () => {
    const old = member('suspended', AT);
    expect(old).not.toHaveProperty('country');
    const t = memberStatusTransition({ accountId: 'acc-1', current: old, to: 'active', actor: 'admin', reason: 'back', applicationId: null, at: LATER });
    expect(t.member).toMatchObject({ country: 'US', state: 'NY', region: null });
  });

  it('take No to both membership questions, and a new application replaces the answers', () => {
    const base = { applicationId: 'app-2', accountId: 'acc-1', bylaws, formVersion: 2, recent: 1, at: AT };
    const no = submitApplication({ ...base, input: { ...input, usVoteEligible: false, agreesWithCoreIdeals: false }, current: null });
    if (!no.ok) throw new Error(no.reason);
    expect(no.value.application).toMatchObject({ usVoteEligible: false, agreesWithCoreIdeals: false });
    expect(no.value.transition.member).toMatchObject({ status: 'applicant', usVoteEligible: false, agreesWithCoreIdeals: false });

    const resigned = { ...member('resigned'), usVoteEligible: false, agreesWithCoreIdeals: false };
    const again = submitApplication({ ...base, input: { ...input, agreesWithCoreIdeals: true }, current: resigned });
    if (!again.ok) throw new Error(again.reason);
    expect(again.value.transition.member).toMatchObject({ usVoteEligible: true, agreesWithCoreIdeals: true });
  });

  it('keep no answers on members from before the questions, until they apply again', () => {
    const { usVoteEligible: _, agreesWithCoreIdeals: __, ...old } = member('suspended', AT);
    const t = memberStatusTransition({
      accountId: 'acc-1',
      current: old as MemberRecord,
      to: 'active',
      actor: 'admin',
      reason: 'reinstated',
      applicationId: null,
      at: LATER,
    });
    expect(t.member).toMatchObject({ usVoteEligible: null, agreesWithCoreIdeals: null });
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

describe('member details', () => {
  const joined: MemberRecord = {
    ...member('active', AT),
    contact: { city: 'Albany', postalCode: '12207-1234', phone: '+15185550100' },
    communications: { newsletter: AT, announcements: null },
  };
  const own: MemberDetailsInput = {
    preferredName: '',
    country: 'US',
    state: 'NY',
    city: 'Albany',
    postalCode: '122071234',
    phone: '(518) 555-0100',
    newsletter: true,
    announcements: false,
  };

  it('are the member’s own to change, stored as the application stores them, with the fields named in the ledger', () => {
    const moved = updateOwnDetails(joined, { input: { ...own, preferredName: 'Ada', state: 'VT', city: 'Burlington', postalCode: '05401', phone: '' }, at: LATER });
    if (!moved.ok) throw new Error(moved.reason);
    expect(moved.value.member).toEqual({
      ...joined,
      preferredName: 'Ada',
      country: 'US',
      state: 'VT',
      region: null,
      contact: { city: 'Burlington', postalCode: '05401', phone: null },
    });
    expect(moved.value.event).toEqual({
      type: 'member.details_changed',
      actor: 'acc-1',
      subject: 'acc-1',
      payload: { fields: ['preferredName', 'state', 'contact.city', 'contact.postalCode', 'contact.phone'], reason: null },
    });
    expect(JSON.stringify(moved.value.event)).not.toContain('Burlington');
  });

  it('move abroad and back, the ledger naming the fields that changed and never the place', () => {
    const moved = updateOwnDetails(joined, {
      input: { ...own, country: 'DE', state: 'NY', region: 'Berlin', city: 'Berlin', postalCode: '10115' },
      at: LATER,
    });
    if (!moved.ok) throw new Error(moved.reason);
    expect(moved.value.member).toMatchObject({
      country: 'DE',
      state: null,
      region: 'Berlin',
      contact: { city: 'Berlin', postalCode: '10115', phone: '+15185550100' },
    });
    expect(moved.value.event.payload.fields).toEqual(['country', 'state', 'region', 'contact.city', 'contact.postalCode']);
    expect(JSON.stringify(moved.value.event)).not.toContain('Berlin');

    const back = updateOwnDetails(moved.value.member, { input: own, at: LATER });
    expect(back.ok && back.value.member).toMatchObject({ country: 'US', state: 'NY', region: null, contact: joined.contact });
  });

  it('keep when an email opt-in was first given, and clear it when withdrawn', () => {
    const changed = updateOwnDetails(joined, { input: { ...own, newsletter: false, announcements: true }, at: LATER });
    if (!changed.ok) throw new Error(changed.reason);
    expect(changed.value.member.communications).toEqual({ newsletter: null, announcements: LATER });
    expect(changed.value.event.payload.fields).toEqual(['communications.newsletter', 'communications.announcements']);
    const again = updateOwnDetails(changed.value.member, { input: { ...own, announcements: true }, at: '2027-01-01T00:00:00.000Z' });
    expect(again.ok && again.value.member.communications).toEqual({ newsletter: '2027-01-01T00:00:00.000Z', announcements: LATER });
  });

  it('are refused without a membership, or when nothing changes', () => {
    expect(updateOwnDetails(null, { input: own, at: LATER })).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(updateOwnDetails(joined, { input: own, at: LATER })).toMatchObject({ ok: false, reason: 'nothing to change' });
  });

  it('can be filled in by members who joined before contact details were collected', () => {
    const filled = updateOwnDetails(member('active', AT), { input: { ...own, newsletter: false }, at: LATER });
    expect(filled.ok && filled.value.event.payload.fields).toEqual(['contact.city', 'contact.postalCode', 'contact.phone']);
  });

  it('are corrected by another Membership Admin with a reason, never touching the opt-ins', () => {
    const correction: MemberCorrectionInput = { ...own, legalName: 'Ada King', reason: 'name changed on marriage' };
    expect(checkMemberCorrectionRequest('acc-1', 'acc-1')).toMatchObject({ ok: false, refusal: 'forbidden' });
    expect(checkMemberCorrectionRequest('admin', 'acc-1').ok).toBe(true);
    expect(correctMemberDetails(null, { input: correction, actor: 'admin' })).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(correctMemberDetails(joined, { input: { ...correction, reason: ' ' }, actor: 'admin' })).toMatchObject({ ok: false });

    const corrected = correctMemberDetails(joined, { input: correction, actor: 'admin' });
    if (!corrected.ok) throw new Error(corrected.reason);
    expect(corrected.value.member).toEqual({ ...joined, legalName: 'Ada King', country: 'US', region: null });
    expect(corrected.value.event).toEqual({
      type: 'member.details_changed',
      actor: 'admin',
      subject: 'acc-1',
      payload: { fields: ['legalName'], reason: 'name changed on marriage' },
    });
  });
});
