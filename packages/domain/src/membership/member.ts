import type { MemberCorrectionInput, MemberDetailsInput } from '../api.js';
import { OK, refuse, type Check, type Outcome } from '../check.js';
import type { LedgerEvent } from '../ledger-events.js';
import { countryOf, DEFAULT_COUNTRY } from './countries.js';
import type { NewMember } from './member-import.js';
import { checkStatusChange, nextStatuses, type MemberStatus } from './member-status.js';
import type { CommunicationConsents, MemberContact, MemberRecord, StatusHistoryRecord } from './records.js';
import { normalizePhone, normalizePostalCode, normalizePostcode } from './registration.js';

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
export type MemberProfile = Pick<
  MemberRecord,
  | 'legalName'
  | 'preferredName'
  | 'country'
  | 'state'
  | 'region'
  | 'contact'
  | 'communications'
  | 'usVoteEligible'
  | 'agreesWithCoreIdeals'
  | 'bylawsVersion'
>;

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
    // Records from before the country was asked are in the United States, and say so once they change.
    country: countryOf(profile),
    state: profile.state,
    region: profile.region ?? null,
    contact: profile.contact ?? null,
    communications: profile.communications ?? null,
    // Records from before the membership questions have no answers.
    usVoteEligible: profile.usVoteEligible ?? null,
    agreesWithCoreIdeals: profile.agreesWithCoreIdeals ?? null,
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

/** Payload of `member.details_changed` (design §8.2): which fields changed and why, never their values. */
export type MemberDetailsChangedPayload = {
  readonly fields: readonly MemberDetailField[];
  readonly reason: string | null;
};

/** The parts of a member record that change after joining, as the ledger names them (design §5.2). */
export const MEMBER_DETAIL_FIELDS = [
  'legalName',
  'preferredName',
  'country',
  'state',
  'region',
  'contact.city',
  'contact.postalCode',
  'contact.phone',
  'communications.newsletter',
  'communications.announcements',
] as const;
export type MemberDetailField = (typeof MEMBER_DETAIL_FIELDS)[number];

export interface DetailsTransition {
  readonly member: MemberRecord;
  readonly event: LedgerEvent & { readonly type: 'member.details_changed'; readonly payload: MemberDetailsChangedPayload };
}

/** The new record and its ledger event, or a refusal when nothing changed. */
function detailsTransition(current: MemberRecord, member: MemberRecord, actor: string, reason: string | null): Outcome<DetailsTransition> {
  const before = detailValues(current);
  const after = detailValues(member);
  const fields = MEMBER_DETAIL_FIELDS.filter((f) => before[f] !== after[f]);
  if (fields.length === 0) return refuse('conflict', 'nothing to change');
  return {
    ok: true,
    value: {
      member,
      event: { type: 'member.details_changed', actor, subject: member.accountId, payload: { fields, reason } },
    },
  };
}

function detailValues(m: MemberRecord): Record<MemberDetailField, string | null> {
  return {
    legalName: m.legalName,
    preferredName: m.preferredName,
    country: countryOf(m),
    state: m.state,
    region: m.region ?? null,
    'contact.city': m.contact?.city ?? null,
    'contact.postalCode': m.contact?.postalCode ?? null,
    'contact.phone': m.contact?.phone ?? null,
    'communications.newsletter': m.communications?.newsletter ?? null,
    'communications.announcements': m.communications?.announcements ?? null,
  };
}

type PlaceInput = Pick<MemberDetailsInput, 'country' | 'state' | 'region' | 'city' | 'postalCode' | 'phone'>;

/**
 * Where a member lives and how to reach them, as stored from the application or a later change (design §5.2): in the
 * US the state, city and ZIP code; elsewhere whatever was given of the region, city and postcode, and null for the
 * rest. Each keeps only its own field: a US address has no region, and one elsewhere no state.
 */
export function storedPlace(input: PlaceInput): Pick<MemberRecord, 'country' | 'state' | 'region'> & { readonly contact: MemberContact } {
  const us = input.country === DEFAULT_COUNTRY;
  const postalCode = input.postalCode ? (us ? normalizePostalCode(input.postalCode) : normalizePostcode(input.postalCode)) : null;
  return {
    country: input.country,
    state: us ? (input.state ?? null) : null,
    region: us ? null : input.region || null,
    contact: { city: input.city || null, postalCode, phone: input.phone ? normalizePhone(input.phone) : null },
  };
}

