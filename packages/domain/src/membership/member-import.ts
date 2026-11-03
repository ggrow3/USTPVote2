import { z } from 'zod';
import { readCsv } from '../csv-read.js';
import type { MemberStatus } from './member-status.js';
import { DEFAULT_COUNTRY } from './countries.js';
import { placeOf } from './places.js';
import type { MemberContact } from './records.js';
import { normalizePhone, normalizePostalCode, normalizePostcode, POSTCODE, US_POSTAL_CODE } from './registration.js';

/**
 * Members a Membership Admin adds (design §5.13): one at a time on a form, or many from a CSV file. Both give the
 * same fields as text, checked here by the same rules in the browser (the form, the preview) and the api.
 */

/** Rows one import may hold; a longer roster is imported in parts. */
export const MAX_MEMBER_IMPORT_ROWS = 500;

/** The columns an import reads, in the template's order. */
export const MEMBER_IMPORT_COLUMNS = [
  'email',
  'legalName',
  'preferredName',
  'state',
  'region',
  'country',
  'city',
  'postalCode',
  'phone',
  'usVoteEligible',
] as const;
export type MemberImportColumn = (typeof MEMBER_IMPORT_COLUMNS)[number];

/**
 * Each column's header in the template first, then others a roster may use for it. Headers are compared without case,
 * spaces, `_` or `-`, so "Legal Name" and "legal_name" are the same.
 */
export const MEMBER_IMPORT_HEADERS: Readonly<Record<MemberImportColumn, readonly string[]>> = {
  email: ['email', 'email address', 'e-mail'],
  legalName: ['legal_name', 'name', 'full name'],
  preferredName: ['preferred_name', 'nickname'],
  state: ['state', 'state code', 'state or territory'],
  region: ['region', 'province', 'county'],
  country: ['country', 'country code'],
  city: ['city', 'town'],
  postalCode: ['zip', 'zip code', 'postal code', 'postcode'],
  phone: ['phone', 'phone number', 'telephone', 'mobile'],
  usVoteEligible: ['us_vote_eligible', 'eligible to vote in the us', 'us voter'],
};

/** The template file: the header row alone, so nothing in it can be imported by mistake. */
export const MEMBER_IMPORT_TEMPLATE = `${MEMBER_IMPORT_COLUMNS.map((c) => MEMBER_IMPORT_HEADERS[c][0]).join(',')}\r\n`;

/** Longest cell the browser sends; anything longer is cut, and the checks below then say it is too long. */
const MAX_CELL = 1000;
const cell = z.string().max(MAX_CELL);

/** One member as the form or a file gives them: each field's text, not yet checked. */
export const newMemberTextSchema = z.strictObject({
  email: cell,
  legalName: cell,
  preferredName: cell.optional(),
  state: cell.optional(),
  /** Outside the US, the state, province or county, as given; the state column may hold it instead. */
  region: cell.optional(),
  country: cell.optional(),
  city: cell.optional(),
  postalCode: cell.optional(),
  phone: cell.optional(),
  /** Yes or No to "eligible to vote in any United States elections?"; empty for not asked. */
  usVoteEligible: cell.optional(),
});
export type NewMemberText = z.infer<typeof newMemberTextSchema>;

/** A row of an import file, with the line of the file it starts on. */
export const memberImportRowSchema = newMemberTextSchema.extend({ line: z.number().int().min(1).max(1_000_000) });
export type MemberImportRow = z.infer<typeof memberImportRowSchema>;

const reason = z.string().trim().min(1, 'a written reason is required').max(2000);

/** `POST /v1/admin/members`: one member, and why they are added. */
export const addMemberSchema = newMemberTextSchema.extend({ reason });
export type AddMemberInput = z.infer<typeof addMemberSchema>;

/** `POST /v1/admin/member-imports/preview`: the file's rows, as the browser read them. */
export const memberImportPreviewSchema = z.strictObject({
  rows: z.array(memberImportRowSchema).min(1, 'the file has no rows').max(MAX_MEMBER_IMPORT_ROWS, `import at most ${MAX_MEMBER_IMPORT_ROWS} rows at a time`),
});
export type MemberImportPreviewInput = z.infer<typeof memberImportPreviewSchema>;

