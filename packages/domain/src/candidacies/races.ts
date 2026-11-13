import { ordinal } from '../bills/bills.js';
import { US_STATES } from '../membership/places.js';
import { samePerson } from './area-sections.js';
import type { PublicOffice } from './candidacy.js';
import { CONTACT_FEEDS, groupAreaContacts, type AreaContact, type AreaOfficeGroup, type ContactDistrict, type ContactFeed, type ContactFeedState, type SeatNotUp } from './contacts.js';
import { NATION_ID, STATE_FIPS, type District } from './districts.js';
import type { PublicCandidacy } from './views.js';

/**
 * Race pages (design §5.17): a public page for each state and each seat in the U.S. House, "2028 candidates in CA-12",
 * that search engines list and people share. Each says who runs and who holds the seats now, from the same public
 * records as the Candidates page (§5.12), read once a day for everyone (`race_records`), with the Transhumanist Party's
 * own candidates there first. Decided with the user (2026-11-12): addresses `/races/ca` and `/races/ca/12`
 * (`/races/wy/at-large`); states and House seats only; and a page of their own, listed too, for each public-record
 * person with an official ID, `/people/H8CA49058` (an FEC candidate) or `/people/L000593` (a member of Congress).
 */

/**
 * Seats in the U.S. House by state, from the 2020 apportionment (the 118th to 122nd Congresses); 1 is one at-large
 * seat. DC and the five territories each elect one member who does not vote on the floor: a Delegate, or Puerto Rico's
 * Resident Commissioner.
 */
export const HOUSE_SEATS: Readonly<Record<string, number>> = {
  AL: 7, AK: 1, AZ: 9, AR: 4, CA: 52, CO: 8, CT: 5, DE: 1, DC: 1, FL: 28, GA: 14, HI: 2, ID: 2, IL: 17, IN: 9, IA: 4,
  KS: 4, KY: 6, LA: 6, ME: 2, MD: 8, MA: 9, MI: 13, MN: 8, MS: 4, MO: 8, MT: 2, NE: 3, NV: 4, NH: 2, NJ: 12, NM: 3,
  NY: 26, NC: 14, ND: 1, OH: 15, OK: 5, OR: 6, PA: 17, RI: 2, SC: 7, SD: 1, TN: 9, TX: 38, UT: 4, VT: 1, VA: 11,
  WA: 10, WV: 2, WI: 8, WY: 1, AS: 1, GU: 1, MP: 1, PR: 1, VI: 1,
};

/** DC and the territories: no senators, and a non-voting member of the House. */
export const NON_STATES: ReadonlySet<string> = new Set(['DC', 'AS', 'GU', 'MP', 'PR', 'VI']);

/**
 * The states with a Senate seat of each class: class 1 is elected in 2024, 2030…, class 2 in 2026, 2032…, class 3 in
 * 2028, 2034…. Every state has two of the three. A vacancy's special election can fall in another year; the FEC lists
 * its candidates all the same.
 */
const SENATE_CLASSES: readonly (readonly string[])[] = [
  'AZ CA CT DE FL HI IN ME MD MA MI MN MS MO MT NE NV NJ NM NY ND OH PA RI TN TX UT VT VA WA WV WI WY'.split(' '),
  'AL AK AR CO DE GA ID IL IA KS KY LA ME MA MI MN MS MT NE NH NJ NM NC OK OR RI SC SD TN TX VA WV WY'.split(' '),
  'AL AK AZ AR CA CO CT FL GA HI ID IL IN IA KS KY LA MD MO NV NH NY NC ND OH OK OR PA SC SD UT VT WA WI'.split(' '),
];

/** Whether a state elects one of its senators in a year's regular election. */
export function senateUp(state: string, year: number): boolean {
  // Class 1 in years 2 more than a multiple of 6 (2024, 2030), class 2 in 4 more (2026), class 3 in multiples (2028).
  const cls = ({ 2: 0, 4: 1, 0: 2 } as Record<number, number>)[((year % 6) + 6) % 6];
  return cls !== undefined && SENATE_CLASSES[cls]!.includes(state);
}

