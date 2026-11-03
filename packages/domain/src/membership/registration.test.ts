import { describe, expect, it } from 'vitest';
import { createApplicationSchema } from '../api.js';
import {
  ageOn,
  checkApplicantAge,
  isCalendarDate,
  MINIMUM_MEMBER_AGE,
  normalizePhone,
  normalizePostalCode,
  normalizePostcode,
  staysInTouchByDefault,
} from './registration.js';

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('ages', () => {
  it('counts whole years, turning on the birthday', () => {
    expect(ageOn('2008-06-15', day('2026-06-14'))).toBe(17);
    expect(ageOn('2008-06-15', day('2026-06-15'))).toBe(18);
  });

  it('ages a 29 February birthday on 1 March in common years', () => {
    expect(ageOn('2008-02-29', day('2026-02-28'))).toBe(17);
    expect(ageOn('2008-02-29', day('2026-03-01'))).toBe(18);
  });

  it('accepts only real calendar days', () => {
    expect(isCalendarDate('2000-02-29')).toBe(true);
    expect(isCalendarDate('2001-02-29')).toBe(false);
    expect(isCalendarDate('2000-13-01')).toBe(false);
    expect(isCalendarDate('01/02/2000')).toBe(false);
  });

  it('applies the minimum age and rejects impossible dates', () => {
    const on = day('2026-10-22');
    expect(checkApplicantAge('2008-10-22', on)).toEqual({ ok: true });
    expect(checkApplicantAge('2008-10-23', on)).toMatchObject({ ok: false, reason: expect.stringContaining(String(MINIMUM_MEMBER_AGE)) });
    expect(checkApplicantAge('2027-01-01', on)).toMatchObject({ ok: false, reason: expect.stringMatching(/future/) });
    expect(checkApplicantAge('1850-01-01', on)).toMatchObject({ ok: false });
  });
});

describe('contact formats', () => {
  it('normalizes US and international phone numbers to E.164', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('+15551234567');
    expect(normalizePhone('1 555.123.4567')).toBe('+15551234567');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('+0 123 456 789')).toBeNull();
  });

  it('stores ZIP+4 with a dash', () => {
    expect(normalizePostalCode('94110')).toBe('94110');
    expect(normalizePostalCode('941101234')).toBe('94110-1234');
    expect(normalizePostalCode('94110-1234')).toBe('94110-1234');
  });

  it('stores a postcode outside the US in capitals with single spaces', () => {
    expect(normalizePostcode(' sw1a  1aa ')).toBe('SW1A 1AA');
    expect(normalizePostcode('1010-001')).toBe('1010-001');
  });
});

describe('staying in touch', () => {
  it('starts ticked in the United States only, since a box ticked in advance is no consent under the GDPR', () => {
    expect(staysInTouchByDefault('US')).toBe(true);
    expect(staysInTouchByDefault('DE')).toBe(false);
    expect(staysInTouchByDefault('CA')).toBe(false);
  });
});

describe('createApplicationSchema', () => {
  const valid = {
    bylawsVersion: '2026.1',
    bylawsHash: 'a'.repeat(64),
    legalName: 'Robin Applicant',
    dateOfBirth: '1990-04-01',
    attestsAge: true,
    formVersion: 0,
    usVoteEligible: true,
    agreesWithCoreIdeals: true,
    state: 'CA',
    city: 'San Francisco',
    postalCode: '94110',
  };
  const issues = (input: object) => createApplicationSchema.safeParse(input).error?.issues ?? [];
  const paths = (input: object) => issues(input).map((i) => i.path.join('.'));

  it('accepts a complete application with only the required fields', () => {
    expect(createApplicationSchema.safeParse(valid).success).toBe(true);
  });

  it('requires the age attestation, the form version, a ZIP code and an adult date of birth', () => {
    expect(paths({ ...valid, attestsAge: false })).toContain('attestsAge');
    expect(paths({ ...valid, formVersion: undefined })).toContain('formVersion');
    expect(paths({ ...valid, postalCode: '9411' })).toContain('postalCode');
    expect(paths({ ...valid, dateOfBirth: `${new Date().getUTCFullYear() - 10}-01-01` })).toContain('dateOfBirth');
    expect(paths({ ...valid, phone: '123' })).toContain('phone');
  });

  it('takes the United States when no country is given', () => {
    expect(createApplicationSchema.parse(valid).country).toBe('US');
  });

  it('needs a state, city and ZIP code in the United States, and says which are missing', () => {
    expect(paths({ ...valid, state: '', city: ' ', postalCode: undefined })).toEqual(['state', 'city', 'postalCode']);
    expect(paths({ ...valid, country: 'US', state: 'California' })).toEqual(['state']);
    expect(paths({ ...valid, legalName: '', state: undefined })).toEqual(['legalName', 'state']);
  });

  it('needs none of them elsewhere, and a postcode given must look like one', () => {
    const elsewhere = { ...valid, country: 'GB', state: undefined, city: undefined, postalCode: undefined };
    expect(createApplicationSchema.safeParse(elsewhere).success).toBe(true);
    expect(createApplicationSchema.safeParse({ ...elsewhere, region: 'Greater London', city: 'London', postalCode: 'sw1a 1aa' }).success).toBe(true);
    expect(paths({ ...elsewhere, postalCode: 'SW1A/1AA' })).toEqual(['postalCode']);
    expect(paths({ ...elsewhere, region: 'x'.repeat(101) })).toEqual(['region']);
  });

  it('knows the countries, and takes the US territories as states of the United States', () => {
    expect(paths({ ...valid, country: 'ZZ' })).toEqual(['country']);
    expect(paths({ ...valid, country: 'PR', state: undefined })).toEqual(['country']);
    expect(createApplicationSchema.safeParse({ ...valid, state: 'PR', postalCode: '00901' }).success).toBe(true);
  });

  it('needs Yes or No to both membership questions, and accepts No to either', () => {
    for (const question of ['usVoteEligible', 'agreesWithCoreIdeals'] as const) {
      expect(issues({ ...valid, [question]: undefined })).toEqual([
        expect.objectContaining({ path: [question], message: 'answer Yes or No' }),
      ]);
    }
    expect(createApplicationSchema.safeParse({ ...valid, usVoteEligible: false, agreesWithCoreIdeals: false }).success).toBe(true);
  });

  it('refuses fields it does not know, including the platform attestation it no longer asks for', () => {
    expect(createApplicationSchema.safeParse({ ...valid, street: '1 Main St' }).success).toBe(false);
    expect(createApplicationSchema.safeParse({ ...valid, supportsPlatform: true }).success).toBe(false);
  });
});
