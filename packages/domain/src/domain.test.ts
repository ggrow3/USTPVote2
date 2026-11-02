import { describe, expect, it } from 'vitest';
import { checkCanApprove, checkCanChangeRole, checkCanDeleteAccount, checkCanRequest, type Actor, type PendingApproval } from './approvals.js';
import { electionDocPath, sequenceId } from './collections.js';
import { checkElectionDeletable, electionTransitionAuthority, isTerminal } from './election-state.js';
import { isUuidV7, uuidv7, uuidv7Timestamp } from './ids.js';
import { checkStatusChange, mayApply, type MemberStatus } from './membership/member-status.js';
import { checkRoleChange, conflictingRoles, MAX_ROLES_PER_ACCOUNT, ROLES } from './roles.js';
import { ADMIN_PERSONAS } from './testing.js';

describe('uuidv7', () => {
  it('produces RFC 9562 version 7 IDs that embed the timestamp', () => {
    const t = Date.UTC(2026, 9, 20, 12, 0, 0, 123);
    const id = uuidv7(t);
    expect(isUuidV7(id)).toBe(true);
    expect(uuidv7Timestamp(id)).toBe(t);
    expect(uuidv7(t)).not.toBe(id);
  });

  it('sorts by creation time across milliseconds', () => {
    const ids = [3, 1, 2].map((ms) => uuidv7(1_700_000_000_000 + ms));
    expect([...ids].sort().map(uuidv7Timestamp)).toEqual([1, 2, 3].map((ms) => 1_700_000_000_000 + ms));
  });

  it('rejects other UUID versions', () => {
    expect(isUuidV7('0b7a1c2e-9d4f-4e8a-9c1b-2f3e4d5c6b7a')).toBe(false);
  });
});

describe('membership status', () => {
  it('lets members apply and resign, and requires admins for everything else', () => {
    expect(checkStatusChange({ from: null, to: 'applicant', initiatedBy: 'member' }).ok).toBe(true);
    expect(checkStatusChange({ from: 'active', to: 'resigned', initiatedBy: 'member' }).ok).toBe(true);
    expect(checkStatusChange({ from: 'applicant', to: 'active', initiatedBy: 'member' })).toMatchObject({
      ok: false,
      reason: /Membership Admin/,
    });
  });

  it('lets only people with no membership, or a rejected or resigned one, apply', () => {
    const may: (MemberStatus | null)[] = [null, 'rejected', 'resigned'];
    const mayNot: MemberStatus[] = ['applicant', 'active', 'lapsed', 'suspended'];
    expect(may.map(mayApply)).toEqual([true, true, true]);
    expect(mayNot.map(mayApply)).toEqual([false, false, false, false]);
  });

  it('requires a written reason for admin decisions', () => {
    expect(checkStatusChange({ from: 'applicant', to: 'rejected', initiatedBy: 'admin', reason: '  ' }).ok).toBe(false);
    expect(
      checkStatusChange({ from: 'applicant', to: 'rejected', initiatedBy: 'admin', reason: 'Incomplete application' }).ok,
    ).toBe(true);
  });

  it('refuses transitions outside the state machine', () => {
    expect(checkStatusChange({ from: 'rejected', to: 'active', initiatedBy: 'admin', reason: 'x' }).ok).toBe(false);
    expect(checkStatusChange({ from: null, to: 'active', initiatedBy: 'admin', reason: 'x' }).ok).toBe(false);
  });
});

