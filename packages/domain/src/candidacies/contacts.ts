import { z } from 'zod';
import { refuse, type Outcome } from '../check.js';
import type { LedgerEvent } from '../ledger-events.js';
import { isCalendarDate } from '../membership/registration.js';
import type { CandidateArea } from './area.js';
import type { EmailTemplate } from './email-templates.js';
import type { ContactPhoto, ContactProfile } from './profiles.js';
import { OFFICE_DISTRICTS, PUBLIC_OFFICES, websiteProblem, type PublicOffice } from './candidacy.js';
import { districtIdProblem, DISTRICT_ID, NATION_ID, STATE_FIPS, type District, type DistrictKind } from './districts.js';

/**
 * Who a member can write to about each office in their area (design §5.12): the people who hold it now and the people
 * running for it. Public records give some of them (the FEC's candidates for Congress and President, the members of
 * Congress, with a key state legislators from Open States, with a Google key the contests on the ballot from the Civic
 * Information API, and in California the Secretary of State's list of who is on the ballot); Communications Admins
 * enter the rest, and can add an email address a public record lacks by entering the same person again. Wikipedia and
 * Wikidata add a biography and experience where they know the person.
 */

/** In office now, or running for it. */
export const CONTACT_ROLES = ['holder', 'candidate'] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

/**
 * The public records the api reads people from, each kept a day (the ballot as long as Google allows, at most a day).
 * `sos`: the state's own list of who is on its ballot, from its Secretary of State; California's so far.
 */
export const CONTACT_FEEDS = ['fec', 'congress', 'openstates', 'civic', 'sos'] as const;
export type ContactFeed = (typeof CONTACT_FEEDS)[number];

/** Where a person comes from: one of the feeds, or a Communications Admin. */
export type ContactSource = ContactFeed | 'admin';

/**
 * Whether a feed answered: `off` when it is not set up here (Open States and the ballot need a key), `unavailable` when
 * it failed. Wikipedia's profiles have a state too.
 */
export type ContactFeedState = 'ok' | 'off' | 'unavailable';

export const CONTACT_LIMITS = { name: 120, party: 60, officeTitle: 120, email: 254, url: 500 } as const;

/** What the office is called when a feed does not say. */
export const DEFAULT_OFFICE_TITLES: Readonly<Record<PublicOffice, string>> = {
  us_president: 'President of the United States',
  us_senate: 'U.S. Senator',
  us_house: 'U.S. Representative',
  statewide: 'Governor',
  state_upper: 'State Senator',
  state_lower: 'State Representative',
  county: 'County Commissioner',
  local: 'Mayor',
};

/** The offices elected from each kind of district: the reverse of `OFFICE_DISTRICTS`. */
export const OFFICES_OF_KIND: Readonly<Record<DistrictKind, readonly PublicOffice[]>> = Object.fromEntries(
  (['nation', 'state', 'congressional', 'state_upper', 'state_lower', 'county', 'place'] as const).map((kind) => [
    kind,
    PUBLIC_OFFICES.filter((office) => OFFICE_DISTRICTS[office] === kind),
  ]),
) as unknown as Record<DistrictKind, readonly PublicOffice[]>;

/** A district as a contact names it. */
export type ContactDistrict = Pick<District, 'kind' | 'geoid' | 'state' | 'name'>;

/** One person for one office in a member's area, as the Your area page shows them. */
export interface AreaContact {
  /** The feed's own ID with its name (`fec:H8CA49058`, `congress:L000582`), or the admin entry's. */
  readonly contactId: string;
  readonly source: ContactSource;
  readonly role: ContactRole;
  readonly office: PublicOffice;
  readonly officeTitle: string;
  readonly district: ContactDistrict;
  readonly name: string;
  readonly party: string | null;
  readonly email: string | null;
  /** A web form for writing to them, where they have one instead of (or as well as) an address. */
  readonly contactUrl: string | null;
  readonly website: string | null;
  /** The public record it comes from (the FEC filing, the Congress biography, the Open States page); null for an admin's. */
  readonly sourceUrl: string | null;
  /** For candidates: the election day (`YYYY-MM-DD`), or the year the FEC lists them for (`2026`); null for holders. */
  readonly election: string | null;
  /** A candidate who holds the office now. */
  readonly incumbent: boolean;
  readonly photo: ContactPhoto | null;
  /** Biography and experience, for people Wikidata knows by their FEC or Bioguide ID. */
  readonly profile: ContactProfile | null;
}