/** `POST /v1/admin/member-imports`: the same rows, and one reason for all of them. */
export const memberImportSchema = memberImportPreviewSchema.extend({ reason });
export type MemberImportInput = z.infer<typeof memberImportSchema>;

/** A member to add, checked and tidied: what goes on the account and the member record. */
export interface NewMember {
  /** Lowercase, as primary emails are stored. */
  readonly email: string;
  readonly legalName: string;
  readonly preferredName: string | null;
  /** ISO 3166-1 alpha-2 (`COUNTRIES`); the United States unless the row gives another. */
  readonly country: string;
  /** In the US, the state or territory code; null elsewhere. */
  readonly state: string | null;
  /** Outside the US, the state, province or county as given, or null; null in the US. */
  readonly region: string | null;
  /** Null when no city, postal code or phone was given. */
  readonly contact: MemberContact | null;
  readonly usVoteEligible: boolean | null;
}

/**
 * Why an import skips a row, by cause, as the preview and the result count them: a needed field empty, an email
 * address that is not one, another field that breaks the rules, the same address as an earlier row, or an address
 * already on the site. A row counts once, under the first of these that applies.
 */
export const SKIP_CAUSES = ['missing', 'bad_email', 'invalid', 'duplicate', 'on_site'] as const;
export type SkipCause = (typeof SKIP_CAUSES)[number];

/** Why a member cannot be added as given, the field it is about, and which cause it counts under. */
export interface NewMemberProblem {
  readonly field: MemberImportColumn | null;
  readonly message: string;
  readonly cause: Extract<SkipCause, 'missing' | 'bad_email' | 'invalid'>;
}

const emailSchema = z.email();
const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0']);

/** Checks one member's fields and tidies them as they will be stored: every problem at once, or the member. */
export function checkNewMember(text: NewMemberText):
  | { readonly ok: true; readonly member: NewMember }
  | { readonly ok: false; readonly problems: readonly NewMemberProblem[] } {
  const problems: NewMemberProblem[] = [];
  const problem = (field: MemberImportColumn, message: string, cause: NewMemberProblem['cause'] = 'invalid') =>
    problems.push({ field, message, cause });
  const value = (v: string | undefined) => (v ?? '').trim();

  const email = value(text.email).toLowerCase();
  if (!email) problem('email', 'no email address', 'missing');
  else if (email.length > 254 || !emailSchema.safeParse(email).success) {
    problem('email', `"${value(text.email)}" is not an email address`, 'bad_email');
  }

  const legalName = value(text.legalName);
  if (!legalName) problem('legalName', 'no legal name', 'missing');
  else if (legalName.length > 200) problem('legalName', 'the legal name is longer than 200 characters');
  const preferredName = value(text.preferredName);
  if (preferredName.length > 200) problem('preferredName', 'the preferred name is longer than 200 characters');

  const place = placeOf(value(text.state), value(text.region), value(text.country));
  if ('problem' in place) {
    problem(value(text.country) && !value(text.state) ? 'country' : 'state', place.problem, place.missing ? 'missing' : 'invalid');
  }
  const abroad = 'country' in place && place.country !== DEFAULT_COUNTRY;

  const city = value(text.city);
  if (city.length > 100) problem('city', 'the city is longer than 100 characters');
  const postal = value(text.postalCode);
  if (postal && !abroad && !US_POSTAL_CODE.test(postal)) problem('postalCode', `"${postal}" is not a US ZIP code`);
  if (postal && abroad && (postal.length > 16 || !POSTCODE.test(normalizePostcode(postal)))) {
    problem('postalCode', `"${postal}" is not a postcode`);
  }
  const phoneText = value(text.phone);
  const phone = phoneText ? normalizePhone(phoneText) : null;
  if (phoneText && !phone) problem('phone', `"${phoneText}" is not a phone number (give its area code, or +country code outside the US)`);

  const eligibleText = value(text.usVoteEligible).toLowerCase();
  const usVoteEligible = YES.has(eligibleText) ? true : NO.has(eligibleText) ? false : null;
  if (eligibleText && usVoteEligible === null) problem('usVoteEligible', `"${value(text.usVoteEligible)}" is not yes or no`);

  if (problems.length || 'problem' in place) return { ok: false, problems };
  const postalCode = postal ? (abroad ? normalizePostcode(postal) : normalizePostalCode(postal)) : null;
  return {
    ok: true,
    member: {
      email,
      legalName,
      preferredName: preferredName || null,
      country: place.country,
      state: place.state,
      region: place.region,
      contact: city || postalCode || phone ? { city: city || null, postalCode, phone } : null,
      usVoteEligible,
    },
  };
}

