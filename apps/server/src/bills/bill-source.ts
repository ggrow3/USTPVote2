import {
  BILL_LIMITS,
  BILL_STAGES,
  billId,
  billLabel,
  isBillType,
  packageId,
  parsePackageId,
  parseRollCallId,
  STAGE_VERSIONS,
  validBillRef,
  versionLabel,
  versionStage,
  type BillAction,
  type BillHit,
  type BillLatestAction,
  type BillLaw,
  type BillListItem,
  type BillRecentPage,
  type BillRecentSort,
  type BillRecord,
  type BillRef,
  type BillSearch,
  type BillSearchPage,
  type BillSponsor,
  type BillSummary,
  type BillText,
  type BillTextVersion,
  type BillType,
  type BillVersionRef,
  type RecordedVote,
} from 'ustp-domain';

/** A Congress's bills by when they were last updated (`GET /v1/bills/recent`), settled. */
export interface BillRecentQuery {
  readonly congress: number;
  readonly type: BillType | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly sort: BillRecentSort;
  readonly page: number;
}

/**
 * Where the Bills page's bills come from (design §5.14): the Congress.gov API and GovInfo, or the emulator-only
 * fixtures. Read only.
 */
export interface BillSource {
  /** Bills' printed versions matching a search, twenty a page, grouped by bill on the page. */
  search(search: BillSearch, latest: number): Promise<BillSearchPage>;
  /** A Congress's bills by when they were last updated, twenty a page. */
  recent(query: BillRecentQuery): Promise<BillRecentPage>;
  /** One bill with its actions, summaries and text versions; null when there is no such bill. */
  bill(ref: BillRef): Promise<BillRecord | null>;
  /** One printed version's text; null when there is no such version. */
  text(ref: BillVersionRef): Promise<BillText | null>;
}

export const BILL_SOURCE = Symbol('BillSource');

/** The services the bills context reads: Congress.gov and GovInfo with the key, the Senate's roll call XML without. */
export type BillService = 'Congress.gov' | 'GovInfo' | 'Senate.gov';

/** A service could not answer: its hourly limit reached (429), the key refused, or a failure or timeout (502). */
export class BillSourceError extends Error {
  constructor(
    readonly kind: 'rate_limited' | 'key_refused' | 'unreachable',
    readonly service: BillService,
  ) {
    super(
      kind === 'rate_limited'
        ? service === 'Senate.gov'
          ? `${service} has had too many requests just now; try again later`
          : `${service} has had too many requests with this key this hour; try again later`
        : kind === 'key_refused'
          ? `${service} refused the api.data.gov key; a System Admin checks it under Admin › API keys`
          : `${service} could not be reached just now; try again shortly`,
    );
  }
}

const CONGRESS = 'https://api.congress.gov/v3';
const GOVINFO = 'https://api.govinfo.gov';
/** Congress.gov's single-bill answer has taken over 15 seconds (2026-11-08), so a generous wait before giving up. */
const TIMEOUT_MS = 30_000;
const MINUTE = 60_000;
const CACHE = {
  search: { ttl: 10 * MINUTE, max: 300 },
  recent: { ttl: 10 * MINUTE, max: 300 },
  bill: { ttl: 30 * MINUTE, max: 500 },
  text: { ttl: 24 * 60 * MINUTE, max: 30 },
} as const;
/** A text over this many bytes is not read at all: no bill's text comes near it, and memory is shared. */
const MAX_TEXT_BYTES = 40_000_000;

/** Answers kept in memory for a while, at most `max` of them; a failed answer is not kept. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { readonly at: number; readonly value: Promise<V> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = load();
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
    return value;
  }
}

/** The GovInfo query for a search (design §5.14). The words were cleaned (`cleanSearchWords`); the member checked. */
export function govInfoQuery(search: BillSearch, today: string): string {
  const parts = ['collection:(BILLS)', `congress:(${search.congress})`];
  if (search.type) parts.push(`docclass:(${search.type})`);
  if (search.stage) parts.push(`billversion:(${STAGE_VERSIONS[search.stage].join(' OR ')})`);
  if (search.member) parts.push(`member:("${search.member.replace(/"/g, '')}")`);
  if (search.from || search.to) parts.push(`publishdate:range(${search.from ?? '1993-01-01'},${search.to ?? today})`);
  if (search.words) parts.push(`(${search.words})`);
  return parts.join(' AND ');
}

