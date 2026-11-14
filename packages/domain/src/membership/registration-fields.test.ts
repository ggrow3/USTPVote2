import { describe, expect, it } from 'vitest';
import { applicationSchema, memberDetailsSchemaFor } from '../api.js';
import {
  applicationFieldProblems,
  askedAnswers,
  DEFAULT_PLACE_RULES,
  DEFAULT_REGISTRATION_FIELDS,
  detailsPlaceRules,
  LENIENT_REGISTRATION_FIELDS,
  placeProblems,
  REGISTRATION_FIELD_CHOICES,
  REGISTRATION_FIELDS,
  registrationFieldChanges,
  resolveRegistrationFields,
  type RegistrationFormFields,
} from './registration-fields.js';

const set = (change: Partial<RegistrationFormFields>): RegistrationFormFields => ({ ...DEFAULT_REGISTRATION_FIELDS, ...change });
const NOW = new Date('2026-11-13T00:00:00Z');
const paths = (problems: readonly { path: string }[]) => problems.map((p) => p.path);

describe('the fields the application asks', () => {
  it('start as the form was before they could be set: the place needed in the US, the rest optional', () => {
    expect(DEFAULT_REGISTRATION_FIELDS).toMatchObject({ dateOfBirth: 'required', country: 'required', state: 'required', city: 'required', postalCode: 'required' });
    expect(REGISTRATION_FIELDS.filter((f) => DEFAULT_REGISTRATION_FIELDS[f] === 'optional')).toEqual([
      'preferredName',
      'phone',
      'statement',
      'interests',
      'skills',
      'referral',
      'volunteer',
      'runForOffice',
      'keepInTouch',
    ]);
    for (const field of REGISTRATION_FIELDS) expect(REGISTRATION_FIELD_CHOICES[field]).toContain(DEFAULT_REGISTRATION_FIELDS[field]);
  });

  it('take each field its own choices: a country is asked or not, and a box is never required', () => {
    expect(REGISTRATION_FIELD_CHOICES.country).toEqual(['required', 'hidden']);
    expect(REGISTRATION_FIELD_CHOICES.keepInTouch).toEqual(['optional', 'hidden']);
    expect(REGISTRATION_FIELD_CHOICES.city).toEqual(['required', 'optional', 'hidden']);
  });

  it('fall back to the default for anything missing, unknown or not allowed', () => {
    expect(resolveRegistrationFields(undefined)).toEqual(DEFAULT_REGISTRATION_FIELDS);
    expect(resolveRegistrationFields('hidden')).toEqual(DEFAULT_REGISTRATION_FIELDS);
    expect(resolveRegistrationFields({ city: 'hidden', country: 'optional', volunteer: 'required', phone: 'gone', extra: 'hidden' })).toEqual(
      set({ city: 'hidden' }),
    );
  });

  it('list only the fields set differently', () => {
    expect(registrationFieldChanges(DEFAULT_REGISTRATION_FIELDS, set({ city: 'optional', phone: 'hidden' }))).toEqual({ city: 'optional', phone: 'hidden' });
    expect(registrationFieldChanges(DEFAULT_REGISTRATION_FIELDS, set({}))).toEqual({});
  });
});

describe('where someone lives', () => {
  it('needs in the United States what is required, and nothing that is optional', () => {
    expect(paths(placeProblems({ country: 'US' }, DEFAULT_PLACE_RULES))).toEqual(['state', 'city', 'postalCode']);
    expect(placeProblems({ country: 'US', state: '', city: '', postalCode: '' }, { ...DEFAULT_PLACE_RULES, state: 'optional', city: 'optional', postalCode: 'optional' })).toEqual([]);
    expect(paths(placeProblems({ country: 'US', state: 'CA' }, { ...DEFAULT_PLACE_RULES, city: 'optional' }))).toEqual(['postalCode']);
  });

  it('still checks what is given when it is optional', () => {
    const optional = { ...DEFAULT_PLACE_RULES, state: 'optional', postalCode: 'optional' } as const;
    expect(paths(placeProblems({ country: 'US', state: 'California', city: 'Fresno', postalCode: '9411' }, optional))).toEqual(['state', 'postalCode']);
    expect(paths(placeProblems({ country: 'GB', postalCode: 'SW1A/1AA' }, optional))).toEqual(['postalCode']);
  });

  it('requires nothing elsewhere, whatever is required in the US', () => {
    expect(placeProblems({ country: 'DE' }, DEFAULT_PLACE_RULES)).toEqual([]);
  });

  it('checks nothing of a field that is not shown', () => {
    const hidden = { country: 'required', state: 'hidden', city: 'hidden', postalCode: 'hidden' } as const;
    expect(placeProblems({ country: 'US', state: 'nowhere', postalCode: 'x' }, hidden)).toEqual([]);
  });

  it('takes everyone to live in the United States when the country is not asked', () => {
    expect(paths(placeProblems({ country: 'DE' }, { ...DEFAULT_PLACE_RULES, country: 'hidden' }))).toEqual(['state', 'city', 'postalCode']);
  });

  it("holds a member's later details to what the application requires, and asks the rest as optional", () => {
    expect(detailsPlaceRules({ country: 'hidden', state: 'required', city: 'optional', postalCode: 'hidden' })).toEqual({
      country: 'required',
      state: 'required',
      city: 'optional',
      postalCode: 'optional',
    });
    const schema = memberDetailsSchemaFor(detailsPlaceRules({ ...DEFAULT_PLACE_RULES, city: 'hidden', postalCode: 'optional' }));
    expect(schema.safeParse({ state: 'CA', newsletter: false, announcements: false }).success).toBe(true);
    expect(schema.safeParse({ newsletter: false, announcements: false }).success).toBe(false);
  });
});