/** A House seat, as its page's address has it: the district's number, or `at-large` where the state has one seat. */
export type RaceSeat = number | 'at-large';

/** A race page's place: a state (its Senate seats, statewide offices, President and House seats), or one House seat. */
export interface RacePlace {
  /** Two-letter code, upper case. */
  readonly state: string;
  /** Null for the state's page. */
  readonly seat: RaceSeat | null;
}

const STATE_NAMES = new Map(US_STATES.map((s) => [s.code, s.name]));
/** The places whose names take "the" in a sentence. */
const WITH_THE: ReadonlySet<string> = new Set(['DC', 'MP', 'VI']);
/** A state's name as a sentence has it: "California", "the District of Columbia". */
export const raceStateName = (state: string): string => `${WITH_THE.has(state) ? 'the ' : ''}${STATE_NAMES.get(state) ?? state}`;

/**
 * The race page an address names (`/races/{state}/{district}`), or null for none: the state in lower case, a district
 * from 1 to the state's seats with no leading zero, or `at-large` for a state with one seat. Anything else, such as
 * `/races/CA` or `/races/ca/012`, is no page, so each page has one address.
 */
export function racePlace(state: string, district?: string): RacePlace | null {
  if (!/^[a-z]{2}$/.test(state)) return null;
  const code = state.toUpperCase();
  const seats = HOUSE_SEATS[code];
  if (seats === undefined) return null;
  if (district === undefined) return { state: code, seat: null };
  if (district === 'at-large') return seats === 1 ? { state: code, seat: 'at-large' } : null;
  if (!/^[1-9][0-9]?$/.test(district) || seats === 1 || Number(district) > seats) return null;
  return { state: code, seat: Number(district) };
}

export function racePath(place: RacePlace): string {
  const state = `/races/${place.state.toLowerCase()}`;
  return place.seat === null ? state : `${state}/${place.seat}`;
}

/** The House seats of a state, in order. */
export function houseSeats(state: string): RaceSeat[] {
  const seats = HOUSE_SEATS[state] ?? 0;
  return seats === 1 ? ['at-large'] : Array.from({ length: seats }, (_, i) => i + 1);
}

/** Every race page: each state's, in the states' order, followed by its House seats'. */
export function racePlaces(): RacePlace[] {
  return Object.keys(HOUSE_SEATS).flatMap((state) => [{ state, seat: null }, ...houseSeats(state).map((seat) => ({ state, seat }))]);
}

/**
 * A House seat's Census GEOID: the state's FIPS code and the district's two digits. An at-large seat is `00`, except DC's
 * and the territories' delegates, which the Census numbers `98`.
 */
export function seatGeoid(state: string, seat: RaceSeat): string {
  const fips = STATE_FIPS[state] ?? '';
  if (seat !== 'at-large') return fips + String(seat).padStart(2, '0');
  return fips + (NON_STATES.has(state) ? '98' : '00');
}

/** The seat a congressional district's GEOID is, or null for none of the House's. */
export function seatOfGeoid(geoid: string): RacePlace | null {
  const state = Object.keys(STATE_FIPS).find((code) => STATE_FIPS[code] === geoid.slice(0, 2));
  if (!state || HOUSE_SEATS[state] === undefined || !/^\d{4}$/.test(geoid)) return null;
  const n = Number(geoid.slice(2));
  if (HOUSE_SEATS[state] === 1) return n === 0 || n === 98 ? { state, seat: 'at-large' } : null;
  return n >= 1 && n <= HOUSE_SEATS[state]! ? { state, seat: n } : null;
}

/**
 * The race page a person belongs on, from their office and district: their House seat's; their state's for the Senate
 * and statewide offices; none for President (every state's page lists that race) or for other offices.
 */
export function raceOf(person: { readonly office: PublicOffice; readonly district: Pick<ContactDistrict, 'kind' | 'geoid' | 'state'> }): RacePlace | null {
  const { office, district } = person;
  if (office === 'us_house' && district.kind === 'congressional') return seatOfGeoid(district.geoid);
  if ((office === 'us_senate' || office === 'statewide') && district.kind === 'state' && district.state && HOUSE_SEATS[district.state] !== undefined) {
    return { state: district.state, seat: null };
  }
  return null;
}

