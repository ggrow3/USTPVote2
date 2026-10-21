import { describe, expect, it } from 'vitest';
import { checkCanApprove, checkCanRequest, type Actor, type PendingApproval } from './approvals.js';
import { electionDocPath, sequenceId } from './collections.js';
import { electionTransitionAuthority, isTerminal } from './election-state.js';
import { isUuidV7, uuidv7, uuidv7Timestamp } from './ids.js';
import { checkStatusChange } from './member-status.js';
import { checkRoleChange, conflictingRoles } from './roles.js';

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
});

describe('roles', () => {
  it('keeps the Auditor separate from every other role', () => {
    expect(conflictingRoles(['election_admin', 'system_admin'], 'auditor')).toEqual(['election_admin', 'system_admin']);
    expect(conflictingRoles(['auditor'], 'membership_admin')).toEqual(['auditor']);
    expect(conflictingRoles(['membership_admin'], 'election_admin')).toEqual([]);
  });

  it('validates grants and revocations against the roles already held', () => {
    expect(checkRoleChange([], 'grant', 'auditor').ok).toBe(true);
    expect(checkRoleChange(['auditor'], 'grant', 'auditor')).toMatchObject({ ok: false, reason: /already holds/ });
    expect(checkRoleChange(['election_admin'], 'grant', 'auditor')).toMatchObject({ ok: false, reason: /election_admin/ });
    expect(checkRoleChange(['auditor'], 'revoke', 'auditor').ok).toBe(true);
    expect(checkRoleChange([], 'revoke', 'auditor')).toMatchObject({ ok: false, reason: /does not hold/ });
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
    expect(checkCanApprove(request, { ...auditor, mfa: false }, now).ok).toBe(false);
    expect(checkCanApprove(request, { ...auditor, authAgeSeconds: 3600 }, now).ok).toBe(false);
    expect(checkCanApprove(request, auditor, new Date('2026-10-28T00:00:00Z')).ok).toBe(false);
    expect(checkCanApprove({ ...request, status: 'approved' }, auditor, now).ok).toBe(false);
  });

  it('requires a second System Admin for role changes', () => {
    const sa1: Actor = { accountId: 'sa1', roles: ['system_admin'], mfa: true, authAgeSeconds: 10 };
    const sa2: Actor = { ...sa1, accountId: 'sa2' };
    const grant: PendingApproval = { ...request, action: 'role.grant', requestedBy: 'sa1', subject: 'someone' };
    expect(checkCanApprove(grant, sa2, now).ok).toBe(true);
    expect(checkCanApprove(grant, auditor, now).ok).toBe(false);
  });

  it('keeps the affected person out of both sides of the request', () => {
    const sa1: Actor = { accountId: 'sa1', roles: ['system_admin'], mfa: true, authAgeSeconds: 10 };
    const sa2: Actor = { ...sa1, accountId: 'sa2' };
    expect(checkCanRequest('role.grant', sa1, 'sa1')).toMatchObject({ ok: false, reason: /own account/ });
    const grantToSa2: PendingApproval = { ...request, action: 'role.grant', requestedBy: 'sa1', subject: 'sa2' };
    expect(checkCanApprove(grantToSa2, sa2, now)).toMatchObject({ ok: false, reason: /own account/ });
  });
});

describe('firestore paths', () => {
  it('builds election subcollection paths and sortable sequence IDs', () => {
    expect(electionDocPath('e1', 'participation', 'acct')).toBe('elections/e1/participation/acct');
    expect(sequenceId(42)).toBe('000000000042');
    expect(() => sequenceId(-1)).toThrow(RangeError);
  });
});
