import { describe, expect, it } from 'vitest';
import { createApplicationSchema } from '../api.js';
import {
  ageOn,
  checkApplicantAge,
  isCalendarDate,
  MINIMUM_MEMBER_AGE,
  normalizePhone,
  normalizePostalCode,
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
});

describe('createApplicationSchema', () => {
  const valid = {
    bylawsVersion: '2026.1',
    bylawsHash: 'a'.repeat(64),
    legalName: 'Robin Applicant',
    dateOfBirth: '1990-04-01',
    attestsAge: true,
    supportsPlatform: true,
    state: 'CA',
    city: 'San Francisco',
    postalCode: '94110',
  };

  it('accepts a complete application with only the required fields', () => {
    expect(createApplicationSchema.safeParse(valid).success).toBe(true);
  });

  it('requires both attestations, a ZIP code and an adult date of birth', () => {
    const issues = (input: object) =>
      createApplicationSchema.safeParse(input).error?.issues.map((i) => i.path.join('.')) ?? [];
    expect(issues({ ...valid, attestsAge: false })).toContain('attestsAge');
    expect(issues({ ...valid, supportsPlatform: undefined })).toContain('supportsPlatform');
    expect(issues({ ...valid, postalCode: '9411' })).toContain('postalCode');
    expect(issues({ ...valid, dateOfBirth: `${new Date().getUTCFullYear() - 10}-01-01` })).toContain('dateOfBirth');
    expect(issues({ ...valid, phone: '123' })).toContain('phone');
  });

  it('refuses fields it does not know', () => {
    expect(createApplicationSchema.safeParse({ ...valid, street: '1 Main St' }).success).toBe(false);
  });
});