/** Someone on the ballot for a contest the api cannot place in one of the area's Census districts. */
export interface BallotCandidate {
  readonly name: string;
  readonly party: string | null;
  readonly website: string | null;
  readonly email: string | null;
  readonly photo: ContactPhoto | null;
}

/**
 * A contest on the ballot near the area's ZIP code (from the Civic Information API) whose district is not one of the
 * Census districts the page lists, such as a school board, a judge or a water district: listed, but not on the map.
 */
export interface BallotContest {
  /** The office, as the ballot names it. */
  readonly office: string;
  /** The district, as the ballot names it. */
  readonly district: string | null;
  /** The election day, `YYYY-MM-DD`. */
  readonly election: string | null;
  readonly candidates: readonly BallotCandidate[];
}

/**
 * A seat in the area that is not on this election's ballot, as the state's own list says (the U.S. Senate in California
 * in 2026, or a State Senate seat elected in other years): its card says so instead of that nobody is listed.
 */
export interface SeatNotUp {
  readonly office: PublicOffice;
  readonly kind: DistrictKind;
  readonly geoid: string;
}

/** Whether the state's list says a seat of the area is not on this election's ballot. */
export const seatNotUp = (notUp: readonly SeatNotUp[], seat: { readonly office: PublicOffice; readonly district: Pick<District, 'kind' | 'geoid'> }): boolean =>
  notUp.some((s) => s.office === seat.office && s.kind === seat.district.kind && s.geoid === seat.district.geoid);

/** `GET /v1/candidacies/area/contacts`: everything the Your area page shows. */
export interface AreaContactsView {
  readonly area: CandidateArea;
  /** The federal general election the FEC's lists are for. */
  readonly electionYear: number;
  readonly contacts: readonly AreaContact[];
  /** Contests on the ballot that are not in one of the area's Census districts. */
  readonly ballot: readonly BallotContest[];
  /** The area's seats that are not on this election's ballot. */
  readonly notUp: readonly SeatNotUp[];
  readonly feeds: Readonly<Record<ContactFeed, ContactFeedState>>;
  /** Whether Wikipedia and Wikidata answered. */
  readonly profiles: ContactFeedState;
  /** The email templates, in the list's order, for the page to offer those that suit each person and fill them in. */
  readonly templates: readonly EmailTemplate[];
}

/**
 * `GET /v1/candidacies/area/candidates` (the member's own area) and `POST /v1/public/candidates/area` (a ZIP code
 * anyone types): the people the Candidates page lists beside members' own candidacies. In the member's own area, who
 * holds and who runs for each office, from public records and admins' entries, as on the Your area page; for a ZIP
 * code anyone types, only who runs, from public records alone.
 */
export interface AreaCandidatesView {
  readonly area: CandidateArea;
  readonly electionYear: number;
  /** People running. */
  readonly candidates: readonly AreaContact[];
  /** People in office: in the member's own area only, none for a typed ZIP code. */
  readonly holders: readonly AreaContact[];
  readonly ballot: readonly BallotContest[];
  readonly notUp: readonly SeatNotUp[];
  readonly feeds: Readonly<Record<ContactFeed, ContactFeedState>>;
  readonly profiles: ContactFeedState;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `at most ${max} characters`)
    .nullable()
    .default(null)
    .transform((v) => v || null);

