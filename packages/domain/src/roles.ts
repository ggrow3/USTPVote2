import { deny, OK, type Check } from './check.js';

export const ROLES =['membership_admin', 'election_admin', 'auditor', 'system_admin'] as const;
export type Role = (typeof ROLES)[number];

/** Pairs of roles one person may not hold at the same time (design §10.1): the Auditor holds no other role. */
const INCOMPATIBLE: readonly (readonly [Role, Role])[] = [
  ['auditor', 'membership_admin'],
  ['auditor', 'election_admin'],
  ['auditor', 'system_admin'],
];

/** Roles already held that would conflict with granting `adding`. */
export function conflictingRoles(held: readonly Role[], adding: Role): Role[] {
  return held.filter((r) => INCOMPATIBLE.some(([a, b]) => (a === r && b === adding) || (b === r && a === adding)));
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Whether a role can be granted to / revoked from someone currently holding `held`. */
export function checkRoleChange(held: readonly Role[], change: 'grant' | 'revoke', role: Role): Check {
  if (change === 'revoke') return held.includes(role) ? OK : deny(`the account does not hold ${role}`);
  if (held.includes(role)) return deny(`the account already holds ${role}`);
  const conflicts = conflictingRoles(held, role);
  return conflicts.length === 0 ? OK : deny(`${role} cannot be held together with ${conflicts.join(', ')}`);
}
