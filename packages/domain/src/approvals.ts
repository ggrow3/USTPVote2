import { deny, OK, type Check } from './check.js';
import { checkRoleChange, type Role } from './roles.js';

interface ApprovalRule {
  readonly requesters: readonly Role[];
  readonly approver: Role;
}

/** Actions that need a second person (design §10.2). */
export const TWO_PERSON_ACTIONS = {
  'roll.approve': { requesters: ['election_admin'], approver: 'auditor' },
  'election.schedule': { requesters: ['election_admin'], approver: 'auditor' },
  'election.certify': { requesters: ['election_admin'], approver: 'auditor' },
  'election.cancel': { requesters: ['election_admin'], approver: 'auditor' },
  'position.modify': { requesters: ['membership_admin', 'election_admin'], approver: 'auditor' },
  // Appointing a member to an office without an election; the subject is the appointee (design §6.4).
  'position.appoint': { requesters: ['membership_admin', 'election_admin'], approver: 'auditor' },
  // Role changes now take effect on one System Admin's word (checkCanChangeRole). Nobody requests these any more;
  // they stay so that requests made before can still be decided until they expire.
  'role.grant': { requesters: [], approver: 'system_admin' },
  'role.revoke': { requesters: [], approver: 'system_admin' },
} as const satisfies Record<string, ApprovalRule>;

export type TwoPersonAction = keyof typeof TWO_PERSON_ACTIONS;

/** Approvals and role changes require a sign-in (with MFA) no older than this. */
export const APPROVAL_MAX_AUTH_AGE_SECONDS = 15 * 60;
export const APPROVAL_TTL_DAYS = 7;

export interface Actor {
  readonly accountId: string;
  readonly roles: readonly Role[];
  /** The ID token was issued after a second factor. */
  readonly mfa: boolean;
  /** Seconds since the ID token's `auth_time`. */
  readonly authAgeSeconds: number;
}

export interface PendingApproval {
  readonly action: TwoPersonAction;
  readonly requestedBy: string;
  readonly status: 'pending' | 'approved' | 'rejected' | 'expired' | 'executed';
  readonly expiresAt: Date;
  /** The account the action affects, when it affects one (e.g. the person gaining a role). */
  readonly subject?: string;
}

export function checkCanRequest(action: TwoPersonAction, requester: Actor, subject?: string): Check {
  const rule: ApprovalRule = TWO_PERSON_ACTIONS[action];
  if (!requester.mfa) return deny('admin actions require multi-factor sign-in', 'mfaRequired');
  if (rule.requesters.length === 0) return deny(`${action} is no longer requested`);
  if (!rule.requesters.some((r) => requester.roles.includes(r))) {
    return deny(`${action} must be requested by ${rule.requesters.join(' or ')}`);
  }
  if (subject !== undefined && subject === requester.accountId) return deny('you cannot request this for your own account');
  return OK;
}

/**
 * Whether `changer` may grant or revoke `role` for `subject` (design §10.2). A role change needs no second admin: one
 * System Admin, signed in with MFA within the last 15 minutes, changes the roles of anyone but themselves, and it
 * takes effect at once. The API checks this before the change and checks the roles held again inside its
 * transaction; the web app runs it, in the same order and with the same reasons, to explain a refusal before
 * sending. `roles` is null when the roles held are not known (an account ID typed in), which skips that check.
 */
export function checkCanChangeRole(
  changer: Actor,
  subject: { readonly accountId: string; readonly roles: readonly Role[] | null },
  change: 'grant' | 'revoke',
  role: Role,
): Check {
  if (!changer.mfa) return deny('admin actions require multi-factor sign-in', 'mfaRequired');
  if (!changer.roles.includes('system_admin')) return deny('roles are changed by system_admin');
  if (subject.accountId === changer.accountId) return deny('you cannot change the roles of your own account');
  const fits = subject.roles ? checkRoleChange(subject.roles, change, role) : OK;
  if (!fits.ok) return fits;
  if (changer.authAgeSeconds > APPROVAL_MAX_AUTH_AGE_SECONDS) return deny('sign in again to change roles', 'reauthRequired');
  return OK;
}

/**
 * Deleting an account (design §4): one System Admin, signed in with MFA within the last 15 minutes, deletes an account
 * whose primary email is on the deployment's `DELETABLE_ACCOUNT_EMAILS`, member or not, unless it is on an election's
 * roll or has voted, never their own, and it takes effect at once. The API checks this again inside its transaction.
 */
export function checkCanDeleteAccount(
  deleter: Actor,
  subject: { readonly accountId: string; readonly onDeletionList: boolean; readonly inElections: boolean },
): Check {
  if (!deleter.mfa) return deny('admin actions require multi-factor sign-in', 'mfaRequired');
  if (!deleter.roles.includes('system_admin')) return deny('accounts are deleted by system_admin');
  if (subject.accountId === deleter.accountId) return deny('you cannot delete your own account');
  if (!subject.onDeletionList) return deny("only accounts whose email is on the deployment's deletion list can be deleted");
  if (subject.inElections) return deny('an account on an election roll, or that has voted, cannot be deleted');
  if (deleter.authAgeSeconds > APPROVAL_MAX_AUTH_AGE_SECONDS) return deny('sign in again to delete an account', 'reauthRequired');
  return OK;
}

export function checkCanApprove(request: PendingApproval, approver: Actor, now: Date = new Date()): Check {
  const rule: ApprovalRule = TWO_PERSON_ACTIONS[request.action];
  if (request.status !== 'pending') return deny(`request is ${request.status}`);
  if (now >= request.expiresAt) return deny('request has expired');
  if (approver.accountId === request.requestedBy) return deny('the approver must be a different person than the requester');
  if (request.subject !== undefined && approver.accountId === request.subject) {
    return deny('you cannot approve an action on your own account');
  }
  if (!approver.roles.includes(rule.approver)) return deny(`${request.action} must be approved by ${rule.approver}`);
  if (!approver.mfa) return deny('approvals require multi-factor sign-in', 'mfaRequired');
  if (approver.authAgeSeconds > APPROVAL_MAX_AUTH_AGE_SECONDS) return deny('sign in again to approve', 'reauthRequired');
  return OK;
}