const optionalAddress = optionalText(CONTACT_LIMITS.url).superRefine((v, ctx) => {
  const problem = v && websiteProblem(v);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

/**
 * `POST /v1/admin/area-contacts` and `PUT …/{id}`: a person a Communications Admin enters, for an office in a district
 * the Census lists (the same state and district codes as a candidacy).
 */
export const areaContactInputSchema = z
  .strictObject({
    role: z.enum(CONTACT_ROLES),
    office: z.enum(PUBLIC_OFFICES),
    officeTitle: z.string().trim().min(1, 'enter the office as people know it').max(CONTACT_LIMITS.officeTitle),
    state: z
      .string()
      .regex(/^[A-Z]{2}$/, 'choose a state or territory')
      .nullable()
      .default(null),
    districtId: z.string().trim().regex(DISTRICT_ID, 'choose the district').nullable().default(null),
    name: z.string().trim().min(1, 'enter their name').max(CONTACT_LIMITS.name),
    party: optionalText(CONTACT_LIMITS.party),
    email: optionalText(CONTACT_LIMITS.email).refine((v) => v === null || z.email().safeParse(v).success, 'enter an email address, or leave it empty'),
    contactUrl: optionalAddress,
    website: optionalAddress,
    /** The election day, for someone running; none for someone in office. */
    electionDate: z.string().nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'candidate' && (v.electionDate === null || !isCalendarDate(v.electionDate))) {
      ctx.addIssue({ code: 'custom', path: ['electionDate'], message: 'enter the election date as YYYY-MM-DD' });
    }
    if (v.role === 'holder' && v.electionDate !== null) ctx.addIssue({ code: 'custom', path: ['electionDate'], message: 'someone in office has no election date' });
    const kind = OFFICE_DISTRICTS[v.office];
    if (kind === 'nation') {
      if (v.state !== null) ctx.addIssue({ code: 'custom', path: ['state'], message: 'a nationwide office has no state' });
      return;
    }
    const problem = districtIdProblem(kind, v.state, kind === 'state' ? null : v.districtId);
    if (problem) ctx.addIssue({ code: 'custom', path: [v.state === null || problem.startsWith('choose a state') ? 'state' : 'districtId'], message: problem });
  });
export type AreaContactInput = z.infer<typeof areaContactInputSchema>;

export const areaContactChangeSchema = z.strictObject({ contact: areaContactInputSchema, basedOn: z.number().int().min(1) });
export type AreaContactChangeInput = z.infer<typeof areaContactChangeSchema>;

/** What an entry says, with the district as the api's Census lookup names it. */
export interface AreaContactContent {
  readonly role: ContactRole;
  readonly office: PublicOffice;
  readonly officeTitle: string;
  readonly district: District;
  readonly name: string;
  readonly party: string | null;
  readonly email: string | null;
  readonly contactUrl: string | null;
  readonly website: string | null;
  readonly electionDate: string | null;
}

/** `area_contacts/{contactId}` */
export interface AreaContactRecord extends AreaContactContent {
  readonly contactId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export function areaContactContent(input: AreaContactInput, district: District): AreaContactContent {
  const { state: _state, districtId: _districtId, ...rest } = input;
  return { ...rest, district };
}

/** `area_contact.changed`: Auditors only, like other internal changes (design §8.2). */
export interface AreaContactChangedPayload {
  readonly change: 'added' | 'changed' | 'removed';
  readonly role: ContactRole;
  readonly office: PublicOffice;
  readonly geoid: string;
  readonly name: string;
}

function contactEvent(change: AreaContactChangedPayload['change'], record: AreaContactRecord, actor: string): LedgerEvent {
  const payload: AreaContactChangedPayload = { change, role: record.role, office: record.office, geoid: record.district.geoid, name: record.name };
  return { type: 'area_contact.changed', actor, subject: record.contactId, payload: { ...payload } };
}

export function addAreaContact(content: AreaContactContent, contactId: string, actor: string, at: string): { record: AreaContactRecord; event: LedgerEvent } {
  const record: AreaContactRecord = { ...content, contactId, version: 1, createdAt: at, createdBy: actor, updatedAt: at, updatedBy: actor };
  return { record, event: contactEvent('added', record, actor) };
}

export function changeAreaContact(
  current: AreaContactRecord | null,
  content: AreaContactContent,
  basedOn: number,
  actor: string,
  at: string,
): Outcome<{ record: AreaContactRecord; event: LedgerEvent }> {
  if (!current) return refuse('not_found', 'no such person');
  if (basedOn !== current.version) return refuse('conflict', 'someone changed this entry since you opened it; reload to see their change');
  const record: AreaContactRecord = { ...current, ...content, version: current.version + 1, updatedAt: at, updatedBy: actor };
  return { ok: true, value: { record, event: contactEvent('changed', record, actor) } };
}

export function removeAreaContact(current: AreaContactRecord | null, actor: string): Outcome<LedgerEvent> {
  if (!current) return refuse('not_found', 'no such person');
  return { ok: true, value: contactEvent('removed', current, actor) };
}

const contactDistrict = (d: Pick<District, 'kind' | 'geoid' | 'state' | 'name'>): ContactDistrict => ({ kind: d.kind, geoid: d.geoid, state: d.state, name: d.name });

/** An admin entry as the page shows it. */
export function areaContactView(record: AreaContactRecord): AreaContact {
  return {
    contactId: record.contactId,
    source: 'admin',
    role: record.role,
    office: record.office,
    officeTitle: record.officeTitle,
    district: contactDistrict(record.district),
    name: record.name,
    party: record.party,
    email: record.email,
    contactUrl: record.contactUrl,
    website: record.website,
    sourceUrl: null,
    election: record.electionDate,
    incumbent: false,
    photo: null,
    profile: null,
  };
}

/**
 * Whether a person's district is in the member's area: nationwide and statewide offices always are; a district only
 * when the member's ZIP code reaches into it. When the ZIP code could not be placed, the page lists only nationwide and
 * statewide offices, rather than every district in the state.
 */
export function inContactArea(district: Pick<District, 'kind' | 'geoid' | 'state'>, area: CandidateArea): boolean {
  if (district.kind === 'nation') return true;
  if (district.state !== area.state) return false;
  if (district.kind === 'state') return true;
  return area.basis === 'zip' && area.districts.some((d) => d.kind === district.kind && d.geoid === district.geoid);
}

/** The districts the page has a section for: the nation, the state, then the districts the ZIP code reaches into. */
export function contactDistricts(area: CandidateArea): ContactDistrict[] {
  return [
    { kind: 'nation', geoid: NATION_ID, state: null, name: 'United States' },
    { kind: 'state', geoid: STATE_FIPS[area.state] ?? area.state, state: area.state, name: area.state },
    ...(area.basis === 'zip' ? area.districts.map(contactDistrict) : []),
  ];
}

/** A name compared loosely: accents, case, punctuation and extra spaces ignored. */
export function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The feeds' people and the admins' entries together. An entry for the same person (role, office, district and name)
 * takes the place of the feed's, so an admin can add the email address a public record lacks; what the entry leaves
 * empty (party, contact form, website) and the record's link, incumbency, photo and profile are kept from the record.
 */
export function mergeContacts(found: readonly AreaContact[], entered: readonly AreaContact[]): AreaContact[] {
  const key = (c: AreaContact) => `${c.role}|${c.office}|${c.district.kind}:${c.district.geoid}|${nameKey(c.name)}`;
  const records = new Map(found.map((c) => [key(c), c]));
  const replaced = new Set(entered.map(key));
  return [
    ...found.filter((c) => !replaced.has(key(c))),
    ...entered.map((c) => {
      const record = records.get(key(c));
      if (!record) return c;
      return {
        ...c,
        party: c.party ?? record.party,
        email: c.email ?? record.email,
        contactUrl: c.contactUrl ?? record.contactUrl,
        website: c.website ?? record.website,
        sourceUrl: record.sourceUrl,
        incumbent: c.incumbent || record.incumbent,
        photo: record.photo,
        profile: record.profile,
      };
    }),
  ];
}

const FEDERAL: readonly PublicOffice[] = ['us_president', 'us_senate', 'us_house'];
const surname = (name: string) => nameKey(name).split(' ').at(-1) ?? '';

/**
 * The ballot's candidates (`civic`) added to the other records'. For Congress and President the FEC already lists who
 * has filed: a ballot candidate in the same race with the same name, or the only one there with the same surname, is
 * that FEC candidate, who gains the ballot's website, email address and photo where the FEC has none; anyone else on
 * the ballot is listed as well.
 */
export function mergeBallot(found: readonly AreaContact[], ballot: readonly AreaContact[]): AreaContact[] {
  const race = (c: AreaContact) => `${c.office}|${c.district.kind}:${c.district.geoid}`;
  const merged = [...found];
  const extra: AreaContact[] = [];
  for (const b of ballot) {
    const same = FEDERAL.includes(b.office) ? merged.filter((c) => c.source === 'fec' && race(c) === race(b)) : [];
    const bySurname = same.filter((c) => surname(c.name) === surname(b.name));
    const match = same.find((c) => nameKey(c.name) === nameKey(b.name)) ?? (bySurname.length === 1 ? bySurname[0] : undefined);
    if (!match) {
      extra.push(b);
      continue;
    }
    merged[merged.indexOf(match)] = {
      ...match,
      party: match.party ?? b.party,
      email: match.email ?? b.email,
      website: match.website ?? b.website,
      photo: match.photo ?? b.photo,
      election: b.election ?? match.election,
    };
  }
  return [...merged, ...extra];
}

/**
 * The state's own list of who is on its ballot (`sos`) over the other records, race by race: for a race the state
 * lists, its candidates are the ones the state lists, each the FEC (or the ballot) also has keeping that record, with
 * its link, photo and profile, and taking the party as the state's ballot words it; the others in that race (who lost the primary, withdrew or never qualified) are left
 * out. Races the state does not list keep the other records' candidates, except the seats it says are not up, which
 * have none. People in office are kept as they are.
 */
export function mergeStateList(found: readonly AreaContact[], listed: readonly AreaContact[], notUp: readonly SeatNotUp[]): AreaContact[] {
  const race = (c: AreaContact) => `${c.office}|${c.district.kind}:${c.district.geoid}`;
  const listedRaces = new Set(listed.map(race));
  const kept = found.filter((c) => c.role !== 'candidate' || (!listedRaces.has(race(c)) && !seatNotUp(notUp, c)));
  const fromState = listed.map((l) => {
    const same = found.filter((c) => c.role === 'candidate' && race(c) === race(l));
    const bySurname = same.filter((c) => surname(c.name) === surname(l.name));
    const match = same.find((c) => nameKey(c.name) === nameKey(l.name)) ?? (bySurname.length === 1 ? bySurname[0] : undefined);
    return match ? { ...match, party: l.party ?? match.party, incumbent: match.incumbent || l.incumbent, election: l.election ?? match.election } : l;
  });
  return [...kept, ...fromState];
}

/** One office in one district of the member's area, with who holds it and who runs for it. */
export interface AreaOfficeGroup {
  readonly office: PublicOffice;
  readonly district: ContactDistrict;
  readonly holders: readonly AreaContact[];
  readonly candidates: readonly AreaContact[];
}

const byName = (a: AreaContact, b: AreaContact) => a.name.localeCompare(b.name);

/**
 * Every office in the member's area, nationwide first, each with its people; offices nobody is listed for too. An
 * office with several seats (statewide, county, city) keeps its titles in the order the records first give them, so
 * the governor's race comes before the treasurer's.
 */
export function groupAreaContacts(area: CandidateArea, contacts: readonly AreaContact[]): AreaOfficeGroup[] {
  const titles = new Map<string, number>();
  for (const c of contacts) if (!titles.has(c.officeTitle)) titles.set(c.officeTitle, titles.size);
  const byTitle = (a: AreaContact, b: AreaContact) => titles.get(a.officeTitle)! - titles.get(b.officeTitle)!;
  return contactDistricts(area).flatMap((district) =>
    OFFICES_OF_KIND[district.kind].map((office) => {
      const here = contacts.filter((c) => c.office === office && c.district.kind === district.kind && c.district.geoid === district.geoid);
      return {
        office,
        district,
        holders: here.filter((c) => c.role === 'holder').sort((a, b) => byTitle(a, b) || byName(a, b)),
        candidates: here.filter((c) => c.role === 'candidate').sort((a, b) => byTitle(a, b) || Number(b.incumbent) - Number(a.incumbent) || byName(a, b)),
      };
    }),
  );
}

/** The general election day of a year: the Tuesday after the first Monday in November. */
export function generalElectionDay(year: number): string {
  const novFirst = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const firstMonday = 1 + ((8 - novFirst) % 7);
  return `${year}-11-${String(firstMonday + 1).padStart(2, '0')}`;
}

/** The next federal general election, held in even years: this year's until its day is over, then two years on. */
export function nextFederalElectionYear(today: string): number {
  const year = Number(today.slice(0, 4));
  if (year % 2 === 1) return year + 1;
  return today <= generalElectionDay(year) ? year : year + 2;
}

const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'DR', 'HON', 'REV']);
const SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V']);
const bare = (word: string) => word.replace(/\./g, '').toUpperCase();

function titleCaseWord(word: string): string {
  if (/^(II|III|IV|VI?)$/i.test(word)) return word.toUpperCase();
  return word
    .toLowerCase()
    .replace(/(^|[-'’])(\p{L})/gu, (_m, before: string, letter: string) => before + letter.toUpperCase())
    .replace(/^Mc(\p{L})/u, (_m, letter: string) => `Mc${letter.toUpperCase()}`);
}

/** A name as the FEC files it (`LEVIN, MIKE`, `SMITH, JOHN A JR.`) as people write it: `Mike Levin`, `John A Smith Jr.` */
export function fecDisplayName(raw: string): string {
  const comma = raw.indexOf(',');
  if (comma < 0) return raw.trim().split(/\s+/).filter(Boolean).map(titleCaseWord).join(' ');
  const last = raw.slice(0, comma).trim();
  const words = raw
    .slice(comma + 1)
    .trim()
    .split(/\s+/)
    .filter((w) => w && !TITLES.has(bare(w)));
  const given = words.filter((w) => !SUFFIXES.has(bare(w)));
  const suffixes = words.filter((w) => SUFFIXES.has(bare(w)));
  return [...given, ...last.split(/\s+/), ...suffixes].filter(Boolean).map(titleCaseWord).join(' ');
}
