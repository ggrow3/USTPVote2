import { COUNTRIES, DEFAULT_COUNTRY } from './countries.js';

/**
 * Reading where a member lives from a roster (design §5.13): a US state or territory by its code or name, or a
 * country by its code or English name (`COUNTRIES`, design §5.2), as a Membership Admin's file gives them.
 */

/** US states, DC and territories, as the application's state picker lists them. */
export const US_STATES: readonly { readonly code: string; readonly name: string }[] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'],
  ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['AS', 'American Samoa'], ['GU', 'Guam'], ['MP', 'Northern Mariana Islands'], ['PR', 'Puerto Rico'],
  ['VI', 'U.S. Virgin Islands'],
].map(([code, name]) => ({ code: code!, name: name! }));

/** Territories with an ISO code of their own: as a roster's country, each means the United States and that state. */
const US_TERRITORIES = new Set(['AS', 'GU', 'MP', 'PR', 'VI']);

/** Other ways a roster may name a country, beyond its code and its name in `COUNTRIES`. */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  usa: 'US',
  'u.s.': 'US',
  'u.s.a.': 'US',
  'united states of america': 'US',
  america: 'US',
  uk: 'GB',
  'u.k.': 'GB',
  'great britain': 'GB',
  britain: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
};

const BY_NAME = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c.code]));
const CODES = new Set(COUNTRIES.map((c) => c.code));

/** A country's code from its code or name ("gb", "United Kingdom", "UK"), or null if it is none. */
export function countryCode(text: string): string | null {
  const key = text.trim().toLowerCase();
  if (!key) return null;
  const alias = COUNTRY_ALIASES[key];
  if (alias) return alias;
  if (/^[a-z]{2}$/.test(key)) return CODES.has(key.toUpperCase()) ? key.toUpperCase() : null;
  return BY_NAME.get(key) ?? null;
}

/** A US state's or territory's code from its code or name ("ny", "New York"), or null if it is none. */
export function usStateCode(text: string): string | null {
  const key = text.trim().toLowerCase();
  if (!key) return null;
  return US_STATES.find((s) => s.code.toLowerCase() === key || s.name.toLowerCase() === key)?.code ?? null;
}

/** "New York (NY)"; the code itself if it names no state. */
export function usStateName(code: string): string {
  const state = US_STATES.find((s) => s.code === code);
  return state ? `${state.name} (${state.code})` : code;
}

/**
 * Where someone lives, from a roster's state, region and country, as member records keep it (§5.2). In the United
 * States (no country given, the US, or a territory such as Puerto Rico, which is that state) the state is needed.
 * Elsewhere the country, and optionally a region (a state, province or county) as given, which the state column may
 * hold instead. `missing` marks a place left out rather than one given wrong.
 */
export function placeOf(
  stateText: string,
  regionText: string,
  countryText: string,
):
  | { readonly country: string; readonly state: string | null; readonly region: string | null }
  | { readonly problem: string; readonly missing?: true } {
  const state = stateText.trim();
  const region = regionText.trim();
  const given = countryText.trim();
  const territory = given && usStateCode(given) && US_TERRITORIES.has(usStateCode(given)!) ? usStateCode(given) : null;
  const country = territory ? DEFAULT_COUNTRY : given ? countryCode(given) : DEFAULT_COUNTRY;
  if (!country) return { problem: `"${given}" is not a country (try its two-letter code, such as GB)` };
  if (country !== DEFAULT_COUNTRY) {
    const area = region || state;
    if (area.length > 100) return { problem: 'the region is longer than 100 characters' };
    return { country, state: null, region: area || null };
  }
  const code = state ? usStateCode(state) : territory;
  if (state && !code) return { problem: `"${state}" is not a US state or territory` };
  if (territory && code !== territory) return { problem: `the state ${code} is not in ${usStateName(territory)}` };
  if (!code) {
    const problem = given ? 'the country is the United States, so give the state too' : 'no state, or country for a member living outside the US';
    return { problem, missing: true };
  }
  return { country, state: code, region: null };
}