/** Where the member lives and how to reach them, as stored: the same normalizing as the application's. */
function addressDetails(input: PlaceInput & Pick<MemberDetailsInput, 'preferredName'>) {
  return { preferredName: input.preferredName || null, ...storedPlace(input) };
}

/** An opt-in keeps the time it was first given; withdrawing it clears that (design §5.2). */
function consent(given: boolean, since: string | null | undefined, at: string): string | null {
  return given ? (since ?? at) : null;
}

/**
 * A member changes their own details (design §5.2): preferred name, where they live, phone, and their two email
 * opt-ins. Their legal name is corrected by a Membership Admin (`correctMemberDetails`).
 */
export function updateOwnDetails(
  current: MemberRecord | null,
  request: { readonly input: MemberDetailsInput; readonly at: string },
): Outcome<DetailsTransition> {
  if (!current) return refuse('not_found', 'you are not a member');
  const { input, at } = request;
  const communications: CommunicationConsents = {
    newsletter: consent(input.newsletter, current.communications?.newsletter, at),
    announcements: consent(input.announcements, current.communications?.announcements, at),
  };
  return detailsTransition(current, { ...current, ...addressDetails(input), communications }, current.accountId, null);
}

/**
 * Whether an admin may correct this member's details. Checked before the member is read: nobody corrects their own
 * record this way (their own details are on their Account page, and their legal name is another admin's to correct).
 */
export function checkMemberCorrectionRequest(actor: string, accountId: string): Check {
  if (accountId === actor) return refuse('forbidden', 'another Membership Admin must correct your own member record');
  return OK;
}

/**
 * A Membership Admin corrects a member's legal or preferred name, state or contact details, with a written reason
 * (design §5.2). Never the email opt-ins: those are the member's own to give. Call after `checkMemberCorrectionRequest`.
 */
export function correctMemberDetails(
  current: MemberRecord | null,
  request: { readonly input: MemberCorrectionInput; readonly actor: string },
): Outcome<DetailsTransition> {
  if (!current) return refuse('not_found', 'no such member');
  const { input, actor } = request;
  if (!input.reason.trim()) return refuse('conflict', 'a written reason is required');
  return detailsTransition(current, { ...current, legalName: input.legalName, ...addressDetails(input) }, actor, input.reason);
}

/**
 * A Membership Admin adds someone as an Active member at once (design §5.13), with a written reason: like a test voter
 * persona, a status change that skips the application, on the bylaws in force (`bylawsVersion`, null while none are),
 * which the member has not been shown. They answered neither membership question here: the US-vote answer is the admin's, if given, and
 * the Core Ideals answer stays "Not asked". The admin gives no email opt-ins: those are the member's to give.
 */
export function memberAddition(args: {
  readonly accountId: string;
  readonly member: NewMember;
  readonly actor: string;
  readonly reason: string;
  readonly bylawsVersion: string | null;
  readonly at: string;
}): StatusTransition {
  const { member } = args;
  return memberStatusTransition({
    accountId: args.accountId,
    current: null,
    to: 'active',
    actor: args.actor,
    reason: args.reason,
    applicationId: null,
    profile: {
      legalName: member.legalName,
      preferredName: member.preferredName,
      country: member.country,
      state: member.state,
      region: member.region,
      contact: member.contact,
      communications: null,
      usVoteEligible: member.usVoteEligible,
      agreesWithCoreIdeals: null,
      bylawsVersion: args.bylawsVersion,
    },
    at: args.at,
  });
}

/**
 * A test voter persona joins as an Active member at once (design §10.4), the one status change that skips the
 * application; testing mode allows it. It is recorded like any other change, with the reason `test persona`, on the
 * bylaws in force (`bylawsVersion`, null while none are).
 */
export function testVoterAdmission(persona: {
  readonly accountId: string;
  readonly label: string;
  readonly actor: string;
  readonly bylawsVersion: string | null;
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
      usVoteEligible: null,
      agreesWithCoreIdeals: null,
      bylawsVersion: persona.bylawsVersion,
    },
    at: persona.at,
  });
}
