import type { MemberStatus } from './member-status.js';

/** Document shapes of the membership context (design §5.1, §5.2, §11). */

/** How to reach a member. City and ZIP code only: the street address is never collected (design §5.2). */
export interface MemberContact {
  readonly city: string;
  /** `12345` or `12345-6789`. */
  readonly postalCode: string;
  /** E.164 (`+15551234567`), or null. */
  readonly phone: string | null;
}

/** Opt-ins to party email: when each was given, or null if not. Withdrawing one sets it back to null. */
export interface CommunicationConsents {
  readonly newsletter: string | null;
  readonly announcements: string | null;
}

/** `members/{accountId}` */
export interface MemberRecord {
  readonly accountId: string;
  readonly status: MemberStatus;
  readonly legalName: string;
  readonly preferredName: string | null;
  /** Two-letter state code; the street address is never stored (design §5.2). */
  readonly state: string;
  /** Null for members who applied before contact details were collected. */
  readonly contact: MemberContact | null;
  readonly communications: CommunicationConsents | null;
  readonly bylawsVersion: string;
  /** First time the member became Active. */
  readonly memberSince: string | null;
  readonly statusChangedAt: string;
}

/** `member_status_history/{id}` — append-only. */
export interface StatusHistoryRecord {
  readonly accountId: string;
  readonly from: MemberStatus | null;
  readonly to: MemberStatus;
  readonly reason: string | null;
  readonly actor: string;
  readonly at: string;
  readonly ledgerSeq: number;
  readonly applicationId: string | null;
}

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

/** `applications/{applicationId}` */
export interface ApplicationRecord {
  readonly applicationId: string;
  readonly accountId: string;
  readonly status: ApplicationStatus;
  readonly submittedAt: string;
  readonly bylawsVersion: string;
  readonly bylawsHash: string;
  readonly legalName: string;
  readonly preferredName: string | null;
  /** `YYYY-MM-DD`. Only on the application, for the Membership Admin's review; never copied to the member. */
  readonly dateOfBirth: string;
  /** What the applicant confirmed: the minimum age in force when they applied, and support for the platform. */
  readonly attestations: { readonly minimumAge: number; readonly supportsPlatform: true };
  readonly state: string;
  readonly contact: MemberContact;
  readonly communications: CommunicationConsents;
  readonly statement: string | null;
  readonly interests: string | null;
  readonly skills: string | null;
  readonly volunteer: boolean;
  readonly runForOffice: boolean;
  /** How they heard about USTP. */
  readonly referral: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
}
