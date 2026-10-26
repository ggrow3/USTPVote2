import { OK, refuse, type Check, type Outcome } from '../check.js';
import type { LedgerEvent } from '../ledger-events.js';
import { checkStatusChange, nextStatuses, type MemberStatus } from './member-status.js';
import type { MemberRecord, StatusHistoryRecord } from './records.js';

/**
 * The Member aggregate (design §5.1): `members/{accountId}` and its append-only `member_status_history`. A status
 * changes only through `memberStatusTransition`, which gives the new member record, the `member.status_changed` event
 * and the history entry together, so the API writes all three in one transaction.
 */

/** Payload of `member.status_changed` (design §8.2). An application decision carries its `applicationId`. */
export type MemberStatusChangedPayload = {
  readonly from: MemberStatus | null;
  readonly to: MemberStatus;
  readonly reason: string | null;
  readonly applicationId: string | null;
};

/** What a first status change sets on the member record: from an application, or for a test voter persona. */
export type MemberProfile = Pick<MemberRecord, 'legalName' | 'preferredName' | 'state' | 'contact' | 'communications' | 'bylawsVersion'>;

export interface MemberStatusChange {
  readonly accountId: string;
  /** Current record, or null for a first application. */
  readonly current: MemberRecord | null;
  readonly to: MemberStatus;
  readonly actor: string;
  readonly reason: string | null;
  readonly applicationId: string | null;
  /** Profile fields to set alongside the status; required when there is no record yet. */
  readonly profile?: MemberProfile;
  /** ISO 8601, server clock. */
  readonly at: string;
}

export interface StatusTransition {
  readonly member: MemberRecord;
  readonly event: LedgerEvent & { readonly type: 'member.status_changed'; readonly payload: MemberStatusChangedPayload };
  /** The history entry, once the ledger has given the event its sequence number. */
  readonly history: (ledgerSeq: number) => StatusHistoryRecord;
}

/**
 * The records a status change produces. It does not check the change: the commands below do, and
 * `testVoterAdmission` is the one change that skips the rules on purpose.
 */
export function memberStatusTransition(change: MemberStatusChange): StatusTransition {
  const from = change.current?.status ?? null;
  const profile = change.profile ?? change.current;
  if (!profile) throw new Error('a first status change must carry profile fields');
  const member: MemberRecord = {
    accountId: change.accountId,
    status: change.to,
    legalName: profile.legalName,
    preferredName: profile.preferredName,
    state: profile.state,
    contact: profile.contact ?? null,
    communications: profile.communications ?? null,
    bylawsVersion: profile.bylawsVersion,
    memberSince: change.current?.memberSince ?? (change.to === 'active' ? change.at : null),
    statusChangedAt: change.at,
  };
  return {
    member,
    event: {
      type: 'member.status_changed',
      actor: change.actor,
      subject: change.accountId,
      payload: { from, to: change.to, reason: change.reason, applicationId: change.applicationId },
    },
    history: (ledgerSeq) => ({
      accountId: change.accountId,
      from,
      to: change.to,
      reason: change.reason,
      actor: change.actor,
      at: change.at,
      ledgerSeq,
      applicationId: change.applicationId,
    }),
  };
}

/** A member resigns (design §5.1), from any status that allows it. */
export function resignMembership(
  current: MemberRecord | null,
  request: { readonly reason: string | null; readonly at: string },
): Outcome<StatusTransition> {
  if (!current) return refuse('not_found', 'you are not a member');
  const allowed = checkStatusChange({ from: current.status, to: 'resigned', initiatedBy: 'member' });
  if (!allowed.ok) return allowed;
  const { accountId } = current;
  return {
    ok: true,
    value: memberStatusTransition({ accountId, current, to: 'resigned', actor: accountId, reason: request.reason, applicationId: null, at: request.at }),
  };
}

/**
 * Whether an admin may ask to change a member's status other than by deciding an application (suspend, reinstate,
 * lapse…). Checked before the member is read: nobody changes their own status, and applying again is the member's own
 * act.
 */
export function checkMemberStatusRequest(actor: string, accountId: string, to: MemberStatus): Check {
  if (accountId === actor) return refuse('forbidden', 'you cannot change your own membership status');
  if (to === 'applicant') return refuse('conflict', 'members re-apply themselves');
  return OK;
}

/**
 * An admin changes a member's status, with a written reason. A pending application is decided instead
 * (`decideApplication`), so it can never be bypassed (design §5.2). Call after `checkMemberStatusRequest`.
 */
export function changeMemberStatus(
  current: MemberRecord | null,
  request: { readonly to: MemberStatus; readonly reason: string; readonly actor: string; readonly at: string },
): Outcome<StatusTransition> {
  if (!current) return refuse('not_found', 'no such member');
  if (current.status === 'applicant') return refuse('conflict', 'decide the pending application instead');
  const allowed = checkStatusChange({ from: current.status, to: request.to, initiatedBy: 'admin', reason: request.reason });
  if (!allowed.ok) return allowed;
  return {
    ok: true,
    value: memberStatusTransition({ accountId: current.accountId, current, ...request, applicationId: null }),
  };
}

/**
 * The status changes an admin can make to a member in `status`, in the order to offer them: exactly what
 * `checkMemberStatusRequest` and `changeMemberStatus` accept with a written reason. None for an applicant, whose
 * application is decided instead.
 */
export function adminStatusChanges(status: MemberStatus): MemberStatus[] {
  if (status === 'applicant') return [];
  return nextStatuses(status).filter(
    (to) => to !== 'applicant' && checkStatusChange({ from: status, to, initiatedBy: 'admin', reason: 'offered' }).ok,
  );
}

/**
 * A test voter persona joins as an Active member at once (design §10.4), the one status change that skips the
 * application; testing mode allows it. It is recorded like any other change, with the reason `test persona`.
 */
export function testVoterAdmission(persona: {
  readonly accountId: string;
  readonly label: string;
  readonly actor: string;
  readonly bylawsVersion: string;
  readonly at: string;
}): StatusTransition {
  return memberStatusTransition({
    accountId: persona.accountId,
    current: null,
    to: 'active',
    actor: persona.actor,
    reason: 'test persona',
    applicationId: null,
    profile: {
      legalName: persona.label,
      preferredName: null,
      state: 'DC',
      contact: null,
      communications: null,
      bylawsVersion: persona.bylawsVersion,
    },
    at: persona.at,
  });
}
