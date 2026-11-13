import { z } from 'zod';
import { OK, refuse, type Check } from '../check.js';
import type { PublicBillTeamView, RecordedVote } from './public-bills.js';

/**
 * Bills in Congress (design §5.14): the legislative team's search over U.S. Congress bills, from the Congress.gov API
 * and GovInfo, and the watchlist the team shares. Read only: nothing here changes a bill, and no Claude.
 */

/** Congress.gov's bill types, as its addresses spell them. */
export const BILL_TYPES = ['hr', 's', 'hjres', 'sjres', 'hconres', 'sconres', 'hres', 'sres'] as const;
export type BillType = (typeof BILL_TYPES)[number];

export const BILL_TYPE_LABELS: Readonly<Record<BillType, string>> = {
  hr: 'H.R.',
  s: 'S.',
  hjres: 'H.J.Res.',
  sjres: 'S.J.Res.',
  hconres: 'H.Con.Res.',
  sconres: 'S.Con.Res.',
  hres: 'H.Res.',
  sres: 'S.Res.',
};

/** What each type is, in words, for the search form. */
export const BILL_TYPE_NAMES: Readonly<Record<BillType, string>> = {
  hr: 'House bill',
  s: 'Senate bill',
  hjres: 'House joint resolution',
  sjres: 'Senate joint resolution',
  hconres: 'House concurrent resolution',
  sconres: 'Senate concurrent resolution',
  hres: 'House resolution',
  sres: 'Senate resolution',
};

/** The words congress.gov's own addresses use for each type: `congress.gov/bill/119th-congress/house-bill/10538`. */
export const BILL_TYPE_SLUGS: Readonly<Record<BillType, string>> = {
  hr: 'house-bill',
  s: 'senate-bill',
  hjres: 'house-joint-resolution',
  sjres: 'senate-joint-resolution',
  hconres: 'house-concurrent-resolution',
  sconres: 'senate-concurrent-resolution',
  hres: 'house-resolution',
  sres: 'senate-resolution',
};

/** The first Congress whose bill texts GovInfo holds (1993–1994), and so the first the tool covers. */
export const FIRST_CONGRESS = 103;

/** The highest bill number either chamber has reached is in the tens of thousands; anything longer is a typo. */
const MAX_BILL_NUMBER = 99_999;

export const isBillType = (value: unknown): value is BillType => typeof value === 'string' && (BILL_TYPES as readonly string[]).includes(value);

/**
 * The Congress sitting at `now`: the 1st met in 1789, and each since has lasted two years from 3 January of an odd year
 * (the Twentieth Amendment), so 2025 and 2026 are the 119th. Worked out, not asked, so it costs no request.
 */
export function currentCongress(now: Date): number {
  const year = now.getUTCFullYear();
  const beforeStart = year % 2 === 1 && now.getUTCMonth() === 0 && now.getUTCDate() < 3;
  return Math.floor((year - 1789) / 2) + 1 - (beforeStart ? 1 : 0);
}

/** "119th", "101st", "102nd", "103rd", "111th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

export const congressLabel = (congress: number) => `${ordinal(congress)} Congress`;

/** One bill: the Congress it was introduced in, its type and its number. */
export interface BillRef {
  readonly congress: number;
  readonly type: BillType;
  readonly number: number;
}

/** `119-hr-10538`: the bill's ID in addresses and in `bill_watch`. */
export const billId = (ref: BillRef) => `${ref.congress}-${ref.type}-${ref.number}`;

/** "H.R. 10538". */
export const billLabel = (ref: Pick<BillRef, 'type' | 'number'>) => `${BILL_TYPE_LABELS[ref.type]} ${ref.number}`;

/** The bill on congress.gov, for people to open there. */
export const congressGovUrl = (ref: BillRef) => `https://www.congress.gov/bill/${ordinal(ref.congress)}-congress/${BILL_TYPE_SLUGS[ref.type]}/${ref.number}`;

