import { Logger } from '@nestjs/common';
import {
  CONTACT_FEEDS,
  DEFAULT_OFFICE_TITLES,
  fecDisplayName,
  NATION_ID,
  STATE_FIPS,
  type AreaContact,
  type ContactDistrict,
  type ContactFeed,
  type ContactFeedState,
  type District,
  type PublicOffice,
} from 'ustp-domain';

/**
 * Where the Your area page's office holders and candidates come from (design §5.12), besides what Communications
 * Admins enter: public records, each kept a day.
 */
export interface ContactSource {
  /**
   * The people the records list for a member's area: the nation, the state and the districts their ZIP code reaches
   * into, for the federal general election of `electionYear`; and whether each record answered.
   */
  forArea(state: string, districts: readonly District[], electionYear: number): Promise<{ contacts: AreaContact[]; feeds: Record<ContactFeed, ContactFeedState> }>;
}

export const CONTACT_SOURCE = Symbol('ContactSource');

const FEC = 'https://api.open.fec.gov/v1/candidates/';
const LEGISLATORS = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
const OPEN_STATES = 'https://v3.openstates.org/people.geo';
const TIMEOUT_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED = 2000;

const NATION: ContactDistrict = { kind: 'nation', geoid: NATION_ID, state: null, name: 'United States' };
const stateDistrict = (state: string): ContactDistrict => ({ kind: 'state', geoid: STATE_FIPS[state] ?? state, state, name: state });
const contactDistrict = (d: District): ContactDistrict => ({ kind: d.kind, geoid: d.geoid, state: d.state, name: d.name });

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

/** Only `https://` addresses are passed on, since the page links to them. */
const https = (url: string | undefined | null) => (url && /^https:\/\//.test(url) ? url : null);

/**
 * The FEC (candidates for Congress and President who have filed for the election and reported raising money), the
 * `unitedstates/congress-legislators` data (who sits in Congress now) and Open States (state legislators, with a key).
 * What a record answers is kept a day; a record that fails is asked again next time, and the page says it is missing.
 */
export class PublicContactSource implements ContactSource {
  private readonly logger = new Logger(PublicContactSource.name);
  private readonly cache = new Map<string, { readonly at: number; readonly value: Promise<unknown> }>();

  constructor(
    private readonly keys: { readonly fec: string; readonly openStates: string | null },
    private readonly fetchFn: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init),
  ) {}

  async forArea(state: string, districts: readonly District[], electionYear: number) {
    const feeds: Record<ContactFeed, ContactFeedState> = { fec: 'ok', congress: 'ok', openstates: this.keys.openStates ? 'ok' : 'off' };
    const ask = async (feed: ContactFeed, people: () => Promise<AreaContact[]>): Promise<AreaContact[]> => {
      try {
        return await people();
      } catch (e) {
        this.logger.warn(`${feed} unavailable: ${e instanceof Error ? e.message : String(e)}`);
        feeds[feed] = 'unavailable';
        return [];
      }
    };
    const house = districts.filter((d) => d.kind === 'congressional');
    const legislature = districts.filter((d) => (d.kind === 'state_upper' || d.kind === 'state_lower') && d.point);
    const lists = await Promise.all([
      ...(electionYear % 4 === 0 ? [ask('fec', () => this.fec('us_president', NATION, { office: 'P' }, electionYear))] : []),
      ask('fec', () => this.fec('us_senate', stateDistrict(state), { office: 'S', state }, electionYear)),
      ...house.map((d) => ask('fec', () => this.fec('us_house', contactDistrict(d), { office: 'H', state, district: String(houseDistrictNumber(d.geoid)).padStart(2, '0') }, electionYear))),
      ask('congress', async () => (await this.congress(state, house)).flat()),
      ...(this.keys.openStates ? legislature.map((d) => ask('openstates', () => this.openStates(d))) : []),
    ]);
    return { contacts: lists.flat(), feeds };
  }

  /** The FEC's candidates for one race. */
  private fec(office: PublicOffice, district: ContactDistrict, race: Record<string, string>, year: number): Promise<AreaContact[]> {
    const params = new URLSearchParams({
      ...race,
      api_key: this.keys.fec,
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
  private openStates(district: District): Promise<AreaContact[]> {
    const office: PublicOffice = district.kind === 'state_upper' ? 'state_upper' : 'state_lower';
    const chambers = office === 'state_upper' ? ['upper', 'legislature'] : ['lower'];
    const { lat, lng } = district.point!;
    return this.kept(`openstates:${district.kind}:${district.geoid}`, async () => {
      const body = await this.json<{ results?: OpenStatesPerson[] }>(`${OPEN_STATES}?${new URLSearchParams({ lat: String(lat), lng: String(lng) })}&include=links`, {
        'X-API-KEY': this.keys.openStates!,
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
          };
        });
    });
  }

  /** What `load` gives, kept a day under `key`; a failure is not kept. */
  private kept<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < DAY_MS) return hit.value as Promise<T>;
    const value = load();
    value.catch(() => this.cache.delete(key));
    this.cache.delete(key);
    if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private async json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json', ...headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

/**
 * Made-up people for the emulators (`DISTRICTS=local`): two senators and a Senate candidate per state, a representative
 * who runs again against a challenger in each congressional district, and a state legislator with an email address in
 * each legislative district.
 */
export class LocalContactSource implements ContactSource {
  async forArea(state: string, districts: readonly District[], electionYear: number) {
    const base = { email: null, contactUrl: null, website: null, sourceUrl: null, election: null, incumbent: false } as const;
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
    return { contacts, feeds: Object.fromEntries(CONTACT_FEEDS.map((f) => [f, 'ok'])) as Record<ContactFeed, ContactFeedState> };
  }
}
