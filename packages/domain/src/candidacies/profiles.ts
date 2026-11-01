/**
 * What public records say about a person listed for an office in someone's area (design §5.12): a short biography from
 * Wikipedia, and the offices they have held, where they studied and what they do, from Wikidata. Only people the
 * records can be matched to by an official ID have one (an FEC candidate ID or a Congress Bioguide ID), never by name,
 * so a profile is never someone else's. A photo comes with its credit: Wikimedia Commons' author and licence, or the
 * ballot data's.
 */

/** Wikipedia's text may be reused under this licence, with a credit and a link to the article. */
export const WIKIPEDIA_LICENCE = { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' } as const;

export const PROFILE_LIMITS = { summary: 1200, positions: 8, education: 4, occupations: 4, label: 160, credit: 160 } as const;

/** One office a person has held: Wikidata's name for it, where (the district), and the years. */
export interface ProfilePosition {
  readonly title: string;
  readonly place: string | null;
  /** `YYYY`, or null when Wikidata has no start. */
  readonly start: string | null;
  /** `YYYY`; null while they hold it (or when Wikidata has no end). */
  readonly end: string | null;
}

/** A person's biography and experience, from Wikipedia and Wikidata. */
export interface ContactProfile {
  /** The start of their Wikipedia article, as plain text; null when they have none in English. */
  readonly summary: string | null;
  readonly articleUrl: string | null;
  readonly wikidataUrl: string;
  /** Most recent first. */
  readonly positions: readonly ProfilePosition[];
  readonly education: readonly string[];
  readonly occupations: readonly string[];
}

/** A person's photo, from Wikimedia Commons or the ballot data, and who to credit for it. */
export interface ContactPhoto {
  readonly url: string;
  /** "Photo: U.S. House Office of Photography, public domain"; "Photo from the ballot data". */
  readonly credit: string;
  /** Where the credit and licence are given in full (the Commons file page). */
  readonly creditUrl: string | null;
}

/**
 * "2013–2019", "from 2019", "until 2009", or null when Wikidata gives neither year. An office with no end is not called
 * current: Wikidata leaves some past offices without one.
 */
export function yearSpan(p: Pick<ProfilePosition, 'start' | 'end'>): string | null {
  if (p.start && p.end) return p.start === p.end ? p.start : `${p.start}–${p.end}`;
  if (p.start) return `from ${p.start}`;
  if (p.end) return `until ${p.end}`;
  return null;
}

/** An office held as one line: "Member of the United States House of Representatives, California's 49th congressional district, from 2019". */
export function positionText(p: ProfilePosition): string {
  const title = p.title.charAt(0).toUpperCase() + p.title.slice(1);
  return [title, p.place, yearSpan(p)].filter(Boolean).join(', ');
}

/** Text cut to `max` characters at a sentence's end where one is near, else at a word, with an ellipsis. */
export function shortened(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const sentence = cut.lastIndexOf('. ');
  if (sentence > max / 2) return cut.slice(0, sentence + 1);
  const word = cut.lastIndexOf(' ');
  return `${cut.slice(0, word > 0 ? word : max).replace(/[,;:]$/, '')}…`;
}

/**
 * Offices held, most recent first: those with no end, then by end year and start year, any without years last; the
 * same office in the same place over several terms is one line from the first start to the last end, and an office
 * with no years that another line already names ("senator" beside "United States senator") is left out. At most
 * `PROFILE_LIMITS.positions`.
 */
export function orderPositions(positions: readonly ProfilePosition[]): ProfilePosition[] {
  const merged = new Map<string, ProfilePosition & { open: boolean }>();
  for (const p of positions) {
    const key = `${p.title.toLowerCase()}|${(p.place ?? '').toLowerCase()}`;
    const had = merged.get(key);
    if (!had) {
      merged.set(key, { ...p, open: p.end === null });
      continue;
    }
    const open = had.open || p.end === null;
    const start = [had.start, p.start].filter((y): y is string => y !== null).sort()[0] ?? null;
    const end = open ? null : ([had.end, p.end].filter((y): y is string => y !== null).sort().at(-1) ?? null);
    merged.set(key, { ...had, start, end, open });
  }
  // No end after any end; no years at all last.
  const rank = (p: ProfilePosition) => (p.start === null && p.end === null ? '' : (p.end ?? '9999') + (p.start ?? '0000'));
  const all = [...merged.values()].map(({ open: _open, ...p }) => p);
  const named = (p: ProfilePosition) => all.some((o) => o !== p && o.title.toLowerCase().endsWith(p.title.toLowerCase()));
  return all
    .filter((p) => p.start !== null || p.end !== null || !named(p))
    .sort((a, b) => rank(b).localeCompare(rank(a)))
    .slice(0, PROFILE_LIMITS.positions);
}
