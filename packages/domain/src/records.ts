import type { TwoPersonAction } from './approvals.js';
import type { SignInProvider } from './identity.js';
import type { MemberStatus } from './member-status.js';
import type { PhotoSignals } from './photos.js';
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
}

/** `account_identities/{uid}` */
export interface IdentityRecord {
  readonly uid: string;
  readonly accountId: string;
  readonly provider: SignInProvider;
  readonly email: string | null;
  readonly linkedAt: string;
}

/** `members/{accountId}` */
export interface MemberRecord {
  readonly accountId: string;
  readonly status: MemberStatus;
  readonly legalName: string;
  readonly preferredName: string | null;
  /** Two-letter state code; the street address is never stored (design §5.2). */
  readonly state: string;
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
  readonly state: string;
  readonly statement: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
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
}

/** `role_assignments/{accountId}_{role}` */
export interface RoleAssignmentRecord {
  readonly accountId: string;
  readonly role: Role;
  readonly grantedAt: string;
  /** Requester's accountId, or `bootstrap`. */
  readonly grantedBy: string;
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
    /** This caller's admin routes need a multi-factor sign-in (they hold a role and the policy is on). */
    readonly required: boolean;
    /** The current ID token was issued after a second factor. */
    readonly signedInWithMfa: boolean;
  };
}

/** `sign_in_methods/{provider}`; a missing document means enabled. */
export interface SignInMethodRecord {
  readonly provider: SignInProvider;
  readonly enabled: boolean;
  readonly updatedAt: string;
  readonly updatedBy: string;
}