describe('election lifecycle', () => {
  it('requires two people to schedule and certify, and the system to open and close', () => {
    expect(electionTransitionAuthority('draft', 'scheduled')).toBe('two_person');
    expect(electionTransitionAuthority('scheduled', 'open')).toBe('system');
    expect(electionTransitionAuthority('open', 'closed')).toBe('system');
    expect(electionTransitionAuthority('closed', 'certified')).toBe('two_person');
    expect(electionTransitionAuthority('draft', 'cancelled')).toBe('single');
  });

  it('forbids skipping states and leaving terminal states', () => {
    expect(electionTransitionAuthority('draft', 'open')).toBeNull();
    expect(electionTransitionAuthority('closed', 'cancelled')).toBeNull();
    expect(electionTransitionAuthority('certified', 'closed')).toBeNull();
    expect(isTerminal('certified')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('open')).toBe(false);
  });

  it('deletes only cancelled elections nobody voted in, once their pool key is destroyed', () => {
    const cancelled = { state: 'cancelled' as const, poolKeyVersion: null, poolKeyDestroyedAt: null };
    expect(checkElectionDeletable(cancelled, 0)).toEqual({ ok: true });
    expect(checkElectionDeletable({ ...cancelled, state: 'draft' }, 0)).toMatchObject({ ok: false, reason: expect.stringMatching(/only cancelled/) });
    expect(checkElectionDeletable({ ...cancelled, state: 'certified' }, 0).ok).toBe(false);
    expect(checkElectionDeletable(cancelled, 1)).toMatchObject({ ok: false, reason: expect.stringMatching(/^1 ballot was cast/) });
    expect(checkElectionDeletable(cancelled, 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/^3 ballots were cast/) });
    const keyed = { ...cancelled, poolKeyVersion: 'emulator/pool/1' };
    expect(checkElectionDeletable(keyed, 0)).toMatchObject({ ok: false, reason: expect.stringMatching(/encryption key/) });
    expect(checkElectionDeletable({ ...keyed, poolKeyDestroyedAt: '2026-10-23T00:00:00Z' }, 0)).toEqual({ ok: true });
  });

  it('deletes a rehearsal once certified or cancelled, ballots and all, only where testing mode is on', () => {
    const certified = { state: 'certified' as const, poolKeyVersion: 'kms/pool/1', poolKeyDestroyedAt: '2026-10-26T00:00:00Z' };
    const rehearsal = { rehearsal: true, testingMode: true, officeTerms: 0 };
    expect(checkElectionDeletable(certified, 12, rehearsal)).toEqual({ ok: true });
    expect(checkElectionDeletable({ ...certified, state: 'cancelled' }, 3, rehearsal)).toEqual({ ok: true });
    expect(checkElectionDeletable({ ...certified, state: 'closed' }, 12, rehearsal)).toMatchObject({ ok: false, reason: /once its results are certified/ });
    expect(checkElectionDeletable({ ...certified, state: 'open' }, 12, rehearsal)).toMatchObject({ ok: false, reason: /an? open rehearsal cannot/ });
    expect(checkElectionDeletable({ ...certified, poolKeyDestroyedAt: null }, 12, rehearsal)).toMatchObject({ ok: false, reason: /encryption key/ });
    expect(checkElectionDeletable(certified, 12, { ...rehearsal, officeTerms: 1 })).toMatchObject({ ok: false, reason: /started a term of office/ });
    // A real election, or a rehearsal where testing mode is off (production), keeps the ordinary rule.
    expect(checkElectionDeletable(certified, 12, { ...rehearsal, rehearsal: false })).toMatchObject({ ok: false, reason: /only cancelled/ });
    expect(checkElectionDeletable(certified, 12, { ...rehearsal, testingMode: false })).toMatchObject({ ok: false, reason: /only cancelled/ });
    expect(checkElectionDeletable({ ...certified, state: 'cancelled' }, 3, { ...rehearsal, testingMode: false }).ok).toBe(false);
  });
});

describe('roles', () => {
  it('keeps the Auditor separate from every other role', () => {
    expect(conflictingRoles(['election_admin', 'system_admin'], 'auditor')).toEqual(['election_admin', 'system_admin']);
    expect(conflictingRoles(['auditor'], 'membership_admin')).toEqual(['auditor']);
    expect(conflictingRoles(['auditor'], 'course_admin')).toEqual(['auditor']);
    expect(conflictingRoles(['membership_admin'], 'election_admin')).toEqual([]);
    expect(checkRoleChange([], 'grant', 'course_admin').ok).toBe(true);
  });

  it('validates grants and revocations against the roles already held', () => {
    expect(checkRoleChange([], 'grant', 'auditor').ok).toBe(true);
    expect(checkRoleChange(['auditor'], 'grant', 'auditor')).toMatchObject({ ok: false, reason: /already holds/ });
    expect(checkRoleChange(['election_admin'], 'grant', 'auditor')).toMatchObject({ ok: false, reason: /election_admin/ });
    expect(checkRoleChange(['auditor'], 'revoke', 'auditor').ok).toBe(true);
    expect(checkRoleChange([], 'revoke', 'auditor')).toMatchObject({ ok: false, reason: /does not hold/ });
  });

  it('allows two compatible roles but never a third', () => {
    expect(MAX_ROLES_PER_ACCOUNT).toBe(2);
    expect(checkRoleChange(['membership_admin'], 'grant', 'election_admin').ok).toBe(true);
    expect(checkRoleChange(['election_admin'], 'grant', 'system_admin').ok).toBe(true);
    expect(checkRoleChange(['membership_admin', 'election_admin'], 'grant', 'system_admin')).toEqual({
      ok: false,
      reason: 'an account may hold at most 2 roles, and this one already holds membership_admin and election_admin',
    });
  });

  it('names the conflict before the limit when a grant breaks both', () => {
    expect(checkRoleChange(['membership_admin', 'system_admin'], 'grant', 'auditor')).toMatchObject({
      ok: false,
      reason: 'auditor cannot be held together with membership_admin, system_admin',
    });
  });

  it('always allows a revocation, so an account above the limit can be brought within it', () => {
    const three = ['membership_admin', 'election_admin', 'system_admin'] as const;
    expect(checkRoleChange(three, 'revoke', 'election_admin').ok).toBe(true);
    expect(checkRoleChange(three, 'grant', 'auditor').ok).toBe(false);
  });

  it('has a test persona for every role but System Admin', () => {
    expect(ADMIN_PERSONAS.map((p) => p.kind)).toEqual(ROLES.filter((r) => r !== 'system_admin'));
  });
});