/** A bill reference whose Congress, type and number are each possible (the Congress not after `latest`). */
export function validBillRef(congress: number, type: string, number: number, latest: number): BillRef | null {
  if (!Number.isInteger(congress) || congress < FIRST_CONGRESS || congress > latest) return null;
  if (!isBillType(type)) return null;
  if (!Number.isInteger(number) || number < 1 || number > MAX_BILL_NUMBER) return null;
  return { congress, type, number };
}

/** `119-hr-10538` back into its parts; null for anything else. */
export function parseBillId(id: string, latest: number): BillRef | null {
  const m = /^(\d{3})-([a-z]+)-(\d{1,5})$/.exec(id);
  return m ? validBillRef(Number(m[1]), m[2]!, Number(m[3]), latest) : null;
}

/** Longest first, so `hres` is not read as `hr` and `es`. */
const TYPE_PATTERN = '(hconres|hjres|hres|hr|sconres|sjres|sres|s)';
const SLUG_TYPES = Object.fromEntries(Object.entries(BILL_TYPE_SLUGS).map(([type, slug]) => [slug, type as BillType])) as Record<string, BillType>;

/**
 * What someone typed in "Go to a bill", as a bill: `H.R. 10538`, `hr10538`, `S 12`, `H. Res. 5`, `HJRES 3`, `119-hr-10538`,
 * `H.R. 10538 (119th Congress)`, or a congress.gov address of a bill (`…/bill/119th-congress/house-bill/10538/text`).
 * The Congress is `congress` unless the text names one. Null when it is none of these, or not a possible bill.
 */
