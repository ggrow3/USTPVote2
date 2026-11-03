import { COUNTRIES, countryName, countryOf, DEFAULT_COUNTRY, type MemberRecord } from 'ustp-domain';
import { STATES } from '../states.js';

/** Wording for members' details (design §5.2), shared by the profile page, the application answers and the account page. */

// The membership questions' answers and the member class, kept apart so the Members list's tests can load them.
export { answerText, CLASS_NOT_ASKED, classOf, MEMBER_CLASS_LABELS, memberClassText } from './class-text.js';

/** The state picker's options, as on the application. */
export const STATE_OPTIONS = STATES.map((s) => ({ label: `${s.name} (${s.code})`, value: s.code }));

/** The country picker's options: the United States first, then the rest by name. */
export const COUNTRY_OPTIONS = [
  { label: countryName(DEFAULT_COUNTRY), value: DEFAULT_COUNTRY },
  ...COUNTRIES.filter((c) => c.code !== DEFAULT_COUNTRY)
    .map((c) => ({ label: c.name, value: c.code }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en')),
];

/** "New York (NY)". */
export function stateName(code: string): string {
  const state = STATES.find((s) => s.code === code);
  return state ? `${state.name} (${state.code})` : code;
}

/** An email opt-in: "Yes, since 25 Oct 2026", or "No". */
export function consentText(since: string | null | undefined): string {
  return since ? `Yes, since ${new Date(since).toLocaleDateString()}` : 'No';
}

/** One line of where someone lives, as a profile lists it; `value` is null when nothing was given. */
export interface PlaceFact {
  readonly label: string;
  readonly value: string | null;
}

/**
 * Where someone lives, as the profile, the account page and the application answers list it: the country, then in the
 * United States the state, city and ZIP code, and elsewhere the state, province or region, city and postcode.
 */
export function placeFacts(record: Pick<MemberRecord, 'country' | 'state' | 'region' | 'contact'>): PlaceFact[] {
  const country = countryOf(record);
  const us = country === DEFAULT_COUNTRY;
  return [
    { label: 'Country', value: countryName(country) },
    us
      ? { label: 'State or territory', value: record.state ? stateName(record.state) : null }
      : { label: 'State, province or region', value: record.region ?? null },
    { label: 'City', value: record.contact?.city ?? null },
    { label: us ? 'ZIP code' : 'Postcode', value: record.contact?.postalCode ?? null },
  ];
}

/** The city, region and ZIP code or postcode on one line: "San Francisco 94110", "Toronto, Ontario K1A 0B1". */
export function localityText(record: Pick<MemberRecord, 'region' | 'contact'>): string {
  const place = [record.contact?.city, record.region].filter(Boolean).join(', ');
  return [place, record.contact?.postalCode].filter(Boolean).join(' ');
}

/** Where someone lives, as form fields: the application's, and the details forms' after joining. */
export interface PlaceForm {
  country: string;
  /** The US state or territory; not sent elsewhere. */
  state: string | null;
  /** The state, province or region outside the US. */
  region: string;
  city: string;
  postalCode: string;
}

/** Where a member lives and how to reach them, as form fields. */
export interface DetailsForm extends PlaceForm {
  preferredName: string;
  phone: string;
}

/** The form filled in from the member record; empty where nothing was given. */
export function detailsForm(member: MemberRecord): DetailsForm {
  return {
    preferredName: member.preferredName ?? '',
    country: countryOf(member),
    state: member.state,
    region: member.region ?? '',
    city: member.contact?.city ?? '',
    postalCode: member.contact?.postalCode ?? '',
    phone: member.contact?.phone ?? '',
  };
}

/**
 * The place fields as the api takes them: the state in the US and the region elsewhere, each only where it belongs, so
 * a state chosen before switching to another country is not sent.
 */
export function placeInput(place: PlaceForm) {
  const us = place.country === DEFAULT_COUNTRY;
  return {
    country: place.country,
    ...(us ? { state: place.state ?? '' } : { region: place.region }),
    city: place.city,
    postalCode: place.postalCode,
  };
}