/** A file read for import: its rows, which columns it has, or why it cannot be imported at all. */
export interface MemberImportFile {
  readonly rows: readonly MemberImportRow[];
  readonly columns: readonly MemberImportColumn[];
  /** Headers that name no column the import reads; those columns are left out. */
  readonly ignored: readonly string[];
  readonly problem: string | null;
}

const headerKey = (header: string) => header.trim().toLowerCase().replace(/[\s_-]+/g, '');
const HEADER_COLUMNS = new Map(
  MEMBER_IMPORT_COLUMNS.flatMap((column) => MEMBER_IMPORT_HEADERS[column].map((h) => [headerKey(h), column] as const)),
);

/**
 * Reads an import file: its first row names the columns (any order; others are ignored), each further row is a
 * member. Blank rows are skipped. Refused whole when it lacks a needed column, has no rows or too many.
 */
export function readMemberImport(text: string): MemberImportFile {
  const records = readCsv(text).filter((r) => r.cells.some((c) => c.trim()));
  const none = (problem: string): MemberImportFile => ({ rows: [], columns: [], ignored: [], problem });
  const [header, ...body] = records;
  if (!header) return none('the file is empty');

  const at = new Map<MemberImportColumn, number>();
  const ignored: string[] = [];
  header.cells.forEach((name, i) => {
    const column = HEADER_COLUMNS.get(headerKey(name));
    if (!column) {
      if (name.trim()) ignored.push(name.trim());
    } else if (!at.has(column)) at.set(column, i);
  });
  const columns = MEMBER_IMPORT_COLUMNS.filter((c) => at.has(c));
  const missing = [
    !at.has('email') && 'email',
    !at.has('legalName') && 'legal_name',
    !at.has('state') && !at.has('country') && 'state (or country)',
  ].filter((m): m is string => !!m);
  if (missing.length) {
    return none(`the first row must name the columns, and it has no ${missing.join(', no ')} column (download the template to see them)`);
  }
  if (!body.length) return none('the file has no members under its first row');
  if (body.length > MAX_MEMBER_IMPORT_ROWS) {
    return none(`the file has ${body.length} members; import at most ${MAX_MEMBER_IMPORT_ROWS} at a time, so split it`);
  }
  const rows = body.map(({ line, cells }) => {
    const get = (column: MemberImportColumn) => {
      const i = at.get(column);
      return i === undefined ? undefined : (cells[i] ?? '').slice(0, MAX_CELL);
    };
    const row: MemberImportRow = { line, email: get('email') ?? '', legalName: get('legalName') ?? '' };
    const extra = Object.fromEntries(
      (['preferredName', 'state', 'region', 'country', 'city', 'postalCode', 'phone', 'usVoteEligible'] as const).flatMap((c) => {
        const v = get(c);
        return v === undefined ? [] : [[c, v]];
      }),
    );
    return { ...row, ...extra };
  });
  return { rows, columns, ignored, problem: null };
}

/**
 * Who already has an email address on the site, by lowercase email: a login with no membership, an added member who
 * has not signed in yet, or a member in some status.
 */
export type ExistingEmail = { readonly kind: 'login' } | { readonly kind: 'member'; readonly status: MemberStatus; readonly waiting: boolean };

/** Why an address that is already on the site is skipped. */
export function existingEmailReason(existing: ExistingEmail): string {
  if (existing.kind === 'login') return 'already has a login on the site, so they apply on the Register page';
  if (existing.waiting) return 'already added, and has not set a password yet';
  return `already has a membership (${existing.status})`;
}

