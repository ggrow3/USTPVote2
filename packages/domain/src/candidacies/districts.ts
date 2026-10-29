/**
 * Districts for candidacies (design §5.8): the area an office is elected from, as the Census Bureau's TIGER boundaries
 * name it. The api looks a district up when a member declares, so what is stored is the Census name and GEOID, never
 * the member's own spelling; the web app draws the district's outline on the map from the same GEOID.
 */

/** What an office is elected from: the whole country, a state, or one district of a kind within a state. */
export const DISTRICT_KINDS = ['nation', 'state', 'congressional', 'state_upper', 'state_lower', 'county', 'place'] as const;
export type DistrictKind = (typeof DISTRICT_KINDS)[number];

/** Kinds a member chooses from a list for their state; the nation and a state are implied by the office. */
export const LISTED_DISTRICT_KINDS: readonly DistrictKind[] = ['congressional', 'state_upper', 'state_lower', 'county', 'place'];

/** The two-digit FIPS code of each state, DC and territory: the first two characters of every district's GEOID there. */
export const STATE_FIPS: Readonly<Record<string, string>> = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11', FL: '12', GA: '13',
  HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25',
  MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36',
  NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47', TX: '48',
  UT: '49', VT: '50', VA: '51', WA: '53', WV: '54', WI: '55', WY: '56', AS: '60', GU: '66', MP: '69', PR: '72',
  VI: '78',
};

/** The nation's stand-in GEOID; it has no outline of its own. */
export const NATION_ID = 'US';

/**
 * A district's GEOID: the state's FIPS code, then the district's own code. Codes are digits, except a few states'
 * legislative districts (Vermont's `50O-3`), so capital letters and dashes are allowed too, and nothing else: the ID
 * goes into a Census query.
 */
export const DISTRICT_ID = /^[0-9]{2}[0-9A-Z-]{0,10}$/;

/** A point inside a district, for its marker on the map (the Census "internal point"). */
export interface MapPoint {
  readonly lat: number;
  readonly lng: number;
}

/** A district as stored with a candidacy: what the Census calls it, so the record reads the same if the lines move. */
export interface District {
  readonly kind: DistrictKind;
  /** The Census GEOID (`0612`: California's 12th congressional district), `US` for the nation. */
  readonly geoid: string;
  /** Two-letter state code; null for the nation. */
  readonly state: string | null;
  /** The Census name: `Congressional District 12`, `Travis County`, `Austin city`, `California`. */
  readonly name: string;
  readonly point: MapPoint | null;
  /** Which set of lines it comes from, e.g. `120th Congressional Districts`; null for the nation. */
  readonly vintage: string | null;
}

/** The state a GEOID lies in, from its FIPS prefix, if it is one. */
export function stateOfDistrict(geoid: string): string | null {
  const fips = geoid.slice(0, 2);
  return Object.keys(STATE_FIPS).find((code) => STATE_FIPS[code] === fips) ?? null;
}

/** Why a district cannot be looked up for a kind and state, if it cannot (null when the GEOID fits them). */
export function districtIdProblem(kind: DistrictKind, state: string | null, geoid: string | null): string | null {
  if (kind === 'nation') return geoid === null || geoid === NATION_ID ? null : 'a nationwide office has no district';
  const fips = state === null ? undefined : STATE_FIPS[state];
  if (fips === undefined) return 'choose a state or territory';
  if (kind === 'state') return geoid === null || geoid === fips ? null : 'a statewide office has no district within the state';
  if (geoid === null) return 'choose the district';
  if (!DISTRICT_ID.test(geoid) || !geoid.startsWith(fips) || geoid.length < 3) return 'that district is not in the state you chose';
  return null;
}

/** The GEOID a lookup uses: the nation's, the state's own, or the district chosen. */
export function districtLookupId(kind: DistrictKind, state: string | null, geoid: string | null): string {
  if (kind === 'nation') return NATION_ID;
  if (kind === 'state') return STATE_FIPS[state ?? ''] ?? '';
  return geoid ?? '';
}
