import type { ApprovalRequestRecord, Role } from 'ustp-domain';

const ROLE_LABELS: Record<Role, string> = {
  membership_admin: 'Membership Admin',
  election_admin: 'Election Admin',
  auditor: 'Auditor',
  system_admin: 'System Admin',
};

/** "an Auditor", "a System Admin". */
export function aRole(role: Role): string {
  const label = ROLE_LABELS[role];
  return `${/^[AEIOU]/.test(label) ? 'an' : 'a'} ${label}`;
}

/** One-line descriptions of two-person requests (design §10.2), for admins deciding them. */
export function describeRequest(r: ApprovalRequestRecord): string {
  const p = r.payload as Record<string, unknown>;
  switch (r.action) {
    case 'role.grant':
    case 'role.revoke':
      return `${p.change} ${String(p.role).replace('_', ' ')}`;
    case 'roll.approve':
      return `approve the voter roll (${p.count} members)`;
    case 'election.schedule':
      return `schedule the election (definition ${String(p.definitionHash).slice(0, 12)}…)`;
    case 'election.cancel':
      return `cancel the election (currently ${p.fromState})`;
    case 'election.certify':
      return `certify the results (${String(p.resultsHash).slice(0, 12)}…)`;
    case 'position.modify': {
      const position = p.position as { title?: string; seats?: number; termMonths?: number } | undefined;
      return p.change === 'define'
        ? `define the office ${position?.title} (${position?.seats} ${position?.seats === 1 ? 'seat' : 'seats'}, ${position?.termMonths}-month term)`
        : `end a term in the office ${String(p.positionId)}`;
    }
    default:
      return r.action;
  }
}

/** Where an approver can review what a request is about, if it has a page. */
export function reviewLink(r: ApprovalRequestRecord): string | null {
  const electionId = (r.payload as { electionId?: unknown }).electionId;
  if (typeof electionId === 'string') return `/admin/elections/${electionId}`;
  return r.action === 'position.modify' ? '/admin?tab=offices' : null;
}
