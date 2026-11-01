import { Logger } from '@nestjs/common';
import {
  CONTACT_FEEDS,
  CONTACT_LIMITS,
  DEFAULT_OFFICE_TITLES,
  fecDisplayName,
  mergeBallot,
  nameKey,
  NATION_ID,
  STATE_FIPS,
  type AreaContact,
  type BallotCandidate,
  type BallotContest,
  type ContactDistrict,
  type ContactFeed,
  type ContactFeedState,
  type ContactPhoto,
  type District,
  type DistrictKind,
  type PublicOffice,
} from 'ustp-domain';
import type { ContactKeys } from '../api-keys/api-keys.js';

/** What the records answer for an area: its people, the ballot's contests the api could not place, and each record's state. */
export interface AreaRecords {
  readonly contacts: AreaContact[];
  readonly ballot: BallotContest[];
  readonly feeds: Record<ContactFeed, ContactFeedState>;
}

/**
 * Where the Your area page's office holders and candidates come from (design §5.12), besides what Communications
 * Admins enter: public records, each kept a day.
 */
export interface ContactSource {
  /**
   * The people the records list for an area: the nation, the state and the districts its ZIP code reaches into, for
   * the federal general election of `electionYear`; with `holders` false, only people running. The ballot is asked
   * for by the five-digit ZIP code, which is all of the address that leaves the api; none, no ballot.
   */
  forArea(state: string, districts: readonly District[], electionYear: number, options: { readonly zip: string | null; readonly holders: boolean }): Promise<AreaRecords>;
}

export const CONTACT_SOURCE = Symbol('ContactSource');

const FEC = 'https://api.open.fec.gov/v1/candidates/';
const LEGISLATORS = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
const OPEN_STATES = 'https://v3.openstates.org/people.geo';
const CIVIC = 'https://www.googleapis.com/civicinfo/v2/voterinfo';
const TIMEOUT_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED = 2000;

const NATION: ContactDistrict = { kind: 'nation', geoid: NATION_ID, state: null, name: 'United States' };
const stateDistrict = (state: string): ContactDistrict => ({ kind: 'state', geoid: STATE_FIPS[state] ?? state, state, name: state });
const contactDistrict = (d: District): ContactDistrict => ({ kind: d.kind, geoid: d.geoid, state: d.state, name: d.name });
const NO_PROFILE = { photo: null, profile: null } as const;

/** The House district number in a congressional GEOID: `0649` is 49; at-large (`00`) and DC's delegate (`98`) are 0. */
export function houseDistrictNumber(geoid: string): number {
  const n = Number(geoid.slice(2));
  return n === 98 ? 0 : n;
}

/** Delegates and Puerto Rico's Resident Commissioner sit in the House for DC and the territories. */
function houseTitle(state: string): string {
  if (state === 'PR') return 'Resident Commissioner';
  return ['DC', 'AS', 'GU', 'MP', 'VI'].includes(state) ? 'Delegate to the U.S. House' : DEFAULT_OFFICE_TITLES.us_house;
}

/** "REPUBLICAN PARTY" → "Republican Party". */
const titleCase = (text: string) => text.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, before: string, letter: string) => before + letter.toUpperCase());

interface FecCandidate {
  readonly candidate_id: string;
  readonly name: string;
  readonly party_full?: string | null;
  readonly incumbent_challenge?: string | null;
}

interface Legislator {
  readonly id: { readonly bioguide: string };
  readonly name: { readonly first: string; readonly last: string; readonly official_full?: string };
  readonly terms: readonly {
    readonly type: 'rep' | 'sen';
    readonly state: string;
    readonly district?: number;
    readonly party?: string;
    readonly url?: string;
    readonly contact_form?: string;
  }[];
}

interface OpenStatesPerson {
  readonly id: string;
  readonly name: string;
  readonly party?: string;
  readonly email?: string;
  readonly openstates_url?: string;
  readonly jurisdiction?: { readonly classification?: string };
  readonly current_role?: { readonly title?: string; readonly org_classification?: string };
  readonly links?: readonly { readonly url?: string }[];
}

interface CivicCandidate {
  readonly name?: string;
  readonly party?: string;
  readonly candidateUrl?: string;
  readonly photoUrl?: string;
  readonly email?: string;
}

