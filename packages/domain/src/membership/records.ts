import type { AccountPreferences } from '../daily.js';
import type { MailStatus } from '../notifications/mail.js';
import type { WelcomeEmailRecord, WelcomeVia } from '../notifications/welcome.js';
import type { MemberStatus } from './member-status.js';

/** Document shapes of the membership context (design §5.1, §5.2, §11). */

/** How to reach a member. City and ZIP code or postcode only: the street address is never collected (design §5.2). */
export interface MemberContact {
  /** Always given in the US; optional elsewhere, and null when not given. */
  readonly city: string | null;
  /** In the US the ZIP code, `12345` or `12345-6789`; elsewhere the postcode (`SW1A 1AA`), or null if not given. */
  readonly postalCode: string | null;
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
  /**
   * ISO 3166-1 alpha-2 code (`countryOf`). Records made before the country was asked have none, and are in the
   * United States.
   */
  readonly country?: string;
  /**
   * In the US, the two-letter state or territory code; null elsewhere. The street address is never stored (design
   * §5.2).
   */
  readonly state: string | null;
  /** Outside the US, the state, province or county as given, or null; absent on older records. */
  readonly region?: string | null;
  /** Null for members who applied before contact details were collected. */
  readonly contact: MemberContact | null;
  readonly communications: CommunicationConsents | null;
  /**
   * The answer to "eligible to vote in any United States elections?": Yes is a United States Member, No an Allied
   * Member (`memberClass`). Null for members never asked (they joined before the question, or are test personas).
   */
  readonly usVoteEligible: boolean | null;
  /**
   * The answer to "do you agree with the Core Ideals?", null if never asked. Kept for a later roll criterion: voting on
   * the platform and the party's structure may be limited to those who answered Yes (design §5.2, §6.3).
   */
  readonly agreesWithCoreIdeals: boolean | null;
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
  /**
   * `YYYY-MM-DD`, or null when the form did not ask for it or it was left out. Only on the application, for the
   * Membership Admin's review; never copied to the member.
   */
  readonly dateOfBirth: string | null;
  /**
   * What the applicant confirmed: the minimum age in force when they applied. Applications made before the Core Ideals
   * question also confirmed support for the platform, which is no longer asked.
   */
  readonly attestations: { readonly minimumAge: number; readonly supportsPlatform?: true };
  /** The version of the registration form's wording they answered (design §5.2); absent on older applications. */
  readonly formVersion?: number;
  /** Eligible to vote in any United States elections (Yes: a United States Member; No: an Allied Member). */
  readonly usVoteEligible?: boolean;
  /** Agrees with the Core Ideals listed on the form. */
  readonly agreesWithCoreIdeals?: boolean;
  /** ISO 3166-1 alpha-2 code; absent on applications made before it was asked, which are all from the United States. */
  readonly country?: string;
  /** In the US, the state or territory code; null elsewhere. */
  readonly state: string | null;
  /** Outside the US, the state, province or county as given, or null. */
  readonly region?: string | null;
  readonly contact: MemberContact;
  readonly communications: CommunicationConsents;
  readonly statement: string | null;
  readonly interests: string | null;
  readonly skills: string | null;
  readonly volunteer: boolean;
  readonly runForOffice: boolean;
  /** How they heard about USTP. */
  readonly referral: string | null;
  /** The member whose referral link they came by (design §5.18); null or absent when none. */
  readonly referredBy?: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
}

/** `GET /v1/admin/members/{accountId}`: one member as a Membership Admin sees them (design §5.2). */
export interface MemberDetail {
  readonly member: MemberRecord;
  /** Every application the account made, newest first, with all its answers. */
  readonly applications: readonly ApplicationRecord[];
  /** Status history, newest first. */
  readonly history: readonly StatusHistoryRecord[];
  /** The account's display choices, so a Membership Admin sees whether the daily quote and joke is on (design §4.1). */
  readonly preferences: AccountPreferences;
  /**
   * For a member a Membership Admin added (design §5.13): when, by whom, when they first signed in (null until then),
   * and how their latest welcome email went: the site's own, or Identity Platform's sign-in link (`via`), which is
   * recorded only since 2026-11-08 (null when none is). Null for everyone who registered themselves.
   */
  readonly added: {
    readonly at: string;
    readonly by: string;
    readonly signedInAt: string | null;
    readonly welcome:
      | (Pick<WelcomeEmailRecord, 'status' | 'requestedAt' | 'doneAt' | 'outcome'> & { readonly delivery: MailStatus | null; readonly via: WelcomeVia })
      | null;
  } | null;
}
