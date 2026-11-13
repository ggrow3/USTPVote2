import {
  rollCallId,
  voteCastOf,
  type MemberVote,
  type RollCallRecord,
  type RollCallRef,
} from 'ustp-domain';
import { BillSourceError, decodeEntities, TtlCache } from './bill-source.js';

/**
 * Where the scorecard's votes come from (design §5.14, "Legislation and the scorecard"): each roll call on a public
 * bill, with every member's vote, as the chamber recorded it. House votes from the Congress.gov API's House vote
 * endpoints (the api.data.gov key), Senate votes from the Senate's own XML (no key), and who sits for which district
 * from the `unitedstates/congress-legislators` data. Read only.
 */
export interface RollCallSource {
  /** The roll call held at `date` (as the bill's action gives it); null when the chamber has no such roll call. */
  rollCall(ref: RollCallRef, date: string): Promise<RollCallRecord | null>;
}

export const ROLL_CALL_SOURCE = Symbol('RollCallSource');

const CONGRESS = 'https://api.congress.gov/v3';
const SENATE = 'https://www.senate.gov/legislative/LIS/roll_call_votes';
const LEGISLATORS = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
const TIMEOUT_MS = 30_000;
const DAY = 24 * 60 * 60 * 1000;
/** A House roll call's members come in pages; the whole House is well under this many. */
const MEMBER_PAGES = 4;
/** No roll call's XML comes near this: the Senate's are about 30 kB. */
const MAX_XML_BYTES = 2_000_000;

/** What congress-legislators says of a member now: their name as they use it, and a representative's district. */
interface Legislator {
  readonly id: { readonly bioguide: string; readonly lis?: string };
  readonly name: { readonly first: string; readonly last: string; readonly official_full?: string };
  readonly terms: readonly { readonly type: 'rep' | 'sen'; readonly state: string; readonly district?: number }[];
}

/** Who sits in Congress now, by Bioguide ID, and each senator's Bioguide ID by the Senate's own ID. */
export interface LegislatorIndex {
  readonly byBioguide: ReadonlyMap<string, { readonly name: string; readonly state: string; readonly district: number | null }>;
  readonly bioguideOfLis: ReadonlyMap<string, string>;
}

export function legislatorIndex(list: readonly Legislator[]): LegislatorIndex {
  const byBioguide = new Map<string, { name: string; state: string; district: number | null }>();
  const bioguideOfLis = new Map<string, string>();
  for (const l of list) {
    const term = l.terms.at(-1);
    if (!l.id?.bioguide || !term) continue;
    byBioguide.set(l.id.bioguide, {
      name: l.name.official_full?.trim() || `${l.name.first} ${l.name.last}`,
      state: term.state,
      district: term.type === 'rep' && typeof term.district === 'number' ? term.district : null,
    });
    if (l.id.lis) bioguideOfLis.set(l.id.lis, l.id.bioguide);
  }
  return { byBioguide, bioguideOfLis };
}

export const EMPTY_INDEX: LegislatorIndex = { byBioguide: new Map(), bioguideOfLis: new Map() };

interface HouseVoteBody {
  readonly houseRollCallVote?: { readonly voteQuestion?: string; readonly result?: string };
}

interface HouseMember {
  readonly bioguideID?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly voteCast?: string;
  readonly voteParty?: string;
  readonly voteState?: string;
}

interface HouseMembersBody {
  readonly houseRollCallVoteMemberVotes?: { readonly voteQuestion?: string; readonly result?: string; readonly results?: readonly HouseMember[] };
  readonly pagination?: { readonly next?: string | null };
}

const BIOGUIDE = /^[A-Z]\d{6}$/;

/**
 * A House roll call from Congress.gov's answers: the vote's question and result, and each member's vote with their
 * district from congress-legislators (the vote gives only the state). A member whose vote is not a yea, nay, present
 * or not voting is left out.
 */
