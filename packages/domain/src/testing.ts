import type { MemberStatus } from './membership/member-status.js';
import type { Role } from './roles.js';

/**
 * Testing mode (design §10.4). On a test deployment a System Admin can create test personas, synthetic accounts that
 * each hold one admin role or are an Active member, and act as any of them to rehearse an election end to end with
 * every two-person step done by a different account. Production never allows it.
 */

/** Sent with each request made as a persona; the value is the persona's accountId. */
export const ACT_AS_HEADER = 'x-act-as';

export const PERSONA_KINDS = ['membership_admin', 'election_admin', 'auditor', 'voter'] as const;
export type PersonaKind = (typeof PERSONA_KINDS)[number];

/**
 * One persona per admin role. There is no System Admin persona: role changes stay with real System Admins, recorded
 * under their own names.
 */
export const ADMIN_PERSONAS: readonly { readonly kind: Exclude<PersonaKind, 'voter'>; readonly label: string }[] = [
  { kind: 'membership_admin', label: 'Test Membership Admin' },
  { kind: 'election_admin', label: 'Test Election Admin' },
  { kind: 'auditor', label: 'Test Auditor' },
];

/** Voter personas a deployment may hold in all. */
export const MAX_TEST_VOTERS = 50;

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
