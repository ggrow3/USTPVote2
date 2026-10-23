import { deny, OK, type Check } from './check.js';

/**
 * Membership application rules shared by the browser and the api (design §5.2). The minimum age is USTP's call
 * (open question Q17); everything that depends on it reads this constant.
 */
export const MINIMUM_MEMBER_AGE = 18;

/**
 * Applications one account may submit in APPLICATION_WINDOW_DAYS (design §14 "Abuse"). Only one can be pending at a
 * time anyway; this caps reapplying after rejections.
 */
export const MAX_APPLICATIONS_PER_WINDOW = 3;
export const APPLICATION_WINDOW_DAYS = 30;

/** Oldest plausible applicant; older birth dates are typing mistakes. */
const MAXIMUM_AGE = 130;

/** `YYYY-MM-DD` that names a real calendar day. */
export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Whole years between a `YYYY-MM-DD` birth date and `on` (UTC calendar days); someone born on 29 February ages on 1 March. */
export function ageOn(dateOfBirth: string, on: Date): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const ty = on.getUTCFullYear();
  const tm = on.getUTCMonth() + 1;
  const td = on.getUTCDate();
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

/** The applicant is old enough to join on `on`, and the date is neither in the future nor implausibly old. */
export function checkApplicantAge(dateOfBirth: string, on: Date): Check {
  if (!isCalendarDate(dateOfBirth)) return deny('enter your date of birth as YYYY-MM-DD');
  const age = ageOn(dateOfBirth, on);
  if (age < 0) return deny('your date of birth is in the future');
  if (age > MAXIMUM_AGE) return deny('check your date of birth');
  if (age < MINIMUM_MEMBER_AGE) return deny(`members must be at least ${MINIMUM_MEMBER_AGE} years old`);
  return OK;
}

/** US ZIP code: 5 digits, optionally ZIP+4 (with or without the dash). */
export const US_POSTAL_CODE = /^\d{5}(?:-?\d{4})?$/;

/** Stores ZIP+4 as `12345-6789` and a plain ZIP as `12345`. */
export function normalizePostalCode(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 9 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

/**
 * A phone number as E.164 (`+15551234567`), or null if it cannot be one. Ten-digit numbers are taken as US/NANP;
 * anything else must carry its country code. Spaces, dots, dashes and parentheses are ignored.
 */
export function normalizePhone(value: string): string | null {
  const compact = value.trim().replace(/[\s().-]/g, '');
  const e164 = compact.startsWith('+') ? compact : /^\d{10}$/.test(compact) ? `+1${compact}` : /^1\d{10}$/.test(compact) ? `+${compact}` : null;
  return e164 !== null && /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}