interface CivicContest {
  readonly type?: string;
  readonly office?: string;
  readonly ballotTitle?: string;
  readonly level?: readonly string[];
  readonly roles?: readonly string[];
  readonly district?: { readonly name?: string; readonly scope?: string; readonly id?: string };
  readonly candidates?: readonly CivicCandidate[];
}

/** What the Civic Information API answers for a ZIP code: the election it has data for, and that election's contests. */
interface Ballot {
  readonly electionId: string;
  readonly electionDay: string | null;
  readonly contests: readonly CivicContest[];
}

const NO_BALLOT: Ballot = { electionId: '', electionDay: null, contests: [] };

/** Only `https://` addresses are passed on, since the page links to them. */
const https = (url: string | undefined | null) => (url && /^https:\/\//.test(url) && url.length <= CONTACT_LIMITS.url ? url : null);
const emailAddress = (v: string | undefined | null) => (v && v.length <= CONTACT_LIMITS.email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v) ? v : null);
const text = (v: string | undefined | null, max: number) => {
  const t = v?.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

/** The Civic Information API's district scopes, as the kinds of district the pages list; other scopes have none. */
const CIVIC_SCOPES: Readonly<Record<string, DistrictKind>> = {
  national: 'nation',
  statewide: 'state',
  congressional: 'congressional',
  stateUpper: 'state_upper',
  stateLower: 'state_lower',
  countywide: 'county',
  countyCouncil: 'county',
  citywide: 'place',
  cityCouncil: 'place',
};

/** Which office a contest is for, from its kind of district, level and roles; null for one the pages have no office for. */
function civicOffice(kind: DistrictKind, contest: CivicContest): PublicOffice | null {
  const federal = contest.level?.includes('country') ?? false;
  const roles = contest.roles ?? [];
  const office = contest.office ?? '';
  switch (kind) {
    case 'nation':
      return roles.includes('headOfState') || roles.includes('headOfGovernment') || /president/i.test(office) ? 'us_president' : null;
    case 'state':
      return federal && (roles.includes('legislatorUpperBody') || /senat/i.test(office)) ? 'us_senate' : 'statewide';
    case 'congressional':
      return 'us_house';
    case 'state_upper':
      return 'state_upper';
    case 'state_lower':
      return 'state_lower';
    case 'county':
      return 'county';
    case 'place':
      return 'local';
  }
}

/** A county's or place's name as both the Census and an OCD division ID write it: "San Diego County", "san_diego". */
const placeKey = (name: string) => nameKey(name.replace(/_/g, ' ')).replace(/ (county|parish|borough|city|town|village|cdp|municipality)$/, '');

/**
 * The area's Census district a contest is for: by its Open Civic Data division ID (`…/cd:49`, `…/sldu:38`,
 * `…/county:san_diego`), else the area's only district of that kind. Null when it is none of the area's districts, or
 * the area has several of that kind and the contest does not say which.
 */
export function civicDistrict(kind: DistrictKind, ocdId: string, state: string, districts: readonly District[]): ContactDistrict | null {
  if (kind === 'nation') return NATION;
  if (kind === 'state') return stateDistrict(state);
  const ofKind = districts.filter((d) => d.kind === kind);
  const part = (re: RegExp) => ocdId.match(re)?.[1];
  const fips = STATE_FIPS[state] ?? '';
  const numbered: Partial<Record<DistrictKind, [RegExp, number]>> = { congressional: [/\/cd:(\d+)$/, 2], state_upper: [/\/sldu:(\d+)$/, 3], state_lower: [/\/sldl:(\d+)$/, 3] };
  const numberedAs = numbered[kind];
  const n = numberedAs && part(numberedAs[0]);
  if (numberedAs && n) {
    const hit = ofKind.find((d) => d.geoid === fips + n.padStart(numberedAs[1], '0'));
    return hit ? contactDistrict(hit) : null;
  }
  const named = kind === 'county' ? part(/\/county:([^/]+)/) : kind === 'place' ? part(/\/place:([^/]+)/) : undefined;
  if (named) {
    const hit = ofKind.find((d) => placeKey(d.name) === placeKey(named));
    return hit ? contactDistrict(hit) : null;
  }
  return ofKind.length === 1 ? contactDistrict(ofKind[0]!) : null;
}

/** "Max-Age" the answer allows, capped at a day: Google's rule for contests is to obey it, and keep them a day at most. */
function keepFor(cacheControl: string | null): number {
  if (!cacheControl) return DAY_MS;
  if (/no-store|no-cache/i.test(cacheControl)) return 0;
  const maxAge = cacheControl.match(/max-age=(\d+)/i);
  return maxAge ? Math.min(Number(maxAge[1]) * 1000, DAY_MS) : DAY_MS;
}

const slug = (v: string) => nameKey(v).replace(/ /g, '-');

/**
 * The FEC (candidates for Congress and President who have filed for the election and reported raising money), the
 * `unitedstates/congress-legislators` data (who sits in Congress now), Open States (state legislators, with a key) and
 * the Civic Information API (the contests on the ballot, with a key, while an election is loaded). What a record
 * answers is kept a day (the ballot as long as its answer allows, at most a day); a record that fails is asked again
 * next time, and the page says it is missing.
 */
export class PublicContactSource implements ContactSource {
  private readonly logger = new Logger(PublicContactSource.name);
  private readonly cache = new Map<string, { readonly until: number; readonly value: Promise<unknown> }>();

  constructor(
    /** The keys, or where to ask for them each time (`ApiKeys`, which a System Admin's change reaches within a minute). */
    private readonly keys: ContactKeys | (() => Promise<ContactKeys>),
    private readonly fetchFn: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init),
  ) {}

  async forArea(state: string, districts: readonly District[], electionYear: number, options: { readonly zip: string | null; readonly holders: boolean }): Promise<AreaRecords> {
    const keys = typeof this.keys === 'function' ? await this.keys() : this.keys;
    const feeds: Record<ContactFeed, ContactFeedState> = {
      fec: 'ok',
      congress: options.holders ? 'ok' : 'off',
      openstates: options.holders && keys.openStates ? 'ok' : 'off',
      civic: keys.civic && options.zip ? 'ok' : 'off',
    };
    const ask = async <T>(feed: ContactFeed, found: () => Promise<T>, none: T): Promise<T> => {
      try {
        return await found();
      } catch (e) {
        this.logger.warn(`${feed} unavailable: ${e instanceof Error ? e.message : String(e)}`);
        feeds[feed] = 'unavailable';
        return none;
      }
    };
    const house = districts.filter((d) => d.kind === 'congressional');
    const legislature = districts.filter((d) => (d.kind === 'state_upper' || d.kind === 'state_lower') && d.point);
    const [lists, ballot] = await Promise.all([
      Promise.all([
        ...(electionYear % 4 === 0 ? [ask('fec', () => this.fec(keys.fec, 'us_president', NATION, { office: 'P' }, electionYear), [])] : []),
        ask('fec', () => this.fec(keys.fec, 'us_senate', stateDistrict(state), { office: 'S', state }, electionYear), []),
        ...house.map((d) =>
          ask(
            'fec',
            () => this.fec(keys.fec, 'us_house', contactDistrict(d), { office: 'H', state, district: String(houseDistrictNumber(d.geoid)).padStart(2, '0') }, electionYear),
            [],
          ),
        ),
        ...(options.holders ? [ask('congress', async () => (await this.congress(state, house)).flat(), [])] : []),
        ...(feeds.openstates === 'ok' ? legislature.map((d) => ask('openstates', () => this.openStates(keys.openStates!, d), [])) : []),
      ]),
      feeds.civic === 'ok' ? ask('civic', () => this.civic(keys.civic!, options.zip!), NO_BALLOT) : Promise.resolve(NO_BALLOT),
    ]);
    const placed = ballotContacts(ballot, state, districts);
    return { contacts: mergeBallot(lists.flat(), placed.contacts), ballot: placed.unplaced, feeds };
  }

  /** The FEC's candidates for one race. */
  private fec(apiKey: string, office: PublicOffice, district: ContactDistrict, race: Record<string, string>, year: number): Promise<AreaContact[]> {
    const params = new URLSearchParams({
      ...race,
      api_key: apiKey,
      election_year: String(year),
      candidate_status: 'C',
      is_active_candidate: 'true',
      has_raised_funds: 'true',
      sort: 'name',
      per_page: '100',
    });
    return this.kept(`fec:${office}:${district.geoid}:${year}`, async () => {
      const body = await this.json<{ results?: FecCandidate[] }>(`${FEC}?${params}`);
      return (body.results ?? []).map(
        (c): AreaContact => ({
          contactId: `fec:${c.candidate_id}`,
          source: 'fec',
          role: 'candidate',
          office,
          officeTitle: office === 'us_house' ? houseTitle(district.state ?? '') : DEFAULT_OFFICE_TITLES[office],
          district,
          name: fecDisplayName(c.name),
          party: c.party_full ? titleCase(c.party_full) : null,
          email: null,
          contactUrl: null,
          website: null,
          sourceUrl: `https://www.fec.gov/data/candidate/${encodeURIComponent(c.candidate_id)}/`,
          election: String(year),
          incumbent: c.incumbent_challenge === 'I',
          ...NO_PROFILE,
        }),
      );
    });
  }

  /** The state's senators and the representatives of its districts. */
  private async congress(state: string, house: readonly District[]): Promise<AreaContact[][]> {
    const everyone = await this.kept('congress', () => this.json<Legislator[]>(LEGISLATORS));
    const person = (l: Legislator, office: PublicOffice, district: ContactDistrict): AreaContact => {
      const term = l.terms.at(-1)!;
      return {
        contactId: `congress:${l.id.bioguide}`,
        source: 'congress',
        role: 'holder',
        office,
        officeTitle: office === 'us_house' ? houseTitle(state) : DEFAULT_OFFICE_TITLES.us_senate,
        district,
        name: l.name.official_full ?? `${l.name.first} ${l.name.last}`,
        party: term.party ?? null,
        email: null,
        contactUrl: https(term.contact_form),
        website: https(term.url),
        sourceUrl: `https://bioguide.congress.gov/search/bio/${encodeURIComponent(l.id.bioguide)}`,
        election: null,
        incumbent: false,
        ...NO_PROFILE,
      };
    };
    const current = everyone.filter((l) => l.terms.at(-1)?.state === state);
    return [
      current.filter((l) => l.terms.at(-1)!.type === 'sen').map((l) => person(l, 'us_senate', stateDistrict(state))),
      ...house.map((d) =>
        current.filter((l) => l.terms.at(-1)!.type === 'rep' && l.terms.at(-1)!.district === houseDistrictNumber(d.geoid)).map((l) => person(l, 'us_house', contactDistrict(d))),
      ),
    ];
  }

  /** The state legislators whose districts hold the district's Census internal point, of its chamber. */
  private openStates(apiKey: string, district: District): Promise<AreaContact[]> {
    const office: PublicOffice = district.kind === 'state_upper' ? 'state_upper' : 'state_lower';
    const chambers = office === 'state_upper' ? ['upper', 'legislature'] : ['lower'];
    const { lat, lng } = district.point!;
    return this.kept(`openstates:${district.kind}:${district.geoid}`, async () => {
      const body = await this.json<{ results?: OpenStatesPerson[] }>(`${OPEN_STATES}?${new URLSearchParams({ lat: String(lat), lng: String(lng) })}&include=links`, {
        'X-API-KEY': apiKey,
      });
      return (body.results ?? [])
        .filter((p) => p.jurisdiction?.classification === 'state' && chambers.includes(p.current_role?.org_classification ?? ''))
        .map((p): AreaContact => {
          const title = p.current_role?.title?.trim() || DEFAULT_OFFICE_TITLES[office];
          return {
            contactId: `openstates:${p.id}`,
            source: 'openstates',
            role: 'holder',
            office,
            officeTitle: /^(Senator|Representative)$/i.test(title) ? `State ${title}` : title,
            district: contactDistrict(district),
            name: p.name,
            party: p.party ?? null,
            email: p.email?.includes('@') ? p.email : null,
            contactUrl: null,
            website: https(p.links?.[0]?.url),
            sourceUrl: https(p.openstates_url),
            election: null,
            incumbent: false,
            ...NO_PROFILE,
          };
        });
    });
  }

  /**
   * The ballot for a ZIP code. Google answers 400 or 404 when it has no election for the address, which is no ballot,
   * not a failure; a refused key is a failure. The key goes in a header, so it is in no address.
   */
  private civic(apiKey: string, zip: string): Promise<Ballot> {
    const key = `civic:${zip}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() < hit.until) return hit.value as Promise<Ballot>;
    const value = (async (): Promise<{ ballot: Ballot; keep: number }> => {
      const params = new URLSearchParams({ address: zip, returnAllAvailableData: 'true' });
      const res = await this.fetchFn(`${CIVIC}?${params}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json', 'x-goog-api-key': apiKey },
      });
      const keep = keepFor(res.headers.get('cache-control'));
      if (res.status === 400 || res.status === 404) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        if (/api key/i.test(body.error?.message ?? '')) throw new Error(`HTTP ${res.status}: ${body.error?.message}`);
        return { ballot: NO_BALLOT, keep };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { election?: { id?: string; electionDay?: string }; contests?: CivicContest[] };
      const day = body.election?.electionDay;
      return { ballot: { electionId: body.election?.id ?? '', electionDay: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null, contests: body.contests ?? [] }, keep };
    })();
    const ballot = value.then((v) => v.ballot);
    this.remember(key, ballot, DAY_MS);
    value.then(
      ({ keep }) => {
        if (keep === 0) this.cache.delete(key);
        else this.remember(key, ballot, keep);
      },
      () => this.cache.delete(key),
    );
    return ballot;
  }

  /** What `load` gives, kept a day under `key`; a failure is not kept. */
  private kept<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() < hit.until) return hit.value as Promise<T>;
    const value = load();
    value.catch(() => this.cache.delete(key));
    this.remember(key, value, DAY_MS);
    return value;
  }

  private remember(key: string, value: Promise<unknown>, ms: number): void {
    this.cache.delete(key);
    if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { until: Date.now() + ms, value });
  }

  private async json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json', ...headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

