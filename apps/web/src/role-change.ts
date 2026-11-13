import { checkActingRoleChange, checkCanChangeRole, ROLES, type Actor, type Check, type Role } from 'ustp-domain';
import { roleLabel } from './approval-text.js';

/** The account a role change is about: its roles are null when not known (an account ID typed in). */
export interface RoleChangeSubject {
  readonly accountId: string;
  readonly roles: readonly Role[] | null;
}

/**
 * While this tab acts as a test persona (design §10.4), the accountIds of every persona, or null until they are known;
 * null when not acting.
 */
export type ActingPersonas = { readonly personaIds: ReadonlySet<string> | null } | null;

/**
 * Why the API would refuse this role change, in the order it checks and with its reasons (design §10.2, §10.4): first
 * what it checks before reading anything, then, while acting as a test persona, that the account is one, then the
 * roles the account holds. The reason reads as a sentence, with role names as people read them ("Membership Admin",
 * not `membership_admin`). Null when the API would accept it.
 */
export function roleChangeBlocker(
  actor: Actor,
  subject: RoleChangeSubject,
  change: 'grant' | 'revoke',
  role: Role,
  acting: ActingPersonas,
): string | null {
  const checks: (() => Check)[] = [
    () => checkCanChangeRole(actor, { accountId: subject.accountId, roles: null }, change, role),
    () => checkActingRoleChange(acting !== null, acting?.personaIds ? acting.personaIds.has(subject.accountId) : null),
    () => checkCanChangeRole(actor, subject, change, role),
  ];
  for (const run of checks) {
    const check = run();
    if (check.ok) continue;
    const reason = ROLES.reduce((text, r) => text.replaceAll(r, roleLabel(r)), check.reason);
    return `${reason[0]!.toUpperCase()}${reason.slice(1)}.`;
  }
  return null;
}