export function houseRollCall(ref: RollCallRef, date: string, vote: HouseVoteBody | null, members: readonly HouseMember[], index: LegislatorIndex, fetchedAt: string): RollCallRecord {
  const votes: MemberVote[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    const cast = voteCastOf(m.voteCast ?? '');
    const id = m.bioguideID ?? '';
    if (!cast || !BIOGUIDE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const known = index.byBioguide.get(id);
    const state = (m.voteState ?? known?.state ?? '').toUpperCase();
    votes.push({
      memberId: id,
      name: known?.name ?? [m.firstName, m.lastName].filter(Boolean).join(' ').trim(),
      party: m.voteParty?.trim() || null,
      state,
      district: known && known.state === state ? known.district : null,
      vote: cast,
    });
  }
  const v = vote?.houseRollCallVote;
  return {
    ...ref,
    voteId: rollCallId(ref),
    date,
    question: v?.voteQuestion?.trim() || 'Recorded vote',
    result: v?.result?.trim() || '',
    votes,
    sourceUrl: `${CONGRESS}/house-vote/${ref.congress}/${ref.session}/${ref.roll}`,
    fetchedAt,
  };
}

/** The text of the first `<tag>` in `xml`, decoded; empty when there is none. */
function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decodeEntities(m[1]!.replace(/<!\[CDATA\[|\]\]>/g, '')).replace(/\s+/g, ' ').trim() : '';
}

const LIS = /^S\d{3,4}$/;

/**
 * A Senate roll call from the Senate's XML (`vote_119_1_00343.xml`): its question and result, and each senator's vote
 * by their Bioguide ID, found from the Senate's own ID in congress-legislators; a senator no longer in office keeps the
 * Senate's ID. Null when the XML is not a roll call.
 */
export function senateRollCall(ref: RollCallRef, date: string, xml: string, index: LegislatorIndex, fetchedAt: string): RollCallRecord | null {
  if (!/<roll_call_vote>/.test(xml)) return null;
  const votes: MemberVote[] = [];
  const seen = new Set<string>();
  for (const [, block] of xml.matchAll(/<member>([\s\S]*?)<\/member>/g)) {
    const lis = tag(block!, 'lis_member_id');
    const cast = voteCastOf(tag(block!, 'vote_cast'));
    if (!cast || !LIS.test(lis)) continue;
    const memberId = index.bioguideOfLis.get(lis) ?? lis;
    if (seen.has(memberId)) continue;
    seen.add(memberId);
    const known = index.byBioguide.get(memberId);
    votes.push({
      memberId,
      name: known?.name ?? `${tag(block!, 'first_name')} ${tag(block!, 'last_name')}`.trim(),
      party: tag(block!, 'party') || null,
      state: tag(block!, 'state').toUpperCase(),
      district: null,
      vote: cast,
    });
  }
  return {
    ...ref,
    voteId: rollCallId(ref),
    date,
    question: tag(xml, 'vote_question_text') || tag(xml, 'question') || 'Roll call vote',
    result: tag(xml, 'vote_result_text') || tag(xml, 'vote_result'),
    votes,
    sourceUrl: senateXmlUrl(ref),
    fetchedAt,
  };
}

export const senateXmlUrl = (r: RollCallRef) => `${SENATE}/vote${r.congress}${r.session}/vote_${r.congress}_${r.session}_${String(r.roll).padStart(5, '0')}.xml`;

/**
 * Congress.gov's House votes (with the api.data.gov key, in a header), the Senate's XML, and congress-legislators,
 * which is kept a day. A roll call, once held, does not change, so each is read once and kept by the caller.
 */
export class PublicRollCallSource implements RollCallSource {
  private readonly legislators: TtlCache<LegislatorIndex>;

