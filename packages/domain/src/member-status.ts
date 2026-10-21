import { deny, OK, type Check } from './check.js';

export const MEMBER_STATUSES = ['applicant', 'active', 'lapsed', 'suspended', 'resigned', 'rejected'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** Allowed status changes (design §5.1). `null` is "no membership record yet". */
const TRANSITIONS: Readonly<Record<MemberStatus, readonly MemberStatus[]>> = {
  applicant: ['active', 'rejected'],
  active: ['lapsed', 'suspended', 'resigned'],
  lapsed: ['active', 'resigned'],
  suspended: ['active', 'resigned'],
  rejected: ['applicant'],
  resigned: ['applicant'],
};

/** Changes a member makes for themselves: applying (again) and resigning. Everything else is an admin decision. */
function isSelfService(from: MemberStatus | null, to: MemberStatus): boolean {
  return to === 'applicant' || (to === 'resigned' && from !== null);
}

export interface StatusChange {
  readonly from: MemberStatus | null;
  readonly to: MemberStatus;
  readonly initiatedBy: 'member' | 'admin';
  /** Required, non-blank, for every admin-initiated change. */
  readonly reason?: string;
}

export function checkStatusChange({ from, to, initiatedBy, reason }: StatusChange): Check {
  const allowed = from === null ? to === 'applicant' : TRANSITIONS[from].includes(to);
  if (!allowed) return deny(`cannot change membership status from ${from ?? 'none'} to ${to}`);
  if (initiatedBy === 'member' && !isSelfService(from, to)) {
    return deny(`changing status to ${to} requires a Membership Admin`);
  }
  if (initiatedBy === 'admin' && !reason?.trim()) return deny('a written reason is required');
  return OK;
}