const GOVINFO_SORTS: Readonly<Record<BillSearch['sort'], { readonly field: string; readonly sortOrder: 'ASC' | 'DESC' }>> = {
  relevance: { field: 'score', sortOrder: 'DESC' },
  newest: { field: 'publishdate', sortOrder: 'DESC' },
  oldest: { field: 'publishdate', sortOrder: 'ASC' },
  title: { field: 'title', sortOrder: 'ASC' },
  title_desc: { field: 'title', sortOrder: 'DESC' },
};

interface GovInfoResult {
  readonly packageId?: string;
  readonly title?: string;
  readonly dateIssued?: string | null;
  readonly governmentAuthor?: readonly string[];
}

const chamberOf = (text: string | null | undefined): 'House' | 'Senate' | null =>
  text ? (/senate/i.test(text) ? 'Senate' : /house/i.test(text) ? 'House' : null) : null;

const stageRank = (version: string) => {
  const stage = versionStage(version);
  return stage ? BILL_STAGES.indexOf(stage) : -1;
};

/** GovInfo's results grouped by bill, in the order each bill first appears, each shown as its furthest version there. */
export function groupHits(results: readonly GovInfoResult[], latest: number): BillHit[] {
  const groups = new Map<string, { ref: BillVersionRef; result: GovInfoResult; versions: string[] }>();
  for (const result of results) {
    const ref = result.packageId ? parsePackageId(result.packageId, latest) : null;
    if (!ref) continue;
    const id = billId(ref);
    const group = groups.get(id);
    if (!group) {
      groups.set(id, { ref, result, versions: [ref.version] });
      continue;
    }
    group.versions.push(ref.version);
    if (stageRank(ref.version) > stageRank(group.ref.version)) {
      group.ref = ref;
      group.result = result;
    }
  }
  return [...groups.values()].map(({ ref, result, versions }) => {
    const bill: BillRef = { congress: ref.congress, type: ref.type, number: ref.number };
    return {
      ...bill,
      id: billId(bill),
      label: billLabel(bill),
      title: (result.title ?? '').trim() || billLabel(bill),
      chamber: chamberOf(result.governmentAuthor?.join(' ')) ?? (ref.type.startsWith('h') ? 'House' : 'Senate'),
      version: ref.version,
      versionLabel: versionLabel(ref.version),
      stage: versionStage(ref.version),
      date: result.dateIssued ?? null,
      otherVersions: versions.filter((v) => v !== ref.version),
    };
  });
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', sect: '§', para: '¶' };

/** HTML character references back into characters; an unknown one is left as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/**
 * A CRS summary's HTML as plain paragraphs: each paragraph, heading and list item its own, list items starting "• ",
 * every tag dropped. No markup from elsewhere reaches the page.
 */
export function htmlParagraphs(html: string): string[] {
  const marked = html
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*li[^>]*>/gi, '\n\n• ')
    .replace(/<\s*(br)\s*\/?>/gi, '\n\n')
    .replace(/<\s*\/\s*(p|li|h[1-6]|div|ul|ol|blockquote|table|tr)\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(marked)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p && p !== '•');
}

/** GovInfo's printed text of a version (`<html><body><pre>…</pre>`) as plain text, as printed. */
export function plainBillText(html: string): string {
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(html);
  const body = (pre ? pre[1]! : html).replace(/<[^>]*>/g, '');
  return decodeEntities(body).replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '');
}

/** The version code in a congress.gov text file's name: `…/BILLS-119hr997enr.htm` is `enr`. */
export function versionFromUrl(url: string): string | null {
  const m = /BILLS-\d{3}[a-z]+\d+([a-z]+?)(?:_uslm)?\.(?:htm|html|pdf|xml)$/i.exec(url);
  return m ? m[1]!.toLowerCase() : null;
}

