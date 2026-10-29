import type { MemberRecord } from '../membership/records.js';
import type { CandidacyContent, CandidacyRecord } from './candidacy.js';
import type { District } from './districts.js';

/**
 * What the API shows of candidacies (design §5.8, §12): to everyone, the published version of each open candidacy whose
 * member is still Active; to the member, all of theirs with where each stands; to Membership Admins, every one.
 */

/** Where a candidacy stands, as the member and the Membership Admins see it. */
export type CandidacyStage =
  /** Sent, never approved yet. */
  | 'waiting'
  /** Never approved; the last version sent was declined. */
  | 'declined'
  /** Public, nothing waiting. */
  | 'public'
  /** Public, and a change is waiting for review. */
  | 'public_change_waiting'
  /** Public; the change sent was declined, so the published version stays. */
  | 'public_change_declined'
  | 'withdrawn'
  | 'removed';

export function candidacyStage(record: CandidacyRecord): CandidacyStage {
  if (record.status !== 'open') return record.status;
  if (!record.published) return record.declined ? 'declined' : 'waiting';
  if (!record.proposed) return 'public';
  return record.declined ? 'public_change_declined' : 'public_change_waiting';
}

/** Whether a Membership Admin has something to decide on it. */
export const awaitingReview = (record: CandidacyRecord) => record.status === 'open' && record.proposed !== null && record.declined === null;

/** The candidate's name as the public sees it: their preferred name, else their legal name. */
export function candidateName(member: Pick<MemberRecord, 'legalName' | 'preferredName'> | null): string {
  return member ? (member.preferredName ?? member.legalName) : 'Unknown member';
}

/** `GET /v1/public/candidacies`: one candidacy on the Candidates page. */
export interface PublicCandidacy extends CandidacyContent {
  readonly candidacyId: string;
  readonly name: string;
  /** When this version was approved. */
  readonly publishedAt: string;
}

/** A candidacy the public may see: open, approved, and its member still Active. */
export function publicCandidacy(record: CandidacyRecord, member: Pick<MemberRecord, 'legalName' | 'preferredName' | 'status'> | null): PublicCandidacy | null {
  if (!record.public || record.status !== 'open' || !record.published || member?.status !== 'active') return null;
  return { ...record.published, candidacyId: record.candidacyId, name: candidateName(member), publishedAt: record.publishedAt ?? record.updatedAt };
}

/** Upcoming elections first, soonest first, then past ones, latest first; ties by state, office and name. */
export function comparePublicCandidacies(today: string) {
  return (a: PublicCandidacy, b: PublicCandidacy): number => {
    const pastA = a.electionDate < today;
    const pastB = b.electionDate < today;
    if (pastA !== pastB) return pastA ? 1 : -1;
    const byDate = pastA ? b.electionDate.localeCompare(a.electionDate) : a.electionDate.localeCompare(b.electionDate);
    return (
      byDate ||
      (a.district.state ?? '').localeCompare(b.district.state ?? '') ||
      a.officeTitle.localeCompare(b.officeTitle) ||
      a.name.localeCompare(b.name)
    );
  };
}

/** `GET /v1/candidacies/mine`: the member's own candidacy and where it stands, the declined note included. */
export interface MyCandidacy extends CandidacyRecord {
  readonly stage: CandidacyStage;
}

export const myCandidacy = (record: CandidacyRecord): MyCandidacy => ({ ...record, stage: candidacyStage(record) });

/** `GET /v1/admin/candidacies`: a candidacy with who the member is, for Membership Admins. */
export interface AdminCandidacy extends MyCandidacy {
  readonly name: string;
  /** Their member status now; a candidacy is shown only while they are Active. */
  readonly memberStatus: MemberRecord['status'] | null;
  /** The state on their member record, to compare with the district's. */
  readonly memberState: string | null;
}

export function adminCandidacy(record: CandidacyRecord, member: Pick<MemberRecord, 'legalName' | 'preferredName' | 'status' | 'state'> | null): AdminCandidacy {
  return { ...myCandidacy(record), name: candidateName(member), memberStatus: member?.status ?? null, memberState: member?.state ?? null };
}

/** Waiting for review first (oldest first), then the rest, most recently changed first. */
export function compareAdminCandidacies(a: AdminCandidacy, b: AdminCandidacy): number {
  const waitingA = awaitingReview(a);
  const waitingB = awaitingReview(b);
  if (waitingA !== waitingB) return waitingA ? -1 : 1;
  return waitingA ? (a.proposedAt ?? '').localeCompare(b.proposedAt ?? '') : b.updatedAt.localeCompare(a.updatedAt);
}

/** `GET /v1/public/maps`: the browser key for Google Maps, or null where the map is not set up. */
export interface MapsConfig {
  readonly googleMapsKey: string | null;
}

/** `GET /v1/public/districts`: the districts of a kind in a state, for the declaration form's list. */
export type DistrictOption = District;

/** `GET /v1/public/districts/{kind}/{geoid}/boundary`: a GeoJSON FeatureCollection of the district's outline. */
export interface DistrictBoundary {
  readonly type: 'FeatureCollection';
  readonly features: readonly {
    readonly type: 'Feature';
    readonly geometry: { readonly type: 'Polygon' | 'MultiPolygon'; readonly coordinates: unknown };
    readonly properties: Readonly<Record<string, unknown>>;
  }[];
}