export function parseBillReference(text: string, congress: number, latest: number): BillRef | null {
  const typed = text.trim();
  if (!typed || typed.length > 300) return null;
  const url = /congress\.gov\/bill\/(\d{2,3})(?:st|nd|rd|th)-congress\/([a-z-]+)\/(\d{1,5})(?:[/?#]|$)/i.exec(typed);
  if (url) {
    const type = SLUG_TYPES[url[2]!.toLowerCase()];
    return type ? validBillRef(Number(url[1]), type, Number(url[3]), latest) : null;
  }
  const asId = parseBillId(typed.toLowerCase(), latest);
  if (asId) return asId;
  let rest = typed.toLowerCase();
  let named = congress;
  const ord = /\(?\b(\d{2,3})(?:st|nd|rd|th)\b(?:\s+congress)?\)?/.exec(rest);
  if (ord) {
    named = Number(ord[1]);
    rest = rest.replace(ord[0], ' ');
  }
  const compact = rest.replace(/[\s.]/g, '');
  const m = new RegExp(`^${TYPE_PATTERN}(\\d{1,5})$`).exec(compact);
  return m ? validBillRef(named, m[1]!, Number(m[2]), latest) : null;
}

/** A GovInfo package, one printed version of a bill: `BILLS-119hr10538ih`. */
export interface BillVersionRef extends BillRef {
  /** GovInfo's version code: `ih` introduced in the House, `enr` enrolled… */
  readonly version: string;
}

export function parsePackageId(packageId: string, latest: number): BillVersionRef | null {
  const m = new RegExp(`^BILLS-(\\d{3})${TYPE_PATTERN}(\\d{1,5})([a-z]{1,8})$`).exec(packageId);
  if (!m) return null;
  const ref = validBillRef(Number(m[1]), m[2]!, Number(m[3]), latest);
  return ref ? { ...ref, version: m[4]! } : null;
}

export const packageId = (ref: BillVersionRef) => `BILLS-${ref.congress}${ref.type}${ref.number}${ref.version}`;

/** A version code as GovInfo and congress.gov write them in file names: lower-case letters only. */
export const isVersionCode = (value: unknown): value is string => typeof value === 'string' && /^[a-z]{1,8}$/.test(value);

/** What the version codes the Government Publishing Office prints most mean. Others show as their code. */
export const BILL_VERSION_LABELS: Readonly<Record<string, string>> = {
  ih: 'Introduced in House',
  is: 'Introduced in Senate',
  rh: 'Reported in House',
  rs: 'Reported in Senate',
  rch: 'Reference change in House',
  rcs: 'Reference change in Senate',
  rfh: 'Referred in House',
  rfs: 'Referred in Senate',
  pch: 'Placed on calendar in House',
  pcs: 'Placed on calendar in Senate',
  eh: 'Engrossed in House',
  es: 'Engrossed in Senate',
  eah: 'Engrossed amendment in House',
  eas: 'Engrossed amendment in Senate',
  ath: 'Agreed to in House',
  ats: 'Agreed to in Senate',
  cph: 'Considered and passed in House',
  cps: 'Considered and passed in Senate',
  enr: 'Enrolled bill',
};

export const versionLabel = (code: string) => BILL_VERSION_LABELS[code] ?? code.toUpperCase();

/**
 * How far a bill has gone, by the furthest text version printed (what GovInfo's search can filter on): introduced,
 * reported by a committee, passed one chamber (engrossed, or a simple resolution agreed to), passed both (enrolled).
 */
export const BILL_STAGES = ['introduced', 'reported', 'passed_one', 'passed_both'] as const;
export type BillStage = (typeof BILL_STAGES)[number];

export const STAGE_VERSIONS: Readonly<Record<BillStage, readonly string[]>> = {
  introduced: ['ih', 'is'],
  reported: ['rh', 'rs'],
  passed_one: ['eh', 'es', 'ath', 'ats'],
  passed_both: ['enr'],
};

export const STAGE_LABELS: Readonly<Record<BillStage, string>> = {
  introduced: 'Introduced',
  reported: 'Reported by a committee',
  passed_one: 'Passed one chamber',
  passed_both: 'Passed both chambers',
};

/** The stage a printed version marks, or null for a version that marks none (a reference change, say). */
export function versionStage(code: string): BillStage | null {
  for (const stage of [...BILL_STAGES].reverse()) if (STAGE_VERSIONS[stage].includes(code)) return stage;
  if (code === 'rfs' || code === 'rfh' || code === 'cph' || code === 'cps' || code === 'eah' || code === 'eas') return 'passed_one';
  if (code === 'pch' || code === 'pcs') return 'reported';
  return null;
}

/** Search sorts: best match needs words; GovInfo sorts the rest by publish date or title. */
export const BILL_SEARCH_SORTS = ['relevance', 'newest', 'oldest', 'title', 'title_desc'] as const;
export type BillSearchSort = (typeof BILL_SEARCH_SORTS)[number];

export const BILL_RECENT_SORTS = ['updated', 'updated_oldest'] as const;
export type BillRecentSort = (typeof BILL_RECENT_SORTS)[number];

export const BILL_WATCH_SORTS = ['latest_action', 'added', 'number', 'title'] as const;
export type BillWatchSort = (typeof BILL_WATCH_SORTS)[number];

export const BILL_LIMITS = {
  words: 200,
  member: 40,
  cursor: 500,
  pageSize: 20,
  tags: 10,
  tag: 30,
  note: 2000,
  /** Texts longer than this (an omnibus bill) are cut, with a link to the PDF. */
  text: 2_000_000,
  /** Watchlist entries refreshed from Congress.gov per read, and how old a check must be first. */
  refreshPerRead: 25,
  refreshAfterMs: 6 * 60 * 60 * 1000,
  watchlist: 500,
} as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: string) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
const congressParam = z.coerce.number().int().min(FIRST_CONGRESS).max(999).optional();
const dateParam = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || isDate(v), 'dates are written YYYY-MM-DD');