/** "CA-12", "WY-AL", or the state's code for its page. */
export function raceCode(place: RacePlace): string {
  if (place.seat === null) return place.state;
  return `${place.state}-${place.seat === 'at-large' ? 'AL' : place.seat}`;
}

/** "California's", "Texas's", "the U.S. Virgin Islands'". */
function possessive(state: string): string {
  const name = raceStateName(state);
  return `${name}${/Islands$/.test(name) ? '’' : '’s'}`;
}

/** The seat in words: "California’s 12th congressional district", "Wyoming’s at-large seat", "Guam’s seat in the U.S. House". */
export function seatName(place: RacePlace): string {
  if (place.seat === null) return raceStateName(place.state);
  if (place.seat !== 'at-large') return `${possessive(place.state)} ${ordinal(place.seat)} congressional district`;
  return NON_STATES.has(place.state) ? `${possessive(place.state)} seat in the U.S. House` : `${possessive(place.state)} at-large congressional district`;
}

/** A race page's title, as the page heads it and its link preview names it: "2028 candidates in CA-12". */
export function raceTitle(place: RacePlace, electionYear: number): string {
  if (place.seat === null) return `${electionYear} candidates in ${raceStateName(place.state)}`;
  if (place.seat === 'at-large') return `${electionYear} candidates for ${seatName(place)}`;
  return `${electionYear} candidates in ${raceCode(place)}`;
}

/** An FEC candidate ID (`H8CA49058`) or a Congress Bioguide ID (`L000593`): what a person's own page is found by. */
export const PERSON_ID = /^(?:[HSP][0-9A-Z]{8}|[A-Z][0-9]{6})$/;

/** The contact ID a person's page address stands for (`fec:H8CA49058`, `congress:L000593`), or null for none. */
export function personContactId(id: string): string | null {
  if (!PERSON_ID.test(id)) return null;
  return id.length === 9 ? `fec:${id}` : `congress:${id}`;
}

/** Where a person's own page is, for someone a record lists by an official ID; null for anyone else. */
export function personPath(contactId: string): string | null {
  const id = contactId.replace(/^(fec|congress):/, '');
  const feed = contactId.slice(0, contactId.length - id.length - 1);
  if ((feed === 'fec' && id.length === 9) || (feed === 'congress' && id.length === 7)) return PERSON_ID.test(id) ? `/people/${id}` : null;
  return null;
}

/**
 * Where a person whose page has no record yet would be found: the state their FEC candidate ID was filed in (`H8CA49058`
 * is California), or the nation's records for a presidential candidate. A Bioguide ID says nothing about the state.
 */
export function personRecordsKey(id: string): string | null {
  if (!PERSON_ID.test(id) || id.length !== 9) return null;
  if (id.startsWith('P')) return NATION_ID;
  const state = id.slice(2, 4);
  return HOUSE_SEATS[state] !== undefined ? state : null;
}

/**
 * `race_records/{key}`: what the public records said about a state's federal races (`key` the state's code), or the
 * presidency's (`US`), when last read, for every race page, person's page and api instance to share. Read again once
 * it is a day old (an hour, when a record did not answer). Public records only: no Google ballot data, which may not be
 * kept (§5.12), and no profiles, which each api instance keeps a day itself.
 */
export interface RaceRecordsRecord {
  readonly key: string;
  readonly electionYear: number;
  readonly checkedAt: string;
  /** When it is read again. */
  readonly freshUntil: string;
  readonly contacts: readonly AreaContact[];
  readonly notUp: readonly SeatNotUp[];
  readonly feeds: Readonly<Record<ContactFeed, ContactFeedState>>;
  /** The contact IDs of the people with a page of their own (`personPath`), to find which record holds someone. */
  readonly people: readonly string[];
}

/** No records at all: a feed state for each, for a page with nothing read yet. */
export const NO_FEEDS: Readonly<Record<ContactFeed, ContactFeedState>> = Object.fromEntries(CONTACT_FEEDS.map((f) => [f, 'off'])) as Record<ContactFeed, ContactFeedState>;

