import { COUNTRY_CODES, countryName, type MemberRecord } from 'ustp-domain';
import { STATES } from '../forms.js';

/** Wording for members' details (design §5.2), shared by the profile page, the application answers and the account page. */

// The membership questions' answers and the member class, kept apart so the Members list's tests can load them.
export { answerText, CLASS_NOT_ASKED, classOf, MEMBER_CLASS_LABELS, memberClassText } from './class-text.js';

/** The state picker's options, as on the application. */
export const STATE_OPTIONS = STATES.map((s) => ({ label: `${s.name} (${s.code})`, value: s.code }));

/** "New York (NY)". */
export function stateName(code: string): string {
  const state = STATES.find((s) => s.code === code);
  return state ? `${state.name} (${state.code})` : code;
}

/** Countries a member may live in outside the US (design §5.13), by English name. */
export const COUNTRY_OPTIONS = COUNTRY_CODES.filter((c) => c !== 'US')
  .map((code) => ({ label: countryName(code), value: code }))
  .sort((a, b) => a.label.localeCompare(b.label));

/** Where a member lives: "New York (NY)", or "Germany" for a member abroad, with any state they gave. */
export function placeText(member: Pick<MemberRecord, 'state' | 'country'>): string {
  if (!member.country) return stateName(member.state);
  return member.state ? `${countryName(member.country)} (state: ${stateName(member.state)})` : countryName(member.country);
}

/** An email opt-in: "Yes, since 25 Oct 2026", or "No". */
export function consentText(since: string | null | undefined): string {
  return since ? `Yes, since ${new Date(since).toLocaleDateString()}` : 'No';
}

/** Where a member lives and how to reach them, as form fields. */
export interface DetailsForm {
  preferredName: string;
  state: string | null;
  /** The country of a member living outside the US; null in the US. */
  country: string | null;
  city: string;
  postalCode: string;
  phone: string;
}

/** The form filled in from the member record; empty where nothing was given. */
export function detailsForm(member: MemberRecord): DetailsForm {
  return {
    preferredName: member.preferredName ?? '',
    state: member.state || null,
    country: member.country ?? null,
    city: member.contact?.city ?? '',
    postalCode: member.contact?.postalCode ?? '',
    phone: member.contact?.phone ?? '',
  };
}
