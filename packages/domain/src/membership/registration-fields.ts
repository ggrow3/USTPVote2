import { DEFAULT_COUNTRY } from './countries.js';
import { checkApplicantAge, isCalendarDate, normalizePostcode, POSTCODE, US_POSTAL_CODE } from './registration.js';

/**
 * Which fields the application asks (design §5.2). Membership Admins set each one, with the registration form's
 * wording: required, optional, or not shown at all. The legal name, the bylaws, the age confirmation and the two
 * membership questions are always asked, since rules hang off them.
 */

export const FIELD_SETTINGS = ['required', 'optional', 'hidden'] as const;
export type FieldSetting = (typeof FIELD_SETTINGS)[number];

/** The fields that can be set, in the order the application asks them. */
export const REGISTRATION_FIELDS = [
  'preferredName',
  'dateOfBirth',
  'country',
  'state',
  'city',
  'postalCode',
  'phone',
  'statement',
  'interests',
  'skills',
  'referral',
  'volunteer',
  'runForOffice',
  'keepInTouch',
] as const;
export type RegistrationField = (typeof REGISTRATION_FIELDS)[number];
export type RegistrationFormFields = { readonly [F in RegistrationField]: FieldSetting };

/** A country always has an answer (the United States to start), so it is asked or not. */
const ASKED_OR_NOT = ['required', 'hidden'] as const;
/** A box to tick cannot be required: leaving it unticked is an answer. */
const TICK = ['optional', 'hidden'] as const;

/** What each field may be set to. */
export const REGISTRATION_FIELD_CHOICES: { readonly [F in RegistrationField]: readonly FieldSetting[] } = {
  preferredName: FIELD_SETTINGS,
  dateOfBirth: FIELD_SETTINGS,
  country: ASKED_OR_NOT,
  state: FIELD_SETTINGS,
  city: FIELD_SETTINGS,
  postalCode: FIELD_SETTINGS,
  phone: FIELD_SETTINGS,
  statement: FIELD_SETTINGS,
  interests: FIELD_SETTINGS,
  skills: FIELD_SETTINGS,
  referral: FIELD_SETTINGS,
  volunteer: TICK,
  runForOffice: TICK,
  keepInTouch: TICK,
};

/** The form as it was before fields could be set. */
export const DEFAULT_REGISTRATION_FIELDS: RegistrationFormFields = {
  preferredName: 'optional',
  dateOfBirth: 'required',
  country: 'required',
  state: 'required',
  city: 'required',
  postalCode: 'required',
  phone: 'optional',
  statement: 'optional',
  interests: 'optional',
  skills: 'optional',
  referral: 'optional',
  volunteer: 'optional',
  runForOffice: 'optional',
  keepInTouch: 'optional',
};

/** The settings in force from what was saved: each field's own, or the default for one missing or not allowed. */
export function resolveRegistrationFields(stored: unknown): RegistrationFormFields {
  const saved = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const pick = (field: RegistrationField): FieldSetting => {
    const value = saved[field] as FieldSetting;
    return REGISTRATION_FIELD_CHOICES[field].includes(value) ? value : DEFAULT_REGISTRATION_FIELDS[field];
  };
  return Object.fromEntries(REGISTRATION_FIELDS.map((field) => [field, pick(field)])) as RegistrationFormFields;
}

/** The fields set differently in `after`, each with its new setting. */
export function registrationFieldChanges(before: RegistrationFormFields, after: RegistrationFormFields): Partial<RegistrationFormFields> {
  return Object.fromEntries(REGISTRATION_FIELDS.filter((f) => before[f] !== after[f]).map((f) => [f, after[f]]));
}

/** The settings that decide where someone lives: the application's, and the details forms' after joining. */
export type PlaceRules = Pick<RegistrationFormFields, 'country' | 'state' | 'city' | 'postalCode'>;

export const DEFAULT_PLACE_RULES: PlaceRules = { country: 'required', state: 'required', city: 'required', postalCode: 'required' };

/** Nothing needed: what a request is held to before the settings in force are read. */
export const LENIENT_PLACE_RULES: PlaceRules = { country: 'required', state: 'optional', city: 'optional', postalCode: 'optional' };

/** Every field optional, as a request is checked before the settings in force are read. */
export const LENIENT_REGISTRATION_FIELDS: RegistrationFormFields = {
  ...(Object.fromEntries(REGISTRATION_FIELDS.map((f) => [f, 'optional'])) as RegistrationFormFields),
  country: 'required',
};

/**
 * The rules a member's details are held to after joining (design §5.2): what the application requires is required
 * there too. A field the application does not show can still be filled in later, so there it is optional, and the
 * country is always asked.
 */
export function detailsPlaceRules(fields: PlaceRules): PlaceRules {
  const shown = (setting: FieldSetting): FieldSetting => (setting === 'hidden' ? 'optional' : setting);
  return { country: 'required', state: shown(fields.state), city: shown(fields.city), postalCode: shown(fields.postalCode) };
}

/** A field that cannot be accepted, and why, as a form shows it under the field. */
export interface FieldProblem {
  readonly path: string;
  readonly message: string;
}

