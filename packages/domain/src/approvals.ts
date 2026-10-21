import { deny, OK, type Check } from './check.js';
import type { Role } from './roles.js';

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
  'role.grant': { requesters: ['system_admin'], approver: 'system_admin' },
  'role.revoke': { requesters: ['system_admin'], approver: 'system_admin' },
} as const satisfies Record<string, ApprovalRule>;

export type TwoPersonAction = keyof typeof TWO_PERSON_ACTIONS;

/** Approvals require a sign-in (with MFA) no older than this. */
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
  if (!rule.requesters.some((r) => requester.roles.includes(r))) {
    return deny(`${action} must be requested by ${rule.requesters.join(' or ')}`);
  }
  if (subject !== undefined && subject === requester.accountId) return deny('you cannot request this for your own account');
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
