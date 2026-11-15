import { deny, OK, type Check } from './check.js';

/**
 * Course Administrators publish learning material only, and Communications Admins the party's news, press kit and share
 * kit (design §10.9); neither receives membership, election, ballot or audit powers. Site Admins have most of what System
 * Admins have, but delete no account and no test voter, change every role but System Admin, and leave the sign-in
 * settings, the API keys and the room's model server to System Admins (design §10.1). In testing mode they use the
 * testing tools but for deleting test voters (design §10.4). A Site Admin also does what every other role but System
 * Admin does, without being granted it (`effectiveRoles`), except deciding a two-person request, which takes the role
 * itself (`checkCanApprove`).
 */
export const ROLES = [
  'membership_admin',
  'election_admin',
  'auditor',
  'system_admin',
  'site_admin',
  'course_admin',
  'communications_admin',
] as const;
export type Role = (typeof ROLES)[number];

/** The roles that run the site: System Admins, and Site Admins with most of their powers (design §10.1). */
export const SITE_ADMIN_ROLES = ['system_admin', 'site_admin'] as const satisfies readonly Role[];
export type SiteAdminRole = (typeof SITE_ADMIN_ROLES)[number];

/** Whether these roles include System Admin or Site Admin. */
export function administersSite(roles: readonly Role[]): boolean {
  return SITE_ADMIN_ROLES.some((r) => roles.includes(r));
}

/**
 * The roles a Site Admin acts as without holding them (design §10.1, the user's decision 2026-11-15: "site admin should
 * be able to do everything every other role except what system admin can do"): every role but System Admin.
 */
export const SITE_ADMIN_ACTS_AS: readonly Role[] = ROLES.filter((r) => r !== 'system_admin' && r !== 'site_admin');

/**
 * The roles an account acts with, from the roles it holds: for a Site Admin, every role but System Admin; for anyone
 * else, the roles held. This is the one rule that gives Site Admins the other roles' tools: the API checks its role
 * routes against it, and the web app its tabs and buttons. What asks for a role actually granted keeps reading the
 * roles held: deciding a two-person request (`checkCanApprove`), changing roles (`checkRoleChange`), and who is told
 * about a role's work.
 */
export function effectiveRoles(held: readonly Role[]): Role[] {
  if (!held.includes('site_admin')) return [...held];
  return ROLES.filter((r) => held.includes(r) || SITE_ADMIN_ACTS_AS.includes(r)).sort();
}

/** The most roles one person may hold at once (design §10.1), unless they are a Site Admin. */
export const MAX_ROLES_PER_ACCOUNT = 2;

/**
 * The most roles a Site Admin may hold (design §10.1): Site Admin and three more (the user's decision, 2026-11-14).
 */
export const SITE_ADMIN_MAX_ROLES = 4;

/** The most roles an account holding `roles` may hold. */
export function maxRolesFor(roles: readonly Role[]): number {
  return roles.includes('site_admin') ? SITE_ADMIN_MAX_ROLES : MAX_ROLES_PER_ACCOUNT;
}

/**
 * Pairs of roles one person may not hold at the same time (design §10.1): the Auditor holds no other role, and a System
 * Admin is not also a Site Admin, which would add nothing. A Site Admin is the exception to the first: they may be an
 * Auditor too, with any of the other roles beside it (the user's decision, 2026-11-14).
 */
const INCOMPATIBLE: readonly (readonly [Role, Role])[] = [
  ['auditor', 'membership_admin'],
  ['auditor', 'election_admin'],
  ['auditor', 'system_admin'],
  ['auditor', 'course_admin'],
  ['auditor', 'communications_admin'],
  ['system_admin', 'site_admin'],
];

function conflicts(a: Role, b: Role, roles: readonly Role[]): boolean {
  // An Auditor who is a Site Admin may hold the roles an Auditor otherwise may not.
  if ((a === 'auditor' || b === 'auditor') && roles.includes('site_admin')) return false;
  return INCOMPATIBLE.some(([x, y]) => (x === a && y === b) || (y === a && x === b));
}

/** Roles already held that would conflict with granting `adding`. */
export function conflictingRoles(held: readonly Role[], adding: Role): Role[] {
  const after = [...held, adding];
  return held.filter((r) => conflicts(r, adding, after));
}

/** A reason the roles left cannot be held together without Site Admin, or null. */
function withoutSiteAdmin(left: readonly Role[]): string | null {
  const others = left.filter((r) => r !== 'auditor');
  if (left.includes('auditor') && others.length) return `auditor cannot be held together with ${others.join(', ')} without site_admin`;
  if (left.length > MAX_ROLES_PER_ACCOUNT) return `without site_admin an account may hold at most ${MAX_ROLES_PER_ACCOUNT} roles`;
  return null;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Whether a role can be granted to / revoked from someone currently holding `held`: a grant must not pair roles that
 * conflict, nor take the account past the most it may hold (`maxRolesFor`, counting the role being granted, so making
 * someone a Site Admin raises their limit). A revocation is always allowed, so an account that holds more (granted
 * before the limit) can always be brought within it, with one exception: Site Admin is not revoked while the roles
 * left could only be held by a Site Admin, so their other roles go first.
 */
export function checkRoleChange(held: readonly Role[], change: 'grant' | 'revoke', role: Role): Check {
  if (change === 'revoke') {
    if (!held.includes(role)) return deny(`the account does not hold ${role}`);
    const stranded = role === 'site_admin' ? withoutSiteAdmin(held.filter((r) => r !== 'site_admin')) : null;
    return stranded ? deny(`revoke another role first: ${stranded}`) : OK;
  }
  if (held.includes(role)) return deny(`the account already holds ${role}`);
  const conflicting = conflictingRoles(held, role);
  if (conflicting.length) return deny(`${role} cannot be held together with ${conflicting.join(', ')}`);
  const most = maxRolesFor([...held, role]);
  if (held.length >= most) {
    const list = held.length === 2 ? held.join(' and ') : `${held.slice(0, -1).join(', ')} and ${held.at(-1)}`;
    return deny(`an account may hold at most ${most} roles, and this one already holds ${list}`);
  }
  return OK;
}

/**
 * Whether a change makes, or unmakes, someone both Auditor and Site Admin (design §10.2): granting or revoking Auditor
 * for a Site Admin, or granting Site Admin to an Auditor. Only a System Admin does that.
 */
export function changesAuditingSiteAdmin(held: readonly Role[], change: 'grant' | 'revoke', role: Role): boolean {
  if (role === 'auditor') return held.includes('site_admin');
  return role === 'site_admin' && change === 'grant' && held.includes('auditor');
}