const BALLOT_PHOTO_CREDIT = 'Photo from the ballot data (Google Civic Information API)';

/**
 * The ballot's candidates, as people of the area where their contest is in one of its Census districts, and the other
 * contests (school boards, judges, special districts, or a district the api cannot tell) as they are. Measures, which
 * have no candidates, are left out.
 */
export function ballotContacts(ballot: Ballot, state: string, districts: readonly District[]): { contacts: AreaContact[]; unplaced: BallotContest[] } {
  const contacts: AreaContact[] = [];
  const unplaced: BallotContest[] = [];
  for (const contest of ballot.contests) {
    const candidates = (contest.candidates ?? []).flatMap((c): BallotCandidate[] => {
      const name = text(c.name, CONTACT_LIMITS.name);
      if (!name) return [];
      const photoUrl = https(c.photoUrl);
      const photo: ContactPhoto | null = photoUrl ? { url: photoUrl, credit: BALLOT_PHOTO_CREDIT, creditUrl: null } : null;
      return [{ name, party: text(c.party, CONTACT_LIMITS.party), website: https(c.candidateUrl), email: emailAddress(c.email), photo }];
    });
    if (!candidates.length) continue;
    const title = text(contest.office ?? contest.ballotTitle, CONTACT_LIMITS.officeTitle);
    const scope = contest.district?.scope ?? '';
    const kind = CIVIC_SCOPES[scope];
    const office = kind ? civicOffice(kind, contest) : null;
    const district = kind && office ? civicDistrict(kind, contest.district?.id ?? '', state, districts) : null;
    if (!kind || !office || !district) {
      unplaced.push({ office: title ?? 'Contest', district: text(contest.district?.name, CONTACT_LIMITS.officeTitle), election: ballot.electionDay, candidates });
      continue;
    }
    // A council seat is part of the county or city: its own district goes in the title.
    const seat = /Council$/.test(scope) && contest.district?.name ? `, ${contest.district.name}` : '';
    const officeTitle = text(`${title ?? DEFAULT_OFFICE_TITLES[office]}${seat}`, CONTACT_LIMITS.officeTitle)!;
    for (const c of candidates) {
      contacts.push({
        contactId: `civic:${ballot.electionId}:${district.kind}:${district.geoid}:${slug(officeTitle)}:${slug(c.name)}`,
        source: 'civic',
        role: 'candidate',
        office,
        officeTitle,
        district,
        name: c.name,
        party: c.party,
        email: c.email,
        contactUrl: null,
        website: c.website,
        sourceUrl: null,
        election: ballot.electionDay,
        incumbent: false,
        photo: c.photo,
        profile: null,
      });
    }
  }
  return { contacts, unplaced };
}