/** `GET /v1/bills/search`. Every field optional; the Congress is the current one when absent. */
export const billSearchSchema = z
  .object({
    q: optionalText(BILL_LIMITS.words),
    congress: congressParam,
    type: z.enum(BILL_TYPES).optional(),
    stage: z.enum(BILL_STAGES).optional(),
    member: optionalText(BILL_LIMITS.member).refine((v) => v === undefined || /^[\p{L}][\p{L} .'’-]*$/u.test(v), 'a member is found by their last name: letters, spaces, hyphens and apostrophes'),
    from: dateParam,
    to: dateParam,
    sort: z.enum(BILL_SEARCH_SORTS).optional(),
    cursor: optionalText(BILL_LIMITS.cursor),
  })
  .strict();
export type BillSearchInput = z.infer<typeof billSearchSchema>;

/** `GET /v1/bills/recent`. */
export const billRecentSchema = z
  .object({
    congress: congressParam,
    type: z.enum(BILL_TYPES).optional(),
    from: dateParam,
    to: dateParam,
    sort: z.enum(BILL_RECENT_SORTS).optional(),
    page: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();
export type BillRecentInput = z.infer<typeof billRecentSchema>;

/** `GET /v1/bills/watchlist`. */
export const billWatchQuerySchema = z
  .object({
    sort: z.enum(BILL_WATCH_SORTS).optional(),
    tag: optionalText(BILL_LIMITS.tag),
  })
  .strict();
export type BillWatchQuery = z.infer<typeof billWatchQuerySchema>;

/** The search as the api asks GovInfo for it: the Congress settled, the dates in order, best match only with words. */
export interface BillSearch {
  readonly words: string | null;
  readonly congress: number;
  readonly type: BillType | null;
  readonly stage: BillStage | null;
  readonly member: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly sort: BillSearchSort;
  readonly cursor: string | null;
}

/**
 * The words as GovInfo should read them: field operators (`collection:`), brackets and backslashes dropped, so what is
 * typed searches bills' text and never widens the query; a phrase in double quotes kept, an unpaired quote dropped.
 * Empty when nothing is left.
 */
export function cleanSearchWords(words: string): string {
  let text = words.replace(/[“”]/g, '"').replace(/[\\(){}[\]<>:^~*?/]/g, ' ');
  if ((text.match(/"/g) ?? []).length % 2 === 1) text = text.replace(/"(?=[^"]*$)/, ' ');
  return text.replace(/""/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The search to run, or why not. `latest` is the current Congress. */
export function settleSearch(input: BillSearchInput, latest: number): { readonly ok: true; readonly search: BillSearch } | { readonly ok: false; readonly reason: string } {
  const congress = input.congress ?? latest;
  if (congress > latest) return { ok: false, reason: `the ${congressLabel(latest)} is the latest` };
  if (input.from && input.to && input.from > input.to) return { ok: false, reason: 'the first date is after the second' };
  const words = input.q ? cleanSearchWords(input.q) || null : null;
  if (input.q && !words) return { ok: false, reason: 'the words held nothing to search for' };
  const sort = input.sort ?? (words ? 'relevance' : 'newest');
  if (sort === 'relevance' && !words) return { ok: false, reason: 'best match needs words to match: sort by date or title instead' };
  return {
    ok: true,
    search: {
      words,
      congress,
      type: input.type ?? null,
      stage: input.stage ?? null,
      member: input.member ?? null,
      from: input.from ?? null,
      to: input.to ?? null,
      sort,
      cursor: input.cursor ?? null,
    },
  };
}

/** One action on a bill, as Congress.gov lists it. */
export interface BillAction {
  readonly date: string;
  readonly text: string;
  /** Congress.gov's kind of action: `IntroReferral`, `Committee`, `Calendars`, `Floor`, `President`, `Veto`, `BecameLaw`… */
  readonly type: string | null;
  /** Where it was recorded: the House, the Senate, or the Library of Congress (whose actions mark each step). */
  readonly source: string | null;
  /** The roll calls it records, if any (design §5.14, "Legislation and the scorecard"). */
  readonly votes?: readonly RecordedVote[];
}

/** A law the bill became: `Public Law 119-12`. */
export interface BillLaw {
  readonly type: string;
  readonly number: string;
}

export const BILL_STATUSES = ['law', 'vetoed', 'to_president', 'passed_both', 'passed_house', 'passed_senate', 'reported', 'introduced'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const BILL_STATUS_LABELS: Readonly<Record<BillStatus, string>> = {
  law: 'Became law',
  vetoed: 'Vetoed',
  to_president: 'Sent to the President',
  passed_both: 'Passed both chambers',
  passed_house: 'Passed the House',
  passed_senate: 'Passed the Senate',
  reported: 'Reported by a committee',
  introduced: 'Introduced',
};

/**
 * How far a bill has gone, from its actions and laws (design §5.14). The Library of Congress records each step in the
 * same words every time ("Passed/agreed to in House: …", "Presented to President", "Became Public Law No: …"), so
 * those, with the action types, decide; anything not reached yet is introduced. A veto overridden is law.
 */
export function billStatus(actions: readonly BillAction[], laws: readonly BillLaw[]): BillStatus {
  const said = (pattern: RegExp) => actions.some((a) => pattern.test(a.text));
  if (laws.length > 0 || actions.some((a) => a.type === 'BecameLaw') || said(/^Became (Public|Private) Law/i)) return 'law';
  if (actions.some((a) => a.type === 'Veto') || said(/^(Vetoed|Pocket Vetoed) by President/i)) return 'vetoed';
  if (said(/^Presented to President/i)) return 'to_president';
  const house = said(/^Passed\/agreed to in House/i);
  const senate = said(/^Passed\/agreed to in Senate/i);
  if (house && senate) return 'passed_both';
  if (house) return 'passed_house';
  if (senate) return 'passed_senate';
  if (said(/^(Reported|Committee on .* discharged)|discharged/i) || actions.some((a) => a.type === 'Calendars')) return 'reported';
  return 'introduced';
}

/** "Public Law 119-12", "Private Law 119-3". */
export const lawLabel = (law: BillLaw) => `${/private/i.test(law.type) ? 'Private' : 'Public'} Law ${law.number}`;

/** Who sponsored a bill, as Congress.gov names them. */
export interface BillSponsor {
  readonly bioguideId: string;
  /** "Rep. Casar, Greg [D-TX-35]". */
  readonly fullName: string;
  readonly party: string | null;
  readonly state: string | null;
  readonly district: number | null;
}

/** A bill's latest action, as Congress.gov gives it with the bill and in its lists. */
export interface BillLatestAction {
  readonly date: string;
  readonly text: string;
}

/** One printed version of a bill, with where to read it. */
export interface BillTextVersion {
  readonly version: string;
  readonly label: string;
  /** When it was printed; null when Congress.gov has no date for it (an enrolled bill, often). */
  readonly date: string | null;
  readonly pdfUrl: string | null;
  readonly xmlUrl: string | null;
  readonly htmlUrl: string | null;
}

/** A CRS summary, reduced to plain paragraphs (each list item a paragraph starting "• "). */
export interface BillSummary {
  readonly versionLabel: string;
  readonly date: string;
  readonly paragraphs: readonly string[];
}

/** One bill found by a search: the furthest of its versions on the page. */
export interface BillHit extends BillRef {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly chamber: 'House' | 'Senate' | null;
  readonly version: string;
  readonly versionLabel: string;
  readonly stage: BillStage | null;
  /** When that version was printed. */
  readonly date: string | null;
  /** The other versions of this bill on the same page. */
  readonly otherVersions: readonly string[];
}

export interface BillSearchPage {
  readonly search: BillSearch;
  /** How many versions match, as GovInfo counts them (a bill is counted once per version). */
  readonly total: number;
  readonly hits: readonly BillHit[];
  /** The cursor for the next page; null on the last. */
  readonly next: string | null;
}

/** A bill in a Congress.gov list, by when it was last updated. */
export interface BillListItem extends BillRef {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly chamber: 'House' | 'Senate' | null;
  readonly introducedDate: string | null;
  readonly updatedAt: string | null;
  readonly latestAction: BillLatestAction | null;
}

export interface BillRecentPage {
  readonly congress: number;
  readonly total: number;
  readonly page: number;
  readonly items: readonly BillListItem[];
  readonly hasMore: boolean;
}

/** A bill as the Congress.gov API describes it, before the watchlist is added (the `BillSource` port's answer). */
export interface BillRecord extends BillRef {
  readonly title: string;
  readonly chamber: 'House' | 'Senate' | null;
  readonly introducedDate: string | null;
  readonly updatedAt: string | null;
  readonly policyArea: string | null;
  readonly sponsors: readonly BillSponsor[];
  readonly cosponsors: number;
  readonly latestAction: BillLatestAction | null;
  readonly laws: readonly BillLaw[];
  readonly actions: readonly BillAction[];
  readonly summaries: readonly BillSummary[];
  readonly textVersions: readonly BillTextVersion[];
}

/** One version's text, plain, as GovInfo prints it. */
export interface BillText extends BillVersionRef {
  readonly label: string;
  readonly text: string;
  /** Cut at `BILL_LIMITS.text` characters. */
  readonly truncated: boolean;
  readonly pdfUrl: string;
}

/** Sorts the watchlist: latest action newest first, newest added first, by number, or by title. */
export function sortWatchlist<T extends BillRef & { readonly title: string; readonly addedAt: string; readonly latestAction: BillLatestAction | null }>(entries: readonly T[], sort: BillWatchSort): T[] {
  const byNumber = (a: T, b: T) => b.congress - a.congress || BILL_TYPES.indexOf(a.type) - BILL_TYPES.indexOf(b.type) || a.number - b.number;
  const compare: Record<BillWatchSort, (a: T, b: T) => number> = {
    latest_action: (a, b) => (b.latestAction?.date ?? '').localeCompare(a.latestAction?.date ?? '') || byNumber(a, b),
    added: (a, b) => b.addedAt.localeCompare(a.addedAt),
    number: byNumber,
    title: (a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || byNumber(a, b),
  };
  return [...entries].sort(compare[sort]);
}

/**
 * Tags as kept: trimmed, inner spaces made one, the same tag in any case kept once (the first spelling), in the order
 * given.
 */
export function tidyTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of tags) {
    const tag = raw.replace(/\s+/g, ' ').trim();
    const key = tag.toLocaleLowerCase('en');
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    kept.push(tag);
  }
  return kept;
}

export function checkTags(tags: readonly string[]): Check {
  if (tags.length > BILL_LIMITS.tags) return refuse('conflict', `a bill has at most ${BILL_LIMITS.tags} tags`);
  const long = tags.find((t) => t.length > BILL_LIMITS.tag);
  if (long !== undefined) return refuse('conflict', `a tag is at most ${BILL_LIMITS.tag} characters: "${long.slice(0, BILL_LIMITS.tag)}…"`);
  return OK;
}

/** `PUT /v1/bills/watchlist/{billId}`: the bill's tags, from the version edited (null when adding it). */
export const watchBillSchema = z
  .object({
    tags: z.array(z.string().max(200)).max(50),
    basedOn: z.number().int().min(0).nullable(),
  })
  .strict();
export type WatchBillInput = z.infer<typeof watchBillSchema>;

/** `POST /v1/bills/watchlist/{billId}/notes`, `PUT /v1/bills/notes/{noteId}`. */
export const billNoteSchema = z
  .object({
    text: z
      .string()
      .transform((t) => t.replace(/\r\n?/g, '\n').trim())
      .pipe(z.string().min(1, 'a note needs some text').max(BILL_LIMITS.note, `a note is at most ${BILL_LIMITS.note} characters`)),
  })
  .strict();
export type BillNoteInput = z.infer<typeof billNoteSchema>;

/** `PUT /v1/admin/bills`: the teams that have the tool, from the version edited. */
export const billSettingsSchema = z
  .object({
    teamIds: z.array(z.string().min(1).max(64)).max(20),
    basedOn: z.number().int().min(0),
  })
  .strict();
export type BillSettingsInput = z.infer<typeof billSettingsSchema>;

/** `bill_settings/current`; version 0 (never saved) is nobody but System Admins. */
export interface BillSettingsRecord {
  readonly teamIds: readonly string[];
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

export const DEFAULT_BILL_SETTINGS: BillSettingsRecord = { teamIds: [], version: 0, updatedAt: null, updatedBy: null };

/** `bills.settings_changed`: which teams had the tool, and which have it now. */
export interface BillSettingsChangedPayload {
  readonly before: readonly string[];
  readonly after: readonly string[];
}

/** `bill_watch/{billId}`: one bill on the team's watchlist, with what Congress.gov said when it was last read. */
export interface BillWatchRecord extends BillRef {
  readonly billId: string;
  readonly title: string;
  readonly sponsor: string | null;
  readonly status: BillStatus;
  readonly latestAction: BillLatestAction | null;
  /** When Congress.gov was last read for it. */
  readonly checkedAt: string;
  readonly tags: readonly string[];
  readonly addedAt: string;
  readonly addedBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  /** Counts saves, so tags changed from an older copy are refused instead of undoing someone else's. */
  readonly version: number;
}

/** `bill_notes/{noteId}`. */
export interface BillNoteRecord {
  readonly noteId: string;
  readonly billId: string;
  readonly text: string;
  readonly author: string;
  readonly createdAt: string;
  readonly editedAt: string | null;
}

/** Whether `actor` may change or delete a note: its author changes and deletes it; a System Admin may delete any. */
export function checkNoteChange(note: BillNoteRecord, actor: string, change: 'edit' | 'delete', systemAdmin: boolean): Check {
  if (note.author === actor) return OK;
  if (change === 'delete' && systemAdmin) return OK;
  return refuse('forbidden', change === 'edit' ? 'only its author edits a note' : 'only its author or a System Admin deletes a note');
}

/** Where the key the tool uses comes from (design §5.14): its own card, the FEC key in use, or the shared demo key. */
export type BillKeySource = 'congress' | 'fec' | 'demo';

/** `GET /v1/bills/access`. */
export interface BillsAccess {
  readonly allowed: boolean;
  /** The teams that give the caller the tool (none for a System Admin who is on none). */
  readonly teams: readonly { readonly teamId: string; readonly name: string }[];
  readonly systemAdmin: boolean;
  readonly currentCongress: number;
  /** Null for someone without the tool. */
  readonly keySource: BillKeySource | null;
}

/** A note as the page shows it. */
export interface BillNoteView {
  readonly noteId: string;
  readonly text: string;
  readonly author: { readonly accountId: string; readonly name: string };
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly mine: boolean;
  /** Whether the caller may delete it (their own, or as a System Admin). */
  readonly deletable: boolean;
}

/** A watchlist entry as the page shows it. */
export interface BillWatchEntry extends Omit<BillWatchRecord, 'addedBy' | 'updatedBy'> {
  readonly label: string;
  readonly addedBy: { readonly accountId: string; readonly name: string };
  readonly notes: number;
  /** Congress.gov could not be read when it was due a check; what it shows is from `checkedAt`. */
  readonly stale: boolean;
  /** Whether the team shows it on the public Legislation page. */
  readonly public: boolean;
}

/** `GET /v1/bills/{congress}/{type}/{number}`. */
export interface BillDetail extends BillRecord {
  readonly id: string;
  readonly label: string;
  readonly status: BillStatus;
  readonly url: string;
  readonly watch: BillWatchEntry | null;
  readonly notes: readonly BillNoteView[];
  /** What the public sees of it, when the team shows it on the Legislation page. */
  readonly public: PublicBillTeamView | null;
}

/** `GET /v1/admin/bills`. */
export interface BillSettingsView {
  readonly teamIds: readonly string[];
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: { readonly accountId: string; readonly name: string } | null;
  readonly teams: readonly { readonly teamId: string; readonly name: string; readonly archived: boolean; readonly members: number }[];
  readonly keySource: BillKeySource;
}