describe('an application under the settings', () => {
  const answers = { country: 'US', state: 'CA', city: 'Oakland', postalCode: '94612', dateOfBirth: '1990-04-01' };

  it('needs each required field, in the order of the form', () => {
    const all = set({ preferredName: 'required', phone: 'required', statement: 'required', interests: 'required', skills: 'required', referral: 'required' });
    expect(paths(applicationFieldProblems({ country: 'US' }, all, NOW))).toEqual([
      'preferredName',
      'dateOfBirth',
      'state',
      'city',
      'postalCode',
      'phone',
      'statement',
      'interests',
      'skills',
      'referral',
    ]);
    expect(applicationFieldProblems(answers, DEFAULT_REGISTRATION_FIELDS, NOW)).toEqual([]);
  });

  it('takes an optional date of birth left out, but a date given must be a real one of an adult', () => {
    const optional = set({ dateOfBirth: 'optional' });
    expect(applicationFieldProblems({ ...answers, dateOfBirth: undefined }, optional, NOW)).toEqual([]);
    expect(paths(applicationFieldProblems({ ...answers, dateOfBirth: '1990-02-30' }, optional, NOW))).toEqual(['dateOfBirth']);
    expect(paths(applicationFieldProblems({ ...answers, dateOfBirth: '2016-01-01' }, optional, NOW))).toEqual(['dateOfBirth']);
    expect(applicationFieldProblems({ ...answers, dateOfBirth: 'whenever' }, set({ dateOfBirth: 'hidden' }), NOW)).toEqual([]);
  });

  it('is what the schema for those settings checks', () => {
    const base = { bylawsVersion: '2026.1', bylawsHash: 'a'.repeat(64), legalName: 'Robin Applicant', attestsAge: true, formVersion: 2, usVoteEligible: true, agreesWithCoreIdeals: true };
    const bare = applicationSchema(set({ dateOfBirth: 'hidden', state: 'hidden', city: 'hidden', postalCode: 'hidden' }));
    expect(bare.safeParse(base).success).toBe(true);
    expect(applicationSchema(set({ phone: 'required' })).safeParse({ ...base, ...answers }).error?.issues).toEqual([
      expect.objectContaining({ path: ['phone'], message: 'enter your phone number' }),
    ]);
    expect(applicationSchema(LENIENT_REGISTRATION_FIELDS).safeParse(base).success).toBe(true);
  });

  it('keeps nothing the form does not show, whatever was sent', () => {
    const sent = { ...answers, country: 'DE', region: 'Berlin', preferredName: 'Rob', phone: '+49 30 1234567', volunteer: true, runForOffice: true, newsletter: true, announcements: true, legalName: 'Robin' };
    expect(askedAnswers(sent, DEFAULT_REGISTRATION_FIELDS)).toEqual(sent);
    expect(
      askedAnswers(sent, set({ country: 'hidden', state: 'hidden', postalCode: 'hidden', dateOfBirth: 'hidden', phone: 'hidden', volunteer: 'hidden', keepInTouch: 'hidden' })),
    ).toEqual({ country: 'US', city: 'Oakland', preferredName: 'Rob', runForOffice: true, legalName: 'Robin' });
  });
});