describe('two-person rule', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const electionAdmin: Actor = { accountId: 'ea', roles: ['election_admin'], mfa: true, authAgeSeconds: 60 };
  const auditor: Actor = { accountId: 'au', roles: ['auditor'], mfa: true, authAgeSeconds: 60 };
  const request: PendingApproval = {
    action: 'election.certify',
    requestedBy: 'ea',
    status: 'pending',
    expiresAt: new Date('2026-10-27T12:00:00Z'),
  };

  it('accepts a distinct approver with the right role and a fresh MFA sign-in', () => {
    expect(checkCanRequest('election.certify', electionAdmin).ok).toBe(true);
    expect(checkCanApprove(request, auditor, now).ok).toBe(true);
  });

  it('refuses self-approval even when the requester also holds the approver role', () => {
    const both: Actor = { ...electionAdmin, roles: ['election_admin', 'auditor'] };
    expect(checkCanApprove(request, both, now)).toMatchObject({ ok: false, reason: /different person/ });
  });

  it('refuses wrong roles, stale or single-factor sign-ins, and expired or decided requests', () => {
    expect(checkCanRequest('election.certify', auditor).ok).toBe(false);
    expect(checkCanRequest('election.certify', { ...electionAdmin, mfa: false }).ok).toBe(false);
    expect(checkCanApprove(request, { ...auditor, roles: ['membership_admin'] }, now).ok).toBe(false);
    expect(checkCanApprove(request, { ...auditor, mfa: false }, now)).toMatchObject({ ok: false, code: 'mfaRequired' });
    expect(checkCanApprove(request, { ...auditor, authAgeSeconds: 3600 }, now)).toMatchObject({
      ok: false,
      code: 'reauthRequired',
    });
    expect(checkCanApprove(request, auditor, new Date('2026-10-28T00:00:00Z')).ok).toBe(false);
    expect(checkCanApprove({ ...request, status: 'approved' }, auditor, now).ok).toBe(false);
  });

  it('keeps role-change requests made before role changes needed one admin decidable, but takes no new ones', () => {
    const sa1: Actor = { accountId: 'sa1', roles: ['system_admin'], mfa: true, authAgeSeconds: 10 };
    const sa2: Actor = { ...sa1, accountId: 'sa2' };
    expect(checkCanRequest('role.grant', sa1, 'someone')).toMatchObject({ ok: false, reason: /no longer requested/ });
    expect(checkCanRequest('role.revoke', sa1, 'someone').ok).toBe(false);
    const grant: PendingApproval = { ...request, action: 'role.grant', requestedBy: 'sa1', subject: 'someone' };
    expect(checkCanApprove(grant, sa2, now).ok).toBe(true);
    expect(checkCanApprove(grant, sa1, now)).toMatchObject({ ok: false, reason: /different person/ });
    expect(checkCanApprove(grant, auditor, now).ok).toBe(false);
    const grantToSa2: PendingApproval = { ...grant, subject: 'sa2' };
    expect(checkCanApprove(grantToSa2, sa2, now)).toMatchObject({ ok: false, reason: /own account/ });
  });
});