  constructor(
    private readonly key: () => Promise<string>,
    private readonly fetchFn: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {
    this.legislators = new TtlCache(DAY, 1, now);
  }

  async rollCall(ref: RollCallRef, date: string): Promise<RollCallRecord | null> {
    const index = await this.index();
    const at = new Date(this.now()).toISOString();
    if (ref.chamber === 'senate') {
      const res = await this.request(senateXmlUrl(ref), { accept: 'application/xml, text/xml' }, 'Senate.gov');
      if (res.status === 404) return null;
      this.refuseFailure(res, 'Senate.gov');
      if (Number(res.headers.get('content-length') ?? 0) > MAX_XML_BYTES) throw new BillSourceError('unreachable', 'Senate.gov');
      return senateRollCall(ref, date, await res.text(), index, at);
    }
    const base = `${CONGRESS}/house-vote/${ref.congress}/${ref.session}/${ref.roll}`;
    const vote = await this.json<HouseVoteBody>(`${base}?format=json`);
    if (!vote) return null;
    const members: HouseMember[] = [];
    for (let page = 0; page < MEMBER_PAGES; page++) {
      const body = await this.json<HouseMembersBody>(`${base}/members?format=json&limit=250&offset=${page * 250}`);
      const results = body?.houseRollCallVoteMemberVotes?.results ?? [];
      members.push(...results);
      if (!body?.pagination?.next || results.length === 0) break;
    }
    return houseRollCall(ref, date, vote, members, index, at);
  }

  /** congress-legislators, or nothing when it cannot be read: the votes keep the names the chambers give. */
  private index(): Promise<LegislatorIndex> {
    return this.legislators.get('current', async () => {
      const res = await this.fetchFn(LEGISLATORS, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`congress-legislators answered ${res.status}`);
      return legislatorIndex((await res.json()) as Legislator[]);
    }).catch(() => EMPTY_INDEX);
  }

  private async request(url: string, headers: Record<string, string>, service: 'Congress.gov' | 'Senate.gov'): Promise<Response> {
    try {
      return await this.fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers });
    } catch {
      throw new BillSourceError('unreachable', service);
    }
  }

  private refuseFailure(res: Response, service: 'Congress.gov' | 'Senate.gov'): void {
    if (res.ok) return;
    if (res.status === 429) throw new BillSourceError('rate_limited', service);
    if (service === 'Congress.gov' && (res.status === 401 || res.status === 403)) throw new BillSourceError('key_refused', service);
    throw new BillSourceError('unreachable', service);
  }

  /** Congress.gov's JSON; null for a 404. */
  private async json<T>(url: string): Promise<T | null> {
    const res = await this.request(url, { accept: 'application/json', 'X-Api-Key': await this.key() }, 'Congress.gov');
    if (res.status === 404) return null;
    this.refuseFailure(res, 'Congress.gov');
    try {
      return (await res.json()) as T;
    } catch {
      throw new BillSourceError('unreachable', 'Congress.gov');
    }
  }
}

/** Made-up votes for the local fixtures' roll calls (`BILLS=local`): a few real members, so pages and tests have rows. */
const LOCAL_MEMBERS: Readonly<Record<'house' | 'senate', readonly Omit<MemberVote, 'vote'>[]>> = {
  house: [
    { memberId: 'C001131', name: 'Greg Casar', party: 'D', state: 'TX', district: 35 },
    { memberId: 'K000389', name: 'Ro Khanna', party: 'D', state: 'CA', district: 17 },
    { memberId: 'B001278', name: 'Suzanne Bonamici', party: 'D', state: 'OR', district: 1 },
    { memberId: 'F000446', name: 'Randy Feenstra', party: 'R', state: 'IA', district: 4 },
    { memberId: 'A000055', name: 'Robert B. Aderholt', party: 'R', state: 'AL', district: 4 },
  ],
  senate: [
    { memberId: 'S000033', name: 'Bernard Sanders', party: 'I', state: 'VT', district: null },
    { memberId: 'G000574', name: 'Ruben Gallego', party: 'D', state: 'AZ', district: null },
    { memberId: 'C000127', name: 'Maria Cantwell', party: 'D', state: 'WA', district: null },
    { memberId: 'C001098', name: 'Ted Cruz', party: 'R', state: 'TX', district: null },
  ],
};

/** The emulator-only stand-in (`BILLS=local`): each fixture roll call's votes, made up the same way every time. */
export class LocalRollCallSource implements RollCallSource {
  async rollCall(ref: RollCallRef, date: string): Promise<RollCallRecord | null> {
    const pattern = LOCAL_VOTES[rollCallId(ref)];
    if (!pattern) return null;
    const votes = LOCAL_MEMBERS[ref.chamber].map((m, i) => ({ ...m, vote: pattern.votes[i % pattern.votes.length]! }));
    return { ...ref, voteId: rollCallId(ref), date, question: pattern.question, result: pattern.result, votes, sourceUrl: 'local', fetchedAt: new Date().toISOString() };
  }
}

/** The made-up fixture bill's roll calls (H.R. 6100 in local-bill-source.ts), and how the members voted, in their order. */
const LOCAL_VOTES: Readonly<Record<string, { readonly question: string; readonly result: string; readonly votes: readonly MemberVote['vote'][] }>> = {
  'house-119-2-301': { question: 'On Passage', result: 'Passed', votes: ['yea', 'yea', 'nay', 'nay', 'yea'] },
  'house-119-2-300': { question: 'On Motion to Recommit', result: 'Failed', votes: ['nay', 'nay', 'yea', 'yea', 'nay'] },
  'senate-119-2-250': { question: 'On Passage of the Bill', result: 'Bill Passed (3-1)', votes: ['yea', 'present', 'yea', 'nay'] },
};