/** The contact IDs of a record's people with a page of their own, each once. */
export const peopleWithPages = (contacts: readonly AreaContact[]): string[] => [...new Set(contacts.map((c) => c.contactId).filter((id) => personPath(id) !== null))];

const STATE_OFFICES: readonly PublicOffice[] = ['us_president', 'us_senate', 'statewide'];

/** Whether a person is on a race page: for a House seat, its people; for a state, its Senate seats', statewide offices' and President's. */
export function onRacePage(place: RacePlace, person: Pick<AreaContact, 'office' | 'district'>): boolean {
  if (place.seat !== null) return person.office === 'us_house' && person.district.geoid === seatGeoid(place.state, place.seat);
  if (person.office === 'us_president') return person.district.kind === 'nation';
  return STATE_OFFICES.includes(person.office) && person.district.kind === 'state' && person.district.state === place.state;
}

/** The party's candidates a race page lists, elections not over: for a House seat, its own; for a state, all of the state's and the nation's. */
export function racePartyCandidates(place: RacePlace, candidacies: readonly PublicCandidacy[], today: string): PublicCandidacy[] {
  return candidacies.filter((c) => {
    if (c.electionDate < today) return false;
    if (place.seat !== null) return c.office === 'us_house' && c.district.geoid === seatGeoid(place.state, place.seat);
    return c.district.kind === 'nation' || c.district.state === place.state;
  });
}

/** One House seat on its state's page: who holds it now, and how many run for it. */
export interface RaceSeatSummary {
  readonly seat: RaceSeat;
  readonly code: string;
  readonly path: string;
  readonly holders: readonly Pick<AreaContact, 'contactId' | 'name' | 'party'>[];
  /** How many the records list as running. */
  readonly running: number;
  /** How many of the party's candidates run for it. */
  readonly party: number;
}

/** A state's House seats, each with who holds it and how many run. */
export function raceSeats(state: string, contacts: readonly AreaContact[], party: readonly PublicCandidacy[]): RaceSeatSummary[] {
  return houseSeats(state).map((seat) => {
    const place = { state, seat };
    const here = contacts.filter((c) => onRacePage(place, c));
    return {
      seat,
      code: raceCode(place),
      path: racePath(place),
      holders: here.filter((c) => c.role === 'holder').map(({ contactId, name, party }) => ({ contactId, name, party })),
      running: here.filter((c) => c.role === 'candidate').length,
      party: party.filter((c) => c.office === 'us_house' && c.district.geoid === seatGeoid(state, seat)).length,
    };
  });
}

/** `GET /v1/public/races/{state}` and `GET /v1/public/races/{state}/{district}`: a race page. */
export interface RaceView {
  readonly state: string;
  readonly seat: RaceSeat | null;
  readonly code: string;
  readonly title: string;
  /** The federal general election it is for (`nextFederalElectionYear`). */
  readonly electionYear: number;
  /** A House seat's Census district, with the point and lines for its map; null for a state. */
  readonly district: District | null;
  /** The Transhumanist Party's candidates there: members' approved candidacies. */
  readonly party: readonly PublicCandidacy[];
  /** Who holds the page's offices now, from public records, with biographies where Wikidata knows them. */
  readonly holders: readonly AreaContact[];
  /** Who runs for them, from public records, the party's own candidates among them left out. */
  readonly candidates: readonly AreaContact[];
  readonly notUp: readonly SeatNotUp[];
  /** On a state's page, its House seats; none on a seat's. */
  readonly seats: readonly RaceSeatSummary[];
  readonly feeds: Readonly<Record<ContactFeed, ContactFeedState>>;
  readonly profiles: ContactFeedState;
  /** When the public records were last read; null when they could not be. */
  readonly checkedAt: string | null;
}

/**
 * The seats on a race page that are not up this year: those the state's own list says so (§5.12), and a state's Senate
 * seats when neither is elected this year and nobody is listed for a special election.
 */
