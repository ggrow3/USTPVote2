import type { CandidacyContent, CandidacyStage, DistrictKind, ElectionStage, PublicOffice } from 'ustp-domain';
import { STATES } from '../states.js';

/** Wording for candidacies (design §5.8), shared by the Candidates pages, the declaration form and the admin tab. */

/** What the form's office list says, and the title it suggests for the ballot. */
export const OFFICE_CHOICES: Readonly<Record<PublicOffice, { readonly label: string; readonly title: string }>> = {
  us_president: { label: 'President of the United States', title: 'President of the United States' },
  us_senate: { label: 'U.S. Senate', title: 'U.S. Senator' },
  us_house: { label: 'U.S. House of Representatives', title: 'U.S. Representative' },
  statewide: { label: 'Statewide office (Governor, Attorney General…)', title: 'Governor' },
  state_upper: { label: 'State Senate (upper chamber)', title: 'State Senator' },
  state_lower: { label: 'State House or Assembly (lower chamber)', title: 'State Representative' },
  county: { label: 'County office', title: 'County Commissioner' },
  local: { label: 'City or town office', title: 'City Council Member' },
};

/** What the district list is called for each kind, on the form. */
export const DISTRICT_LABELS: Readonly<Record<DistrictKind, string>> = {
  nation: 'Nationwide',
  state: 'Statewide',
  congressional: 'Congressional district',
  state_upper: 'State Senate district',
  state_lower: 'State House district',
  county: 'County',
  place: 'City or town',
};

export const STAGE_LABELS: Readonly<Record<ElectionStage, string>> = {
  primary: 'Primary',
  general: 'General election',
  special: 'Special election',
  runoff: 'Runoff',
};

/** Where a candidacy stands, as its member and the Membership Admins read it. */
export const STATUS_TEXT: Readonly<Record<CandidacyStage, { readonly label: string; readonly color: string; readonly hint: string }>> = {
  waiting: { label: 'Waiting for review', color: 'orange-8', hint: 'A Membership Admin will look at it before it appears on the Candidates page.' },
  declined: { label: 'Changes asked', color: 'negative', hint: 'A Membership Admin asked for changes. Edit it and send it again.' },
  public: { label: 'Public', color: 'positive', hint: 'It is on the Candidates page.' },
  public_change_waiting: {
    label: 'Public · change waiting',
    color: 'positive',
    hint: 'Your change waits for review. Until it is approved, the Candidates page shows the version approved before.',
  },
  public_change_declined: {
    label: 'Public · change declined',
    color: 'orange-8',
    hint: 'A Membership Admin asked for changes to your edit. The Candidates page still shows the version approved before.',
  },
  withdrawn: { label: 'Withdrawn', color: 'grey-7', hint: 'You withdrew it.' },
  removed: { label: 'Taken down', color: 'grey-7', hint: 'A Membership Admin took it down.' },
};

const stateNames = new Map(STATES.map((s) => [s.code, s.name]));

export const stateName = (code: string | null): string => (code === null ? 'United States' : (stateNames.get(code) ?? code));

/** An election day (`YYYY-MM-DD`) as the reader writes it, e.g. "Nov 3, 2026", whatever their time zone. */
export function electionDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** A moment (ISO 8601) as the reader writes its date, e.g. "Oct 27, 2026". */
export const day = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/** Today in the reader's calendar, as `YYYY-MM-DD`. */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** "Congressional District 12, California"; "California" for a statewide office; "United States" for the nation. */
export function districtText(content: Pick<CandidacyContent, 'district'>): string {
  const { district } = content;
  if (district.kind === 'nation' || district.kind === 'state') return stateName(district.state);
  return `${district.name}, ${stateName(district.state)}`;
}

/** "General election · Nov 3, 2026". */
export const electionText = (content: Pick<CandidacyContent, 'election' | 'electionDate'>): string =>
  `${STAGE_LABELS[content.election]} · ${electionDay(content.electionDate)}`;

/** A campaign website without its `https://` and trailing slash, for display. */
export const websiteText = (url: string): string => url.replace(/^https:\/\//, '').replace(/\/$/, '');
