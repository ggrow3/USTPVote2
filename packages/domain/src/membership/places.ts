/**
 * Where members live (design §5.2, §5.13): a US state or territory by its two-letter code, or, for members living
 * outside the United States, a country by its ISO 3166-1 alpha-2 code. The application asks for a US state only; a
 * Membership Admin adding a member may give a country instead.
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

/** Every ISO 3166-1 alpha-2 country code (249). */
export const COUNTRY_CODES: readonly string[] = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO ' +
  'FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE ' +
  'JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO ' +
  'MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW ' +
  'PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM ' +
  'TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

/** Territories with their own ISO country code that the state list covers: giving one as a country means that state. */
const US_TERRITORY_COUNTRIES = new Set(['AS', 'GU', 'MP', 'PR', 'VI']);

/** Other ways a roster may name a country, beyond its code and its English name. */
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

let regionNames: Intl.DisplayNames | null | undefined;

function englishRegionNames(): Intl.DisplayNames | null {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    } catch {
      regionNames = null;
    }
  }
  return regionNames;
}

/** "United Kingdom" for `GB`; the code itself where the runtime knows no name. */
export function countryName(code: string): string {
  return englishRegionNames()?.of(code) ?? code;
}

let byName: Map<string, string> | null = null;

/** A country's ISO code from its code or English name ("gb", "United Kingdom", "UK"), or null if it is none. */
export function countryCode(text: string): string | null {
  const key = text.trim().toLowerCase();
  if (!key) return null;
  const alias = COUNTRY_ALIASES[key];
  if (alias) return alias;
  if (/^[a-z]{2}$/.test(key)) {
    const code = key.toUpperCase();
    return COUNTRY_CODES.includes(code) ? code : null;
  }
  byName ??= new Map(COUNTRY_CODES.map((code) => [countryName(code).toLowerCase(), code]));
  return byName.get(key) ?? null;
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
 * Where someone lives, from what a roster says: a US state, or a country other than the US. A territory with its own
 * country code (Puerto Rico, Guam…) counts as that state; the United States as a country needs the state too.
 */
export function placeOf(state: string, country: string): { readonly state: string; readonly country: string | null } | { readonly problem: string } {
  const stateText = state.trim();
  const countryText = country.trim();
  const countryValue = countryText ? countryCode(countryText) : null;
  if (countryText && !countryValue) return { problem: `"${countryText}" is not a country (try its two-letter code, such as GB)` };
  const stateValue = stateText ? usStateCode(stateText) : null;
  if (stateText && !stateValue) return { problem: `"${stateText}" is not a US state or territory` };
  if (countryValue === null || countryValue === 'US') {
    if (!stateValue) return { problem: countryValue ? 'the country is the United States, so give the state too' : 'no state, or country for a member living outside the US' };
    return { state: stateValue, country: null };
  }
  if (US_TERRITORY_COUNTRIES.has(countryValue)) {
    if (stateValue && stateValue !== countryValue) return { problem: `the state ${stateValue} is not in ${countryName(countryValue)}` };
    return { state: countryValue, country: null };
  }
  // Someone living abroad may still give the state they vote in.
  return { state: stateValue ?? '', country: countryValue };
}
