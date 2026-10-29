import type {
  AdminCandidacy,
  CandidacyDecisionInput,
  CandidacyInput,
  DistrictBoundary,
  DistrictKind,
  DistrictOption,
  MapsConfig,
  MyCandidacy,
  PublicCandidacy,
} from 'ustp-domain';
import { api } from '../api.js';

/**
 * The candidacies context's API (design §5.8, §12): members' candidacies for public office, their review, and the
 * Census districts and Google Maps key the map needs. The only place its routes are written.
 */

/** Approved candidacies of Active members, upcoming elections first: public. */
export function publicCandidacies(): Promise<PublicCandidacy[]> {
  return api<PublicCandidacy[]>('GET', '/v1/public/candidacies');
}

export function publicCandidacy(candidacyId: string): Promise<PublicCandidacy> {
  return api<PublicCandidacy>('GET', `/v1/public/candidacies/${encodeURIComponent(candidacyId)}`);
}

/** The signed-in member's own candidacies, newest first. */
export function myCandidacies(): Promise<MyCandidacy[]> {
  return api<MyCandidacy[]>('GET', '/v1/candidacies/mine');
}

export function declareCandidacy(input: CandidacyInput): Promise<MyCandidacy> {
  return api<MyCandidacy>('POST', '/v1/candidacies', input);
}

/** Sends a change for review; the approved version stays public meanwhile. */
export function changeCandidacy(candidacyId: string, candidacy: CandidacyInput, basedOn: number): Promise<MyCandidacy> {
  return api<MyCandidacy>('PUT', `/v1/candidacies/${encodeURIComponent(candidacyId)}`, { candidacy, basedOn });
}

export function withdrawCandidacy(candidacyId: string): Promise<MyCandidacy> {
  return api<MyCandidacy>('POST', `/v1/candidacies/${encodeURIComponent(candidacyId)}/withdraw`);
}

/** Every candidacy, for Membership Admins. */
export function allCandidacies(): Promise<AdminCandidacy[]> {
  return api<AdminCandidacy[]>('GET', '/v1/admin/candidacies');
}

export function decideCandidacy(candidacyId: string, input: CandidacyDecisionInput): Promise<AdminCandidacy> {
  return api<AdminCandidacy>('POST', `/v1/admin/candidacies/${encodeURIComponent(candidacyId)}/decision`, input);
}

export function removeCandidacy(candidacyId: string, reason: string): Promise<AdminCandidacy> {
  return api<AdminCandidacy>('POST', `/v1/admin/candidacies/${encodeURIComponent(candidacyId)}/remove`, { reason });
}

/** The districts of a kind in a state (none for the nation), from the Census. */
export function districts(kind: DistrictKind, state: string | null): Promise<DistrictOption[]> {
  return api<DistrictOption[]>('GET', `/v1/public/districts?${new URLSearchParams({ kind, ...(state ? { state } : {}) })}`);
}

export function districtBoundary(kind: DistrictKind, geoid: string): Promise<DistrictBoundary> {
  return api<DistrictBoundary>('GET', `/v1/public/districts/${encodeURIComponent(kind)}/${encodeURIComponent(geoid)}/boundary`);
}

export function mapsConfig(): Promise<MapsConfig> {
  return api<MapsConfig>('GET', '/v1/public/maps');
}
