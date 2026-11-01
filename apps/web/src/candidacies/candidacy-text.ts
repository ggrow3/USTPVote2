import type {
  AreaBasis,
  AreaContact,
  CandidacyContent,
  CandidacyStage,
  CandidateArea,
  ContactFeed,
  ContactFeedState,
  ContactSource,
  District,
  DistrictKind,
  ElectionStage,
  PublicOffice,
} from 'ustp-domain';
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
export function districtText(content: { readonly district: Pick<District, 'kind' | 'state' | 'name'> }): string {
  const { district } = content;
  if (district.kind === 'nation' || district.kind === 'state') return stateName(district.state);
  return `${district.name}, ${stateName(district.state)}`;
}

/** "General election · Nov 3, 2026". */
export const electionText = (content: Pick<CandidacyContent, 'election' | 'electionDate'>): string =>
  `${STAGE_LABELS[content.election]} · ${electionDay(content.electionDate)}`;

/** A campaign website without its `https://` and trailing slash, for display. */
export const websiteText = (url: string): string => url.replace(/^https:\/\//, '').replace(/\/$/, '');

/**
 * What the Candidates page says about the member's area: which races it holds and where it comes from, and what the
 * link to the Account page, where the ZIP code is changed, says (none when changing it would not help). Never the ZIP
 * code itself.
 */
export function areaText(area: Pick<CandidateArea, 'state' | 'basis'>): { readonly text: string; readonly link: string | null } {
  const state = stateName(area.state);
  const whole: Readonly<Record<Exclude<AreaBasis, 'zip'>, { readonly why: string; readonly link: string | null }>> = {
    no_zip: { why: 'your membership record has no ZIP code.', link: 'Add it on your Account page to see only your own districts.' },
    unplaced: {
      why: `the Census draws no area for the ZIP code on your membership record in ${state} (a PO box’s ZIP code has none).`,
      link: 'Check it on your Account page.',
    },
    unavailable: { why: 'the Census Bureau’s district lookup is not answering, so your districts could not be worked out. Try again later.', link: null },
  };
  if (area.basis !== 'zip') return { text: `Nationwide offices and all of ${state}: ${whole[area.basis].why}`, link: whole[area.basis].link };
  return {
    text:
      `Nationwide and ${state} offices, and the districts the ZIP code on your membership record reaches into. ` +
      'A ZIP code can reach into more than one district of a kind, so some races here may not be on your own ballot.',
    link: 'Moved? Change your ZIP code on your Account page.',
  };
}

/** Each office's heading on the Your area page. */
export const OFFICE_HEADINGS: Readonly<Record<PublicOffice, string>> = {
  us_president: 'President',
  us_senate: 'U.S. Senate',
  us_house: 'U.S. House of Representatives',
  statewide: 'Statewide offices',
  state_upper: 'State Senate',
  state_lower: 'State House or Assembly',
  county: 'County offices',
  local: 'City or town offices',
};

/** Where a person on the Your area page comes from. */
export const CONTACT_SOURCE_TEXT: Readonly<Record<ContactSource, string>> = {
  fec: 'Filed with the FEC',
  congress: 'Member of Congress',
  openstates: 'From Open States',
  admin: 'Added by the party',
};

/** What the Your area page says when a public record is missing; nothing when it answered. */
export function feedNote(feed: ContactFeed, state: ContactFeedState): string | null {
  if (state === 'ok') return null;
  if (feed === 'openstates' && state === 'off') return 'State legislators are not listed yet: this site is not connected to Open States.';
  const what: Readonly<Record<ContactFeed, string>> = {
    fec: 'The FEC’s candidate lists',
    congress: 'The list of members of Congress',
    openstates: 'Open States, which lists state legislators,',
  };
  return `${what[feed]} did not answer, so some people are missing here. Try again later.`;
}

/** A link that opens the member's own email app with the email filled in. */
export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** A district's pin on the Your area map: who is in office there and who is running, by name. */
export function districtPeopleText(contacts: readonly Pick<AreaContact, 'role' | 'name' | 'district'>[], district: Pick<District, 'kind' | 'geoid'>): string {
  const here = contacts.filter((c) => c.district.kind === district.kind && c.district.geoid === district.geoid);
  const names = (role: AreaContact['role']) => [...new Set(here.filter((c) => c.role === role).map((c) => c.name))].join(', ');
  const parts = [names('holder') && `In office: ${names('holder')}`, names('candidate') && `Running: ${names('candidate')}`].filter(Boolean);
  return parts.join(' · ') || 'No one is listed here yet.';
}