export function raceNotUp(place: RacePlace, notUp: readonly SeatNotUp[], candidates: readonly AreaContact[], electionYear: number): SeatNotUp[] {
  const shown = notUp.filter((s) => (place.seat === null ? s.kind !== 'congressional' : s.kind === 'congressional' && s.geoid === seatGeoid(place.state, place.seat)));
  const senate = { office: 'us_senate', kind: 'state', geoid: STATE_FIPS[place.state] ?? place.state } as const;
  const noSenate = place.seat === null && !NON_STATES.has(place.state) && !senateUp(place.state, electionYear) && !candidates.some((c) => c.office === 'us_senate');
  return noSenate && !shown.some((s) => s.office === 'us_senate') ? [...shown, senate] : shown;
}

/**
 * A race page's offices for who holds them (`holders`) or who runs (`candidates`), each with its people: on a state's
 * page the Senate, and President for who runs; on a seat's, the House seat. Statewide offices only where someone is
 * listed (California's own list of candidates), since no record the pages read lists their holders, and the
 * communications team's entries (§5.12) are not on these pages. DC and the territories have no Senate card.
 */
export function raceGroups(view: Pick<RaceView, 'state' | 'seat' | 'district' | 'holders' | 'candidates'>, part: 'holders' | 'candidates'): AreaOfficeGroup[] {
  const district = view.seat === null ? null : (view.district ?? houseDistrict(view.state, view.seat));
  const area = district ? { state: view.state, districts: [district], basis: 'zip' as const } : { state: view.state, districts: [], basis: 'no_zip' as const };
  return groupAreaContacts(area, [...view.holders, ...view.candidates]).filter((g) => {
    if (view.seat !== null) return g.office === 'us_house';
    if (g.office === 'us_house' || (g.office === 'us_senate' && NON_STATES.has(view.state))) return false;
    if (g.office === 'us_president') return part === 'candidates';
    if (g.office === 'statewide') return g[part].length > 0;
    return true;
  });
}

/** A House seat's district when the Census list is not to hand: its GEOID and the Census's way of naming it. */
export function houseDistrict(state: string, seat: RaceSeat): District {
  const name = seat === 'at-large' ? (NON_STATES.has(state) ? 'Delegate District (at Large)' : 'Congressional District (at Large)') : `Congressional District ${seat}`;
  return { kind: 'congressional', geoid: seatGeoid(state, seat), state, name, point: null, vintage: null };
}

/** `GET /v1/public/people/{id}`: a public-record person's own page. */
export interface PersonView {
  /** As their race lists them, with their biography where Wikidata knows them. */
  readonly person: AreaContact;
  readonly electionYear: number;
  /** Their race's page; null for President, which every state's page lists. */
  readonly race: { readonly path: string; readonly code: string; readonly title: string; readonly seat: string } | null;
  /** The same person in their other part: a member of Congress's own run for the seat, or a candidate who holds it now. */
  readonly also: AreaContact | null;
  /** Everyone else listed for the same seat, in office or running. */
  readonly others: readonly AreaContact[];
  readonly checkedAt: string;
}

/** A person's page from their race's records; null when the records do not list them. Profiles are the caller's to add. */
export function personView(contactId: string, record: Pick<RaceRecordsRecord, 'contacts' | 'electionYear' | 'checkedAt'>): PersonView | null {
  const person = record.contacts.find((c) => c.contactId === contactId);
  if (!person) return null;
  const seat = (c: AreaContact) => c.office === person.office && c.district.kind === person.district.kind && c.district.geoid === person.district.geoid;
  const also = record.contacts.find((c) => c.contactId !== contactId && c.role !== person.role && seat(c) && samePerson(c, person)) ?? null;
  const others = record.contacts.filter((c) => c.contactId !== contactId && c !== also && seat(c));
  const place = raceOf(person);
  return {
    person,
    electionYear: record.electionYear,
    race: place ? { path: racePath(place), code: raceCode(place), title: raceTitle(place, record.electionYear), seat: seatName(place) } : null,
    also,
    others,
    checkedAt: record.checkedAt,
  };
}

/** The race pages the sitemap lists (the index, `/races`, is among `SITEMAP_PAGES`): every state's and seat's, then each person's the records hold. */
export function raceSitemapPaths(people: Iterable<string>): string[] {
  const pages = [...new Set([...people].map(personPath).filter((p): p is string => p !== null))].sort();
  return [...racePlaces().map(racePath), ...pages];
}
