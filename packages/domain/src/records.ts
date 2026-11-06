import type { TwoPersonAction } from './approvals.js';
import type { AccountPreferences } from './daily.js';
import type { SignInProvider } from './identity.js';
import type { MemberRecord } from './membership/records.js';
import type { MemberStatus } from './membership/member-status.js';
import type { PhotoSignals } from './photos.js';
import type { MyMailState } from './notifications/my-email.js';
import type { Role } from './roles.js';

/**
 * Firestore document shapes (design §11). Timestamps are ISO 8601 strings from the server clock: they sort
 * lexically, survive JSON unchanged and can be hashed with JCS.
 */

export interface AccountRecord {
  readonly accountId: string;
  readonly displayName: string | null;
  readonly primaryEmail: string | null;
  readonly emailVerified: boolean;
  readonly createdAt: string;
  /** The person's own display choices (design §4.1); absent until they make one, so read it with `preferencesOf`. */
  readonly preferences?: AccountPreferences;
  /**
   * Set when a Membership Admin added the account as a member (design §5.13), before it had any login: when, and by
   * whom. Absent on accounts made by signing in.
   */
  readonly addedAt?: string;
  readonly addedBy?: string;
  /**
   * When an added account got its first login: someone signed in with a verified address equal to `primaryEmail`
   * (design §4). Null until then; absent on accounts made by signing in.
   */
  readonly claimedAt?: string | null;
}

/** `account_identities/{uid}` */
export interface IdentityRecord {
  readonly uid: string;
  readonly accountId: string;
  readonly provider: SignInProvider;
  readonly email: string | null;
  readonly linkedAt: string;
}

/** `bylaws_versions/{version}` — immutable. */
export interface BylawsRecord {
  readonly version: string;
  readonly title: string;
  readonly text: string;
  /** SHA-256 of the UTF-8 text, lowercase hex. */
  readonly contentHash: string;
  readonly publishedAt: string;
  readonly publishedBy: string;
  /** The version this one was drafted from, or null for a first version (absent on versions before amendments). */
  readonly amends?: string | null;
  /** What changed and why, as the publisher wrote it. */
  readonly changeNote?: string | null;
  /** When the text is what an election's passed amendments gave (design §6.6): that election and its results. */
  readonly adoptedIn?: { readonly electionId: string; readonly resultsHash: string } | null;
}

/** `GET /v1/bylaws`: every version without its text, newest first. */
export type BylawsVersionSummary = Omit<BylawsRecord, 'text'>;

/** `role_assignments/{accountId}_{role}` */
export interface RoleAssignmentRecord {
  readonly accountId: string;
  readonly role: Role;
  readonly grantedAt: string;
  /** The System Admin who granted it, or `bootstrap`. */
  readonly grantedBy: string;
  /** Set only for grants made through a two-person request, before role changes needed one admin (design §10.2). */
  readonly approvedBy: string | null;
  readonly approvalId: string | null;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
}

export type ApprovalStatus = 'pending' | 'rejected' | 'executed';

/** `approval_requests/{id}` — two-person rule (design §10.2). */
export interface ApprovalRequestRecord {
  readonly id: string;
  readonly action: TwoPersonAction;
  /** The account (or other entity) the action affects. Neither requester nor approver may be it. */
  readonly subject: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadHash: string;
  readonly reason: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly approverRole: Role;
  readonly status: ApprovalStatus;
  readonly expiresAt: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
}

/**
 * `profile_photos/{photoId}`. `accepted`: passed the automatic check or accepted by an admin. `needs_review`: flagged
 * for a Membership Admin. `rejected`: rejected by an admin, with a reason. `superseded`: replaced or removed by the
 * member. The image itself is deleted once a photo is rejected or superseded.
 */
export interface ProfilePhotoRecord {
  readonly photoId: string;
  readonly accountId: string;
  readonly status: 'accepted' | 'needs_review' | 'rejected' | 'superseded';
  /** Object path in the photos bucket; null once the image has been deleted. */
  readonly storagePath: string | null;
  readonly width: number;
  readonly height: number;
  readonly uploadedAt: string;
  readonly checkId: string;
  /** Reasons the automatic check flagged it (empty if it passed). */
  readonly flags: readonly string[];
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
}

/** `photo_checks/{checkId}` — immutable. */
export interface PhotoCheckRecord {
  readonly checkId: string;
  readonly photoId: string;
  /** `vision` in real projects; `local` is the emulator-only stand-in. */
  readonly checker: 'vision' | 'local';
  readonly signals: PhotoSignals;
  readonly verdict: 'pass' | 'flag';
  readonly reasons: readonly string[];
  readonly checkedAt: string;
}

/** `GET /v1/me` */
export interface MeResponse {
  readonly account: AccountRecord | null;
  readonly identities: readonly IdentityRecord[];
  readonly member: MemberRecord | null;
  readonly roles: readonly Role[];
  readonly mfa: {
    /**
     * This caller needs a multi-factor sign-in for something: they hold a role, or the member requirement is on
     * (design §4). False everywhere when the deployment switches MFA off (emulators only).
     */
    readonly required: boolean;
    /**
     * They need it for every signed-in route but this one and creating their account: System Admins always, everyone
     * while the member requirement is on (`secondFactorScope` is `everywhere`).
     */
    readonly everywhere: boolean;
    /** The current ID token was issued after a second factor. */
    readonly signedInWithMfa: boolean;
  };
  /** Testing mode (design §10.4). */
  readonly testing: {
    /** This deployment lets System Admins act as test personas. */
    readonly enabled: boolean;
    /** When this request was made as a persona, the System Admin acting as it; otherwise null. */
    readonly operator: string | null;
  };
  /** Whether the caller's address can be mailed (design §10.12); null without an account. */
  readonly mail: MyMailState | null;
}

/**
 * `GET /v1/admin/accounts`: one row of the System Admins' People list (design §10.3). Only what finding someone and
 * changing their roles needs: no legal name, state, logins or photo.
 */
export interface AccountSummary {
  readonly accountId: string;
  readonly displayName: string | null;
  readonly primaryEmail: string | null;
  readonly emailVerified: boolean;
  readonly createdAt: string;
  /** Null for accounts that never applied for membership. */
  readonly memberStatus: MemberStatus | null;
  /** Active roles, from `role_assignments`. */
  readonly roles: readonly Role[];
  /** The primary email is on the deployment's `DELETABLE_ACCOUNT_EMAILS`, so a System Admin may delete it (design §4). */
  readonly onDeletionList: boolean;
}

/** `sign_in_methods/{provider}`; a missing document means enabled. */
export interface SignInMethodRecord {
  readonly provider: SignInProvider;
  readonly enabled: boolean;
  readonly updatedAt: string;
  readonly updatedBy: string;
}