describe('role changes (one System Admin)', () => {
  const sa1: Actor = { accountId: 'sa1', roles: ['system_admin'], mfa: true, authAgeSeconds: 10 };
  const pat = { accountId: 'pat', roles: ['auditor' as const] };

  it('lets one System Admin change the roles of anyone else, System Admin and Auditor included', () => {
    expect(checkCanChangeRole(sa1, pat, 'revoke', 'auditor').ok).toBe(true);
    expect(checkCanChangeRole(sa1, { accountId: 'pat', roles: [] }, 'grant', 'system_admin').ok).toBe(true);
    expect(checkCanChangeRole(sa1, { accountId: 'sa2', roles: ['system_admin'] }, 'revoke', 'system_admin').ok).toBe(true);
    expect(checkCanChangeRole(sa1, { accountId: 'pat', roles: [] }, 'grant', 'auditor').ok).toBe(true);
  });

  it('refuses in the order the API checks, with its reasons', () => {
    expect(checkCanChangeRole({ ...sa1, mfa: false }, pat, 'grant', 'election_admin')).toMatchObject({ code: 'mfaRequired' });
    expect(checkCanChangeRole({ ...sa1, roles: ['membership_admin'] }, pat, 'revoke', 'auditor')).toMatchObject({
      ok: false,
      reason: /system_admin/,
    });
    expect(checkCanChangeRole(sa1, { accountId: 'sa1', roles: null }, 'grant', 'auditor')).toMatchObject({ reason: /own account/ });
    expect(checkCanChangeRole(sa1, { accountId: 'sa1', roles: ['system_admin'] }, 'revoke', 'system_admin')).toMatchObject({
      reason: /own account/,
    });
    expect(checkCanChangeRole(sa1, pat, 'grant', 'auditor')).toMatchObject({ reason: /already holds auditor/ });
    expect(checkCanChangeRole(sa1, pat, 'grant', 'election_admin')).toMatchObject({ reason: /cannot be held together/ });
    expect(checkCanChangeRole(sa1, pat, 'revoke', 'system_admin')).toMatchObject({ reason: /does not hold/ });
    // A change takes effect at once, so it needs a recent sign-in, as an approval does; asked for last.
    expect(checkCanChangeRole({ ...sa1, authAgeSeconds: 3600 }, pat, 'revoke', 'auditor')).toMatchObject({ code: 'reauthRequired' });
    expect(checkCanChangeRole({ ...sa1, authAgeSeconds: 3600 }, pat, 'grant', 'auditor')).toMatchObject({ reason: /already holds/ });
  });

  it('leaves the roles check to the API when the roles held are unknown', () => {
    expect(checkCanChangeRole(sa1, { accountId: 'pat', roles: null }, 'grant', 'election_admin').ok).toBe(true);
    expect(checkCanChangeRole(sa1, { accountId: 'pat', roles: null }, 'revoke', 'system_admin').ok).toBe(true);
  });
});

describe('deleting an account (one System Admin)', () => {
  const sa1: Actor = { accountId: 'sa1', roles: ['system_admin'], mfa: true, authAgeSeconds: 10 };
  const listed = { accountId: 'demo', onDeletionList: true, member: false };

  it('lets one System Admin delete a listed account that is not a member', () => {
    expect(checkCanDeleteAccount(sa1, listed).ok).toBe(true);
  });

  it('refuses in the order the API checks, with its reasons', () => {
    expect(checkCanDeleteAccount({ ...sa1, mfa: false }, listed)).toMatchObject({ code: 'mfaRequired' });
    expect(checkCanDeleteAccount({ ...sa1, roles: ['membership_admin'] }, listed)).toMatchObject({ reason: /system_admin/ });
    expect(checkCanDeleteAccount(sa1, { ...listed, accountId: 'sa1' })).toMatchObject({ reason: /own account/ });
    expect(checkCanDeleteAccount(sa1, { ...listed, onDeletionList: false })).toMatchObject({ reason: /deletion list/ });
    expect(checkCanDeleteAccount(sa1, { ...listed, member: true })).toMatchObject({ reason: /member cannot be deleted/ });
    expect(checkCanDeleteAccount({ ...sa1, authAgeSeconds: 3600 }, listed)).toMatchObject({ code: 'reauthRequired' });
  });
});

describe('firestore paths', () => {
  it('builds election subcollection paths and sortable sequence IDs', () => {
    expect(electionDocPath('e1', 'participation', 'acct')).toBe('elections/e1/participation/acct');
    expect(sequenceId(42)).toBe('000000000042');
    expect(() => sequenceId(-1)).toThrow(RangeError);
  });
});