export interface PlaceAnswers {
  readonly country: string;
  readonly state?: string | undefined;
  readonly city?: string | undefined;
  readonly postalCode?: string | undefined;
}

/** The country an answer counts for: the one given, or the United States when the country is not asked. */
export function countryAsked(input: Pick<PlaceAnswers, 'country'>, rules: Pick<PlaceRules, 'country'>): string {
  return rules.country === 'hidden' ? DEFAULT_COUNTRY : input.country;
}

/**
 * What is wrong with where someone says they live. "Required" binds in the United States; elsewhere the region, city
 * and postcode stay optional, since not every country has them. Whatever is given must look right: a two-letter state,
 * a 5-digit ZIP code, a postcode of letters and digits. A field not shown is not checked: it is dropped.
 */
export function placeProblems(input: PlaceAnswers, rules: PlaceRules): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const us = countryAsked(input, rules) === DEFAULT_COUNTRY;
  const state = input.state ?? '';
  const postalCode = input.postalCode ?? '';
  if (us && rules.state !== 'hidden' && (state ? !/^[A-Z]{2}$/.test(state) : rules.state === 'required')) {
    problems.push({ path: 'state', message: 'choose your state or territory (two-letter code)' });
  }
  if (us && rules.city === 'required' && !input.city) problems.push({ path: 'city', message: 'enter your city' });
  if (rules.postalCode !== 'hidden') {
    if (us) {
      if (postalCode ? !US_POSTAL_CODE.test(postalCode) : rules.postalCode === 'required') {
        problems.push({ path: 'postalCode', message: 'enter a 5-digit ZIP code' });
      }
    } else if (postalCode && !POSTCODE.test(normalizePostcode(postalCode))) {
      problems.push({ path: 'postalCode', message: 'enter a postcode of letters and digits, with spaces or dashes between them' });
    }
  }
  return problems;
}

/** The application's answers the settings bear on. */
export interface FieldAnswers extends PlaceAnswers {
  readonly preferredName?: string | undefined;
  readonly dateOfBirth?: string | undefined;
  readonly phone?: string | undefined;
  readonly statement?: string | undefined;
  readonly interests?: string | undefined;
  readonly skills?: string | undefined;
  readonly referral?: string | undefined;
}

const NEEDED: readonly (readonly [keyof FieldAnswers & RegistrationField, string])[] = [
  ['phone', 'enter your phone number'],
  ['statement', 'say why you want to join'],
  ['interests', 'name the issues you care most about'],
  ['skills', 'say what skills or experience you could contribute'],
  ['referral', 'say how you heard about USTP'],
];

/**
 * What is wrong with an application's answers under the settings in force, in the form's order: a required field left
 * empty, a date of birth that is no date or too young, a place that does not look right (`placeProblems`).
 */
export function applicationFieldProblems(input: FieldAnswers, fields: RegistrationFormFields, now: Date): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (fields.preferredName === 'required' && !input.preferredName) {
    problems.push({ path: 'preferredName', message: 'enter your preferred name' });
  }
  if (fields.dateOfBirth !== 'hidden') {
    if (!input.dateOfBirth || !isCalendarDate(input.dateOfBirth)) {
      if (input.dateOfBirth || fields.dateOfBirth === 'required') problems.push({ path: 'dateOfBirth', message: 'enter your date of birth' });
    } else {
      const age = checkApplicantAge(input.dateOfBirth, now);
      if (!age.ok) problems.push({ path: 'dateOfBirth', message: age.reason });
    }
  }
  problems.push(...placeProblems(input, fields));
  for (const [field, message] of NEEDED) {
    if (fields[field] === 'required' && !input[field]) problems.push({ path: field, message });
  }
  return problems;
}

/** What `askedAnswers` may drop: the answers the settings bear on, and the boxes. */
type Answers = FieldAnswers & {
  readonly region?: string | undefined;
  readonly volunteer?: boolean | undefined;
  readonly runForOffice?: boolean | undefined;
  readonly newsletter?: boolean | undefined;
  readonly announcements?: boolean | undefined;
};

/**
 * An application's answers with every field that is not shown left out, whatever was sent for it: nothing is kept that
 * the form did not ask. Without the country, everyone is taken to live in the United States.
 */
export function askedAnswers<T extends Answers>(input: T, fields: RegistrationFormFields): T {
  const drop: (keyof Answers)[] = [];
  for (const field of ['preferredName', 'dateOfBirth', 'city', 'postalCode', 'phone', 'statement', 'interests', 'skills', 'referral'] as const) {
    if (fields[field] === 'hidden') drop.push(field);
  }
  if (fields.state === 'hidden') drop.push('state', 'region');
  if (fields.volunteer === 'hidden') drop.push('volunteer');
  if (fields.runForOffice === 'hidden') drop.push('runForOffice');
  if (fields.keepInTouch === 'hidden') drop.push('newsletter', 'announcements');
  const kept: Answers = { ...input, country: countryAsked(input, fields) };
  for (const key of drop) delete (kept as { -readonly [K in keyof Answers]?: Answers[K] })[key];
  return kept as T;
}
