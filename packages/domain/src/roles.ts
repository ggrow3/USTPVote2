import { deny, OK, type Check } from './check.js';

/** Course Administrators publish learning material only; they receive no membership, election, ballot or audit powers. */
export const ROLES = ['membership_admin', 'election_admin', 'auditor', 'system_admin', 'course_admin'] as const;
export type Role = (typeof ROLES)[number];

/** The most roles one person may hold at once (design §10.1). */
export const MAX_ROLES_PER_ACCOUNT = 2;

/** Pairs of roles one person may not hold at the same time (design §10.1): the Auditor holds no other role. */
const INCOMPATIBLE: readonly (readonly [Role, Role])[] = [
  ['auditor', 'membership_admin'],
  ['auditor', 'election_admin'],
  ['auditor', 'system_admin'],
  ['auditor', 'course_admin'],
];

/** Roles already held that would conflict with granting `adding`. */
export function conflictingRoles(held: readonly Role[], adding: Role): Role[] {
  return held.filter((r) => INCOMPATIBLE.some(([a, b]) => (a === r && b === adding) || (b === r && a === adding)));
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Whether a role can be granted to / revoked from someone currently holding `held`: a grant must not pair roles that
 * conflict, nor take the account past `MAX_ROLES_PER_ACCOUNT`. A revocation is always allowed, so an account that
 * holds more (granted before the limit) can always be brought within it.
 */
export function checkRoleChange(held: readonly Role[], change: 'grant' | 'revoke', role: Role): Check {
  if (change === 'revoke') return held.includes(role) ? OK : deny(`the account does not hold ${role}`);
  if (held.includes(role)) return deny(`the account already holds ${role}`);
  const conflicts = conflictingRoles(held, role);
  if (conflicts.length) return deny(`${role} cannot be held together with ${conflicts.join(', ')}`);
  if (held.length >= MAX_ROLES_PER_ACCOUNT) {
    const list = held.length === 2 ? held.join(' and ') : `${held.slice(0, -1).join(', ')} and ${held.at(-1)}`;
    return deny(`an account may hold at most ${MAX_ROLES_PER_ACCOUNT} roles, and this one already holds ${list}`);
  }
  return OK;
}