/** One row of an import as it will go: added, or skipped with its reasons. */
export interface PlannedMemberRow {
  readonly line: number;
  /** As stored when it is an address; as given otherwise. */
  readonly email: string;
  readonly legalName: string;
  readonly add: boolean;
  readonly reasons: readonly string[];
  /** What a skipped row counts under; null for a row added. */
  readonly cause: SkipCause | null;
  /** The member to add, when `add`. */
  readonly member: NewMember | null;
}

export interface MemberImportPlan {
  readonly rows: readonly PlannedMemberRow[];
  readonly adding: number;
  readonly skipping: number;
  /** The rows skipped, counted by cause; they add up to `skipping`. */
  readonly skippedBy: Readonly<Record<SkipCause, number>>;
}

/** Skipped rows counted by cause, each once. */
export function skipCounts(rows: readonly { readonly cause: SkipCause | null }[]): Record<SkipCause, number> {
  const counts = Object.fromEntries(SKIP_CAUSES.map((c) => [c, 0])) as Record<SkipCause, number>;
  for (const { cause } of rows) if (cause) counts[cause]++;
  return counts;
}

/**
 * What an import will do with each row (design §5.13): add it, or skip it because its fields break the rules, its
 * address came earlier in the file, or the address is already on the site (`existing`). The api plans again when it
 * imports, so the preview and the import agree unless someone signed up meanwhile.
 */
export function planMemberImport(
  rows: readonly MemberImportRow[],
  existing: ReadonlyMap<string, ExistingEmail>,
): MemberImportPlan {
  const first = new Map<string, number>();
  const planned = rows.map((row): PlannedMemberRow => {
    const checked = checkNewMember(row);
    const email = checked.ok ? checked.member.email : row.email.trim();
    const skip = (reasons: readonly string[], cause: SkipCause): PlannedMemberRow => ({
      line: row.line,
      email,
      legalName: row.legalName.trim(),
      add: false,
      reasons,
      cause,
      member: null,
    });
    if (!checked.ok) {
      const cause = SKIP_CAUSES.find((c) => checked.problems.some((p) => p.cause === c))!;
      return skip(
        checked.problems.map((p) => p.message),
        cause,
      );
    }
    const earlier = first.get(email);
    if (earlier !== undefined) return skip([`the same email address as row ${earlier}`], 'duplicate');
    first.set(email, row.line);
    const known = existing.get(email);
    if (known) return skip([existingEmailReason(known)], 'on_site');
    return { line: row.line, email, legalName: row.legalName.trim(), add: true, reasons: [], cause: null, member: checked.member };
  });
  const adding = planned.filter((r) => r.add).length;
  return { rows: planned, adding, skipping: planned.length - adding, skippedBy: skipCounts(planned) };
}

/** How an added member's welcome email goes (design §5.13): through the site's mail, or Identity Platform's link. */
export type WelcomeDelivery = 'mail' | 'identity_platform';

/** A row an import skipped, with its reasons and the cause it counts under. */
export interface SkippedMemberRow {
  readonly line: number;
  readonly email: string;
  readonly legalName: string;
  readonly reasons: readonly string[];
  readonly cause: SkipCause;
}

/** `POST /v1/admin/members` and `/v1/admin/member-imports`: who was added, who was skipped, how to welcome them. */
export interface MemberImportResult {
  readonly added: readonly { readonly line: number; readonly email: string; readonly accountId: string; readonly legalName: string }[];
  readonly skipped: readonly SkippedMemberRow[];
  /** The rows skipped, counted by cause; they add up to `skipped.length`. */
  readonly skippedBy: Readonly<Record<SkipCause, number>>;
  /**
   * `mail`: the worker sends each one our welcome email. `identity_platform`: this deployment sends no mail, so the
   * browser asks Identity Platform to send each added address its sign-in link.
   */
  readonly welcome: WelcomeDelivery;
}

/** `POST /v1/admin/members/{accountId}/welcome`: the welcome sent again, or, without mail, the address to send it to. */
export interface WelcomeAgain {
  readonly welcome: WelcomeDelivery;
  readonly email: string;
}
