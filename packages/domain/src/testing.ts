import { OK, refuse, type Check } from './check.js';
import type { MemberStatus } from './membership/member-status.js';
import type { Role } from './roles.js';

/**
 * Testing mode (design §10.4). On a test deployment a System Admin can create test personas, synthetic accounts that
 * each hold one admin role or are an Active member, and act as any of them to rehearse an election end to end with
 * every two-person step done by a different account. Production never allows it.
 */

/** Sent with each request made as a persona; the value is the persona's accountId. */
export const ACT_AS_HEADER = 'x-act-as';

export const PERSONA_KINDS = [
  'membership_admin',
  'election_admin',
  'auditor',
  'site_admin',
  'course_admin',
  'communications_admin',
  'voter',
] as const satisfies readonly (Exclude<Role, 'system_admin'> | 'voter')[];
export type PersonaKind = (typeof PERSONA_KINDS)[number];

/**
 * One persona per admin role but System Admin, in role order. There is no System Admin persona, so the testing tools,
 * deleting accounts and System Admins' roles stay with real System Admins. The Test Site Admin changes the roles of test
 * personas only (checkActingRoleChange): a real account's roles change under a real admin's name.
 */
export const ADMIN_PERSONAS: readonly { readonly kind: Exclude<PersonaKind, 'voter'>; readonly label: string }[] = [
  { kind: 'membership_admin', label: 'Test Membership Admin' },
  { kind: 'election_admin', label: 'Test Election Admin' },
  { kind: 'auditor', label: 'Test Auditor' },
  { kind: 'site_admin', label: 'Test Site Admin' },
  { kind: 'course_admin', label: 'Test Course Admin' },
  { kind: 'communications_admin', label: 'Test Communications Admin' },
];

/**
 * A role change made while a System Admin acts as a test persona (the Test Site Admin, design §10.4) is for a test
 * persona only, refused as forbidden (403) on any other account, so the ledger never names a persona as the one who
 * changed a real account's roles. `subjectIsPersona` is null when not known (the web app before it has the personas),
 * which leaves the check to the API.
 */
export function checkActingRoleChange(acting: boolean, subjectIsPersona: boolean | null): Check {
  if (!acting || subjectIsPersona !== false) return OK;
  return refuse('forbidden', "acting as a test persona, you change the roles of test personas only; stop acting to change a real account's roles");
}

/** Voter personas a deployment may hold in all. */
export const MAX_TEST_VOTERS = 50;

/** The reason in a deleted test voter's `account.deleted` entry (design §10.4); the System Admin writes none. */
export const TEST_VOTER_DELETION_REASON = 'test voter deleted under Admin → Testing';

export function voterPersonaLabel(n: number): string {
  return `Test Voter ${n}`;
}

/** `testing_personas/{accountId}` */
export interface PersonaRecord {
  readonly accountId: string;
  readonly kind: PersonaKind;
  readonly label: string;
  /** Voters are numbered from 1; admin personas have no number. */
  readonly number: number | null;
  /** The System Admin who created it. */
  readonly createdBy: string;
  readonly createdAt: string;
}

/** `GET /v1/testing/personas`: each persona with what it can do now. */
export interface PersonaSummary extends PersonaRecord {
  readonly roles: readonly Role[];
  readonly memberStatus: MemberStatus | null;
}
