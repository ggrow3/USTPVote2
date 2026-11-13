import type { CreateApplicationInput, DecisionInput } from '../api.js';
import { OK, refuse, type Check, type Outcome } from '../check.js';
import type { BylawsRecord } from '../records.js';
import { memberStatusTransition, storedPlace, type StatusTransition } from './member.js';
import { checkStatusChange } from './member-status.js';
import type { ApplicationRecord, MemberRecord } from './records.js';
import {
  APPLICATION_WINDOW_DAYS,
  MAX_APPLICATIONS_PER_WINDOW,
  MINIMUM_MEMBER_AGE,
} from './registration.js';

/**
 * The MembershipApplication aggregate (design §5.2): `applications/{applicationId}`, made against one bylaws version
 * and decided once by a Membership Admin. Submitting and deciding each change the applicant's member status too, so
 * both give the application and the status transition together.
 */

export interface ApplicationChange {
  readonly application: ApplicationRecord;
  readonly transition: StatusTransition;
}

/** Applying needs a verified email address; checked before anything is read. */
export function checkApplicantEmail(emailVerified: boolean): Check {
  return emailVerified ? OK : refuse('forbidden', 'verify your email address before applying');
}

/** Where the window for MAX_APPLICATIONS_PER_WINDOW starts, for an application made `now` (design §14). */
export function applicationWindowStart(now: Date): string {
  return new Date(now.getTime() - APPLICATION_WINDOW_DAYS * 86_400_000).toISOString();
}

/**
 * A new application, which makes its author an applicant. It must agree to the *current* bylaws, identified by
 * version and content hash, and answer the registration form's *current* wording (`formVersion`); the account may
 * have made at most MAX_APPLICATIONS_PER_WINDOW (`recent`, counted from `applicationWindowStart`); and its member
 * status must allow applying (never applied, rejected or resigned). The schema has already checked the age,
 * attestations and contact formats. The two membership questions are recorded as answered: No to either never
 * refuses an application (design §5.2).
 */
export function submitApplication(args: {
  readonly applicationId: string;
  readonly accountId: string;
  readonly input: CreateApplicationInput;
  readonly bylaws: BylawsRecord | null;
  /** The registration form's current version. */
  readonly formVersion: number;
  readonly recent: number;
  readonly current: MemberRecord | null;
  readonly at: string;
  /** Whose referral link the applicant came by, from `input.referralCode` (design §5.17); null when none or no one's. */
  readonly referredBy?: string | null;
}): Outcome<ApplicationChange> {
  const { accountId, input, bylaws, current, at } = args;
  if (!bylaws) return refuse('conflict', 'no bylaws have been published yet');
  if (bylaws.version !== input.bylawsVersion || bylaws.contentHash !== input.bylawsHash) {
    return refuse('conflict', 'the bylaws have changed; review the current version and agree again');
  }
  if (input.formVersion !== args.formVersion) {
    return refuse('conflict', 'the application form has changed; read the questions again, then submit');
  }
  if (args.recent >= MAX_APPLICATIONS_PER_WINDOW) {
    return refuse(
      'rate_limited',
      `at most ${MAX_APPLICATIONS_PER_WINDOW} applications in ${APPLICATION_WINDOW_DAYS} days; try again later`,
    );
  }
  const allowed = checkStatusChange({ from: current?.status ?? null, to: 'applicant', initiatedBy: 'member' });
  if (!allowed.ok) return allowed;

  const application: ApplicationRecord = {
    applicationId: args.applicationId,
    accountId,
    status: 'pending',
    submittedAt: at,
    bylawsVersion: bylaws.version,
    bylawsHash: bylaws.contentHash,
    legalName: input.legalName,
    preferredName: input.preferredName || null,
    dateOfBirth: input.dateOfBirth,
    attestations: { minimumAge: MINIMUM_MEMBER_AGE },
    formVersion: input.formVersion,
    usVoteEligible: input.usVoteEligible,
    agreesWithCoreIdeals: input.agreesWithCoreIdeals,
    ...storedPlace(input),
    communications: { newsletter: input.newsletter ? at : null, announcements: input.announcements ? at : null },
    statement: input.statement || null,
    interests: input.interests || null,
    skills: input.skills || null,
    volunteer: input.volunteer ?? false,
    runForOffice: input.runForOffice ?? false,
    referral: input.referral || null,
    // Never the applicant's own link.
    referredBy: args.referredBy && args.referredBy !== accountId ? args.referredBy : null,
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
  };
  const transition = memberStatusTransition({
    accountId,
    current,
    to: 'applicant',
    actor: accountId,
    reason: null,
    applicationId: application.applicationId,
    // Only what membership uses afterwards: the date of birth stays on the application (design §5.2).
    profile: {
      legalName: application.legalName,
      preferredName: application.preferredName,
      country: application.country,
      state: application.state,
      region: application.region,
      contact: application.contact,
      communications: application.communications,
      usVoteEligible: input.usVoteEligible,
      agreesWithCoreIdeals: input.agreesWithCoreIdeals,
      bylawsVersion: application.bylawsVersion,
    },
    at,
  });
  return { ok: true, value: { application, transition } };
}

/**
 * A Membership Admin approves or rejects a pending application, with a reason (design §5.2): never their own, and only
 * while its author is still an applicant. Approving makes them Active, rejecting Rejected.
 */
export function decideApplication(args: {
  readonly application: ApplicationRecord | null;
  /** The applicant's member record. */
  readonly current: MemberRecord | null;
  readonly decider: string;
  readonly input: DecisionInput;
  readonly at: string;
}): Outcome<ApplicationChange> {
  const { application, current, decider, input, at } = args;
  if (!application) return refuse('not_found', 'no such application');
  if (application.accountId === decider) return refuse('forbidden', 'you cannot decide your own application');
  if (application.status !== 'pending') return refuse('conflict', `application is already ${application.status}`);
  if (current?.status !== 'applicant') return refuse('conflict', 'the applicant is no longer awaiting a decision');
  const to = input.decision === 'approve' ? 'active' : 'rejected';
  const allowed = checkStatusChange({ from: 'applicant', to, initiatedBy: 'admin', reason: input.reason });
  if (!allowed.ok) return allowed;

  const transition = memberStatusTransition({
    accountId: application.accountId,
    current,
    to,
    actor: decider,
    reason: input.reason,
    applicationId: application.applicationId,
    at,
  });
  const decided: ApplicationRecord = {
    ...application,
    status: input.decision === 'approve' ? 'approved' : 'rejected',
    decidedBy: decider,
    decidedAt: at,
    decisionReason: input.reason,
  };
  return { ok: true, value: { application: decided, transition } };
}
