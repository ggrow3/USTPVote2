/**
 * Where members live (design §5.2): the country, by its ISO 3166-1 alpha-2 code, with its English name (as Unicode
 * CLDR gives it), plus Kosovo (`XK`), whose code is not assigned by ISO but is in common use. Puerto Rico, Guam and
 * the other US territories are not listed: an applicant there chooses the United States, and the territory as their
 * state, as before.
 */
export const COUNTRIES: readonly { readonly code: string; readonly name: string }[] = (
  [
    ['AD', 'Andorra'], ['AE', 'United Arab Emirates'], ['AF', 'Afghanistan'], ['AG', 'Antigua & Barbuda'],
    ['AI', 'Anguilla'], ['AL', 'Albania'], ['AM', 'Armenia'], ['AO', 'Angola'], ['AQ', 'Antarctica'],
    ['AR', 'Argentina'], ['AT', 'Austria'], ['AU', 'Australia'], ['AW', 'Aruba'], ['AX', 'Åland Islands'],
    ['AZ', 'Azerbaijan'], ['BA', 'Bosnia & Herzegovina'], ['BB', 'Barbados'], ['BD', 'Bangladesh'], ['BE', 'Belgium'],
    ['BF', 'Burkina Faso'], ['BG', 'Bulgaria'], ['BH', 'Bahrain'], ['BI', 'Burundi'], ['BJ', 'Benin'],
    ['BL', 'St. Barthélemy'], ['BM', 'Bermuda'], ['BN', 'Brunei'], ['BO', 'Bolivia'], ['BQ', 'Caribbean Netherlands'],
    ['BR', 'Brazil'], ['BS', 'Bahamas'], ['BT', 'Bhutan'], ['BV', 'Bouvet Island'], ['BW', 'Botswana'],
    ['BY', 'Belarus'], ['BZ', 'Belize'], ['CA', 'Canada'], ['CC', 'Cocos (Keeling) Islands'],
    ['CD', 'Congo - Kinshasa'], ['CF', 'Central African Republic'], ['CG', 'Congo - Brazzaville'],
    ['CH', 'Switzerland'], ['CI', 'Côte d’Ivoire'], ['CK', 'Cook Islands'], ['CL', 'Chile'], ['CM', 'Cameroon'],
    ['CN', 'China'], ['CO', 'Colombia'], ['CR', 'Costa Rica'], ['CU', 'Cuba'], ['CV', 'Cape Verde'], ['CW', 'Curaçao'],
    ['CX', 'Christmas Island'], ['CY', 'Cyprus'], ['CZ', 'Czechia'], ['DE', 'Germany'], ['DJ', 'Djibouti'],
    ['DK', 'Denmark'], ['DM', 'Dominica'], ['DO', 'Dominican Republic'], ['DZ', 'Algeria'], ['EC', 'Ecuador'],
    ['EE', 'Estonia'], ['EG', 'Egypt'], ['EH', 'Western Sahara'], ['ER', 'Eritrea'], ['ES', 'Spain'],
    ['ET', 'Ethiopia'], ['FI', 'Finland'], ['FJ', 'Fiji'], ['FK', 'Falkland Islands'], ['FM', 'Micronesia'],
    ['FO', 'Faroe Islands'], ['FR', 'France'], ['GA', 'Gabon'], ['GB', 'United Kingdom'], ['GD', 'Grenada'],
    ['GE', 'Georgia'], ['GF', 'French Guiana'], ['GG', 'Guernsey'], ['GH', 'Ghana'], ['GI', 'Gibraltar'],
    ['GL', 'Greenland'], ['GM', 'Gambia'], ['GN', 'Guinea'], ['GP', 'Guadeloupe'], ['GQ', 'Equatorial Guinea'],
    ['GR', 'Greece'], ['GS', 'South Georgia & South Sandwich Islands'], ['GT', 'Guatemala'], ['GW', 'Guinea-Bissau'],
    ['GY', 'Guyana'], ['HK', 'Hong Kong SAR China'], ['HM', 'Heard & McDonald Islands'], ['HN', 'Honduras'],
    ['HR', 'Croatia'], ['HT', 'Haiti'], ['HU', 'Hungary'], ['ID', 'Indonesia'], ['IE', 'Ireland'], ['IL', 'Israel'],
    ['IM', 'Isle of Man'], ['IN', 'India'], ['IO', 'British Indian Ocean Territory'], ['IQ', 'Iraq'], ['IR', 'Iran'],
    ['IS', 'Iceland'], ['IT', 'Italy'], ['JE', 'Jersey'], ['JM', 'Jamaica'], ['JO', 'Jordan'], ['JP', 'Japan'],
    ['KE', 'Kenya'], ['KG', 'Kyrgyzstan'], ['KH', 'Cambodia'], ['KI', 'Kiribati'], ['KM', 'Comoros'],
    ['KN', 'St. Kitts & Nevis'], ['KP', 'North Korea'], ['KR', 'South Korea'], ['KW', 'Kuwait'],
    ['KY', 'Cayman Islands'], ['KZ', 'Kazakhstan'], ['LA', 'Laos'], ['LB', 'Lebanon'], ['LC', 'St. Lucia'],
    ['LI', 'Liechtenstein'], ['LK', 'Sri Lanka'], ['LR', 'Liberia'], ['LS', 'Lesotho'], ['LT', 'Lithuania'],
    ['LU', 'Luxembourg'], ['LV', 'Latvia'], ['LY', 'Libya'], ['MA', 'Morocco'], ['MC', 'Monaco'], ['MD', 'Moldova'],
    ['ME', 'Montenegro'], ['MF', 'St. Martin'], ['MG', 'Madagascar'], ['MH', 'Marshall Islands'],
    ['MK', 'North Macedonia'], ['ML', 'Mali'], ['MM', 'Myanmar (Burma)'], ['MN', 'Mongolia'],
    ['MO', 'Macao SAR China'], ['MQ', 'Martinique'], ['MR', 'Mauritania'], ['MS', 'Montserrat'], ['MT', 'Malta'],
    ['MU', 'Mauritius'], ['MV', 'Maldives'], ['MW', 'Malawi'], ['MX', 'Mexico'], ['MY', 'Malaysia'],
    ['MZ', 'Mozambique'], ['NA', 'Namibia'], ['NC', 'New Caledonia'], ['NE', 'Niger'], ['NF', 'Norfolk Island'],
    ['NG', 'Nigeria'], ['NI', 'Nicaragua'], ['NL', 'Netherlands'], ['NO', 'Norway'], ['NP', 'Nepal'], ['NR', 'Nauru'],
    ['NU', 'Niue'], ['NZ', 'New Zealand'], ['OM', 'Oman'], ['PA', 'Panama'], ['PE', 'Peru'],
    ['PF', 'French Polynesia'], ['PG', 'Papua New Guinea'], ['PH', 'Philippines'], ['PK', 'Pakistan'],
    ['PL', 'Poland'], ['PM', 'St. Pierre & Miquelon'], ['PN', 'Pitcairn Islands'], ['PS', 'Palestinian Territories'],
    ['PT', 'Portugal'], ['PW', 'Palau'], ['PY', 'Paraguay'], ['QA', 'Qatar'], ['RE', 'Réunion'], ['RO', 'Romania'],
    ['RS', 'Serbia'], ['RU', 'Russia'], ['RW', 'Rwanda'], ['SA', 'Saudi Arabia'], ['SB', 'Solomon Islands'],
    ['SC', 'Seychelles'], ['SD', 'Sudan'], ['SE', 'Sweden'], ['SG', 'Singapore'], ['SH', 'St. Helena'],
    ['SI', 'Slovenia'], ['SJ', 'Svalbard & Jan Mayen'], ['SK', 'Slovakia'], ['SL', 'Sierra Leone'],
    ['SM', 'San Marino'], ['SN', 'Senegal'], ['SO', 'Somalia'], ['SR', 'Suriname'], ['SS', 'South Sudan'],
    ['ST', 'São Tomé & Príncipe'], ['SV', 'El Salvador'], ['SX', 'Sint Maarten'], ['SY', 'Syria'],
    ['SZ', 'Eswatini'],
    ['TC', 'Turks & Caicos Islands'], ['TD', 'Chad'], ['TF', 'French Southern Territories'], ['TG', 'Togo'],
    ['TH', 'Thailand'], ['TJ', 'Tajikistan'], ['TK', 'Tokelau'], ['TL', 'Timor-Leste'], ['TM', 'Turkmenistan'],
    ['TN', 'Tunisia'], ['TO', 'Tonga'], ['TR', 'Türkiye'], ['TT', 'Trinidad & Tobago'], ['TV', 'Tuvalu'],
    ['TW', 'Taiwan'], ['TZ', 'Tanzania'], ['UA', 'Ukraine'], ['UG', 'Uganda'], ['US', 'United States'],
    ['UY', 'Uruguay'], ['UZ', 'Uzbekistan'], ['VA', 'Vatican City'], ['VC', 'St. Vincent & Grenadines'],
    ['VE', 'Venezuela'], ['VG', 'British Virgin Islands'], ['VN', 'Vietnam'], ['VU', 'Vanuatu'],
    ['WF', 'Wallis & Futuna'], ['WS', 'Samoa'], ['XK', 'Kosovo'], ['YE', 'Yemen'], ['YT', 'Mayotte'],
    ['ZA', 'South Africa'], ['ZM', 'Zambia'], ['ZW', 'Zimbabwe'],
  ] as const
).map(([code, name]) => ({ code, name }));

/**
 * The United States: the only country whose members must give a state, city and ZIP code, and the country of every
 * record made before the country was asked.
 */
export const DEFAULT_COUNTRY = 'US';

const NAMES: ReadonlyMap<string, string> = new Map(COUNTRIES.map((c) => [c.code, c.name]));

export function isCountryCode(code: string): boolean {
  return NAMES.has(code);
}

/** "Canada"; an unknown code as it is. */
export function countryName(code: string): string {
  return NAMES.get(code) ?? code;
}

/** A record's country: records made before it was asked have none and are in the United States. */
export function countryOf(record: { readonly country?: string | null }): string {
  return record.country ?? DEFAULT_COUNTRY;
}

/**
 * Where a member lives, in a word or two, beside their name (the forum, the voter roll, member search): their state's
 * code in the United States ("NY"), the country's name elsewhere ("Canada").
 */
export function placeText(record: { readonly country?: string | null; readonly state: string | null }): string {
  const country = countryOf(record);
  return country === DEFAULT_COUNTRY ? (record.state ?? '') : countryName(country);
}
