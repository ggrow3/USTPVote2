/**
 * Finding Active members by name (design §6.5), so an Election Admin can link a candidate to the member standing
 * instead of typing their name. Only what it takes to tell two people with the same name apart is shown.
 */

/** `GET /v1/admin/member-search`: one Active member. */
export interface MemberMatch {
  readonly accountId: string;
  readonly legalName: string;
  readonly preferredName: string | null;
  /** Where they live (`placeText`): the state's code in the US ("NY"), the country's name elsewhere ("Canada"). */
  readonly state: string;
}

/** Matches a search returns unless it asks for fewer, and the most it may ask for. */
export const MEMBER_SEARCH_DEFAULT_LIMIT = 10;
export const MEMBER_SEARCH_MAX_LIMIT = 20;

/** Lowercase and without accents, so "jose" finds "José". */
export function foldName(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const words = (text: string) => foldName(text).split(/[\s\-'’.]+/u).filter(Boolean);
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/**
 * The members whose legal or preferred name holds every word of `text` (any case, with or without accents), at most
 * `limit`: names that start with the text first, then those where each word of it starts a word of the name, then
 * the rest; alphabetically by legal name within each. An empty text matches nobody.
 */
export function matchMembers<T extends MemberMatch>(members: readonly T[], text: string, limit: number): T[] {
  const query = foldName(text.trim().replace(/\s+/g, ' '));
  const terms = words(query);
  if (!terms.length) return [];
  const rank = (m: T): number | null => {
    const names = [m.legalName, m.preferredName ?? ''].filter(Boolean);
    const folded = names.map(foldName);
    if (!folded.some((name) => terms.every((t) => name.includes(t)))) return null;
    if (folded.some((name) => name.startsWith(query))) return 0;
    if (names.some((name) => terms.every((t) => words(name).some((w) => w.startsWith(t))))) return 1;
    return 2;
  };
  return members
    .flatMap((m) => {
      const r = rank(m);
      return r === null ? [] : [{ m, r }];
    })
    .sort((a, b) => a.r - b.r || collator.compare(a.m.legalName, b.m.legalName) || a.m.accountId.localeCompare(b.m.accountId))
    .slice(0, limit)
    .map(({ m }) => m);
}