interface CongressSponsor {
  readonly bioguideId?: string;
  readonly fullName?: string;
  readonly party?: string;
  readonly state?: string;
  readonly district?: number | string | null;
}

interface CongressLatestAction {
  readonly actionDate?: string;
  readonly text?: string;
}

interface CongressBill {
  readonly congress?: number | string;
  readonly type?: string;
  readonly number?: number | string;
  readonly title?: string;
  readonly originChamber?: string;
  readonly introducedDate?: string;
  readonly updateDate?: string;
  readonly policyArea?: { readonly name?: string } | null;
  readonly sponsors?: readonly CongressSponsor[];
  readonly cosponsors?: { readonly count?: number } | null;
  readonly latestAction?: CongressLatestAction | null;
  readonly laws?: readonly { readonly type?: string; readonly number?: string }[];
}

interface CongressRecordedVote {
  readonly chamber?: string;
  readonly congress?: number | string;
  readonly sessionNumber?: number | string;
  readonly rollNumber?: number | string;
  readonly date?: string;
}

interface CongressAction {
  readonly actionDate?: string;
  readonly text?: string;
  readonly type?: string;
  readonly sourceSystem?: { readonly name?: string } | null;
  readonly recordedVotes?: readonly CongressRecordedVote[];
}

/** An action's roll calls (design §5.14, "Legislation and the scorecard"); one whose parts are not a roll call is left out. */
export function recordedVotesOf(votes: readonly CongressRecordedVote[] | undefined): RecordedVote[] {
  return (votes ?? []).flatMap((v): RecordedVote[] => {
    const chamber = /^house$/i.test(v.chamber ?? '') ? 'house' : /^senate$/i.test(v.chamber ?? '') ? 'senate' : null;
    const ref = chamber ? parseRollCallId(`${chamber}-${v.congress}-${v.sessionNumber}-${v.rollNumber}`) : null;
    return ref && v.date ? [{ ...ref, date: v.date }] : [];
  });
}

interface CongressTextVersion {
  readonly type?: string;
  readonly date?: string | null;
  readonly formats?: readonly { readonly type?: string; readonly url?: string }[];
}

interface CongressSummary {
  readonly versionCode?: string;
  readonly actionDate?: string;
  readonly actionDesc?: string;
  readonly updateDate?: string;
  readonly text?: string;
}

const latestActionOf = (a: CongressLatestAction | null | undefined): BillLatestAction | null =>
  a?.actionDate && a.text ? { date: a.actionDate, text: a.text.trim() } : null;

const sponsorOf = (s: CongressSponsor): BillSponsor => ({
  bioguideId: s.bioguideId ?? '',
  fullName: (s.fullName ?? '').trim(),
  party: s.party ?? null,
  state: s.state ?? null,
  district: s.district === null || s.district === undefined || s.district === '' ? null : Number(s.district),
});

/** Congress.gov's list item as a bill in the list; null for one whose parts are not a bill the tool knows. */
function listItemOf(bill: CongressBill, latest: number): BillListItem | null {
  const type = (bill.type ?? '').toLowerCase();
  const ref = isBillType(type) ? validBillRef(Number(bill.congress), type, Number(bill.number), latest) : null;
  if (!ref) return null;
  return {
    ...ref,
    id: billId(ref),
    label: billLabel(ref),
    title: (bill.title ?? '').trim() || billLabel(ref),
    chamber: chamberOf(bill.originChamber),
    introducedDate: bill.introducedDate ?? null,
    updatedAt: bill.updateDate ?? null,
    latestAction: latestActionOf(bill.latestAction),
  };
}