/**
 * Made-up people for the emulators (`DISTRICTS=local`): two senators and a Senate candidate per state, a representative
 * who runs again against a challenger in each congressional district, and a state legislator with an email address in
 * each legislative district. With a ZIP code, the ballot too: the challenger with a website, a State Senate race, and
 * a school board contest that is in no Census district.
 */
export class LocalContactSource implements ContactSource {
  async forArea(state: string, districts: readonly District[], electionYear: number, options: { readonly zip: string | null; readonly holders: boolean }): Promise<AreaRecords> {
    const base = { email: null, contactUrl: null, website: null, sourceUrl: null, election: null, incumbent: false, ...NO_PROFILE } as const;
    const s = stateDistrict(state);
    const contacts: AreaContact[] = [
      { ...base, contactId: `congress:S1${state}`, source: 'congress', role: 'holder', office: 'us_senate', officeTitle: 'U.S. Senator', district: s, name: 'Sam Senator', party: 'Democrat' },
      { ...base, contactId: `congress:S2${state}`, source: 'congress', role: 'holder', office: 'us_senate', officeTitle: 'U.S. Senator', district: s, name: 'Sky Senator', party: 'Republican' },
      { ...base, contactId: `fec:S${state}`, source: 'fec', role: 'candidate', office: 'us_senate', officeTitle: 'U.S. Senator', district: s, name: 'Sid Hopeful', party: 'Independent', election: String(electionYear) },
    ];
    for (const d of districts) {
      const district = contactDistrict(d);
      if (d.kind === 'congressional') {
        const rep = { ...base, office: 'us_house', officeTitle: 'U.S. Representative', district, name: 'Hal House', party: 'Democrat' } as const;
        contacts.push(
          { ...rep, contactId: `congress:H${d.geoid}`, source: 'congress', role: 'holder', contactUrl: 'https://house.example/contact', website: 'https://house.example' },
          { ...rep, contactId: `fec:H${d.geoid}`, source: 'fec', role: 'candidate', election: String(electionYear), incumbent: true },
          { ...rep, contactId: `fec:C${d.geoid}`, source: 'fec', role: 'candidate', name: 'Cass Challenger', party: 'Republican', election: String(electionYear) },
        );
      } else if (d.kind === 'state_upper' || d.kind === 'state_lower') {
        const upper = d.kind === 'state_upper';
        contacts.push({
          ...base,
          contactId: `openstates:${d.kind}:${d.geoid}`,
          source: 'openstates',
          role: 'holder',
          office: upper ? 'state_upper' : 'state_lower',
          officeTitle: upper ? 'State Senator' : 'State Representative',
          district,
          name: upper ? 'Uma Upper' : 'Lou Lower',
          party: 'Democratic',
          email: upper ? 'uma@legislature.example' : 'lou@legislature.example',
        });
      }
    }
    const ballot: Ballot = options.zip
      ? {
          electionId: '9000',
          electionDay: `${electionYear}-11-03`,
          contests: [
            ...districts
              .filter((d) => d.kind === 'congressional')
              .map((d) => ({
                office: 'U.S. Representative',
                level: ['country'],
                district: { scope: 'congressional', id: `ocd-division/country:us/state:${state.toLowerCase()}/cd:${houseDistrictNumber(d.geoid)}` },
                candidates: [{ name: 'Cass Challenger', party: 'Republican', candidateUrl: 'https://cass.example' }],
              })),
            {
              office: 'State Senator',
              level: ['administrativeArea1'],
              district: { scope: 'stateUpper', id: `ocd-division/country:us/state:${state.toLowerCase()}/sldu:1` },
              candidates: [
                { name: 'Uma Upper', party: 'Democratic' },
                { name: 'Bea Ballot', party: 'Green', email: 'bea@campaign.example', candidateUrl: 'https://bea.example', photoUrl: 'https://bea.example/photo.jpg' },
              ],
            },
            { office: 'Governing Board Member', district: { name: 'Example Unified School District, Trustee Area 2', scope: 'schoolBoard' }, candidates: [{ name: 'Sal School' }] },
            { type: 'Referendum', district: { scope: 'statewide' } },
          ],
        }
      : NO_BALLOT;
    const placed = ballotContacts(ballot, state, districts);
    const kept = options.holders ? contacts : contacts.filter((c) => c.role === 'candidate');
    const feeds = Object.fromEntries(CONTACT_FEEDS.map((f) => [f, 'ok'])) as Record<ContactFeed, ContactFeedState>;
    if (!options.holders) feeds.congress = feeds.openstates = 'off';
    if (!options.zip) feeds.civic = 'off';
    return { contacts: mergeBallot(kept, placed.contacts), ballot: placed.unplaced, feeds };
  }
}