function textVersionOf(v: CongressTextVersion): BillTextVersion | null {
  // Only https links reach the page's hrefs, whatever the service answers.
  const url = (kind: RegExp, not?: RegExp) =>
    v.formats?.find((f) => /^https:\/\//i.test(f.url ?? '') && kind.test(f.type ?? '') && !(not && not.test(f.url ?? '')))?.url ?? null;
  const pdfUrl = url(/pdf/i);
  const xmlUrl = url(/formatted xml/i, /_uslm\.xml$/i) ?? url(/xml/i);
  const htmlUrl = url(/formatted text/i);
  const version = [htmlUrl, pdfUrl, xmlUrl].map((u) => (u ? versionFromUrl(u) : null)).find((c) => c) ?? null;
  if (!version) return null;
  return { version, label: (v.type ?? '').trim() || versionLabel(version), date: v.date ? v.date.slice(0, 10) : null, pdfUrl, xmlUrl, htmlUrl };
}

function summaryOf(s: CongressSummary): BillSummary | null {
  const paragraphs = htmlParagraphs(s.text ?? '');
  if (!paragraphs.length || !s.actionDate) return null;
  return { versionLabel: (s.actionDesc ?? '').trim() || 'Summary', date: s.actionDate, paragraphs };
}

/**
 * The Congress.gov API and GovInfo's search service (design §5.14), both with one api.data.gov key, sent in a header.
 * Answers are kept in memory a while, so a team reading the same bills spends little of the key's hourly limit.
 */
export class PublicBillSource implements BillSource {
  private readonly searches: TtlCache<BillSearchPage>;
  private readonly recents: TtlCache<BillRecentPage>;
  private readonly bills: TtlCache<BillRecord | null>;
  private readonly texts: TtlCache<BillText | null>;

  constructor(
    private readonly key: () => Promise<string>,
    private readonly fetchFn: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {
    this.searches = new TtlCache(CACHE.search.ttl, CACHE.search.max, now);
    this.recents = new TtlCache(CACHE.recent.ttl, CACHE.recent.max, now);
    this.bills = new TtlCache(CACHE.bill.ttl, CACHE.bill.max, now);
    this.texts = new TtlCache(CACHE.text.ttl, CACHE.text.max, now);
  }

  search(search: BillSearch, latest: number): Promise<BillSearchPage> {
    return this.searches.get(JSON.stringify(search), async () => {
      const today = new Date(this.now()).toISOString().slice(0, 10);
      const body = await this.json<{ count?: number; offsetMark?: string | null; results?: GovInfoResult[] }>('GovInfo', `${GOVINFO}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: govInfoQuery(search, today),
          pageSize: BILL_LIMITS.pageSize,
          offsetMark: search.cursor ?? '*',
          sorts: [GOVINFO_SORTS[search.sort]],
        }),
      });
      const results = body?.results ?? [];
      return {
        search,
        total: body?.count ?? 0,
        hits: groupHits(results, latest),
        next: results.length >= BILL_LIMITS.pageSize && body?.offsetMark ? body.offsetMark : null,
      };
    });
  }

  recent(query: BillRecentQuery): Promise<BillRecentPage> {
    return this.recents.get(JSON.stringify(query), async () => {
      const params = new URLSearchParams({
        format: 'json',
        limit: String(BILL_LIMITS.pageSize),
        offset: String((query.page - 1) * BILL_LIMITS.pageSize),
        sort: `updateDate ${query.sort === 'updated' ? 'desc' : 'asc'}`,
      });
      if (query.from) params.set('fromDateTime', `${query.from}T00:00:00Z`);
      if (query.to) params.set('toDateTime', `${query.to}T23:59:59Z`);
      const path = `/bill/${query.congress}${query.type ? `/${query.type}` : ''}`;
      const body = await this.json<{ bills?: CongressBill[]; pagination?: { count?: number } }>('Congress.gov', `${CONGRESS}${path}?${params}`);
      const items = (body?.bills ?? []).map((b) => listItemOf(b, query.congress)).filter((b): b is BillListItem => b !== null);
      const total = body?.pagination?.count ?? items.length;
      return { congress: query.congress, total, page: query.page, items, hasMore: (query.page - 1) * BILL_LIMITS.pageSize + (body?.bills?.length ?? 0) < total };
    });
  }

  bill(ref: BillRef): Promise<BillRecord | null> {
    return this.bills.get(billId(ref), async () => {
      const base = `${CONGRESS}/bill/${ref.congress}/${ref.type}/${ref.number}`;
      const list = '?format=json&limit=250';
      // All four at once: a bill that does not exist costs three wasted requests, every other bill a quarter of the wait.
      const [detail, actions, texts, summaries] = await Promise.all([
        this.json<{ bill?: CongressBill }>('Congress.gov', `${base}?format=json`, undefined, true),
        this.json<{ actions?: CongressAction[] }>('Congress.gov', `${base}/actions${list}`, undefined, true),
        this.json<{ textVersions?: CongressTextVersion[] }>('Congress.gov', `${base}/text${list}`, undefined, true),
        this.json<{ summaries?: CongressSummary[] }>('Congress.gov', `${base}/summaries${list}`, undefined, true),
      ]);
      if (!detail?.bill) return null;
      const b = detail.bill;
      return {
        ...ref,
        title: (b.title ?? '').trim() || billLabel(ref),
        chamber: chamberOf(b.originChamber),
        introducedDate: b.introducedDate ?? null,
        updatedAt: b.updateDate ?? null,
        policyArea: b.policyArea?.name ?? null,
        sponsors: (b.sponsors ?? []).map(sponsorOf),
        cosponsors: b.cosponsors?.count ?? 0,
        latestAction: latestActionOf(b.latestAction),
        laws: (b.laws ?? []).filter((l) => l.number).map((l): BillLaw => ({ type: l.type ?? 'Public Law', number: l.number! })),
        actions: (actions?.actions ?? [])
          .filter((a) => a.actionDate && a.text)
          .map((a): BillAction => {
            const votes = recordedVotesOf(a.recordedVotes);
            return { date: a.actionDate!, text: a.text!.trim(), type: a.type ?? null, source: a.sourceSystem?.name ?? null, ...(votes.length ? { votes } : {}) };
          }),
        summaries: (summaries?.summaries ?? [])
          .map(summaryOf)
          .filter((s): s is BillSummary => s !== null)
          .sort((x, y) => y.date.localeCompare(x.date)),
        textVersions: (texts?.textVersions ?? []).map(textVersionOf).filter((v): v is BillTextVersion => v !== null),
      };
    });
  }

  text(ref: BillVersionRef): Promise<BillText | null> {
    const id = packageId(ref);
    return this.texts.get(id, async () => {
      const res = await this.request('GovInfo', `${GOVINFO}/packages/${id}/htm`, undefined);
      if (res.status === 404) return null;
      await this.refuseFailure('GovInfo', res);
      const length = Number(res.headers.get('content-length') ?? 0);
      if (length > MAX_TEXT_BYTES) throw new BillSourceError('unreachable', 'GovInfo');
      const text = plainBillText(await res.text());
      return {
        ...ref,
        label: versionLabel(ref.version),
        text: text.slice(0, BILL_LIMITS.text),
        truncated: text.length > BILL_LIMITS.text,
        pdfUrl: `https://www.govinfo.gov/content/pkg/${id}/pdf/${id}.pdf`,
      };
    });
  }

  private async request(service: BillService, url: string, init: RequestInit | undefined): Promise<Response> {
    const key = await this.key();
    try {
      return await this.fetchFn(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json', ...(init?.headers as Record<string, string> | undefined), 'X-Api-Key': key },
      });
    } catch {
      throw new BillSourceError('unreachable', service);
    }
  }

  private async refuseFailure(service: BillService, res: Response): Promise<void> {
    if (res.ok) return;
    if (res.status === 429) throw new BillSourceError('rate_limited', service);
    if (res.status === 401 || res.status === 403) throw new BillSourceError('key_refused', service);
    throw new BillSourceError('unreachable', service);
  }

  /** The service's JSON; null for a 404 when `missingIsNull`. */
  private async json<T>(service: BillService, url: string, init?: RequestInit, missingIsNull = false): Promise<T | null> {
    const res = await this.request(service, url, init);
    if (missingIsNull && res.status === 404) return null;
    await this.refuseFailure(service, res);
    try {
      return (await res.json()) as T;
    } catch {
      throw new BillSourceError('unreachable', service);
    }
  }
}
