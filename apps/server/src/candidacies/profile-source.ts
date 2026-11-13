import { Logger } from '@nestjs/common';
import {
  orderPositions,
  PROFILE_LIMITS,
  shortened,
  type AreaContact,
  type ContactFeedState,
  type ContactPhoto,
  type ContactProfile,
  type ProfilePosition,
} from 'ustp-domain';

/**
 * Where the biographies and experience of the people on the Candidates and Your area pages come from (design §5.12):
 * Wikidata, which knows politicians by their FEC candidate ID and Congress Bioguide ID, and Wikipedia's article on
 * them. Nobody is matched by name, so a profile is never someone else's.
 */
export interface ProfileSource {
  /** The people, each with their profile and photo where the records know them; and whether the records answered. */
  withProfiles(people: readonly AreaContact[]): Promise<{ people: AreaContact[]; state: ContactFeedState }>;
}

export const PROFILE_SOURCE = Symbol('ProfileSource');

/** Wikidata's properties for the IDs the feeds give: P1839, the FEC candidate ID; P1157, the Bioguide ID. */
type OfficialId = { readonly property: 'P1839' | 'P1157'; readonly id: string };

/** The ID Wikidata can know a person by, from their contact ID (`fec:H8CA49058`, `congress:L000593`); none for others. */
export function officialId(contactId: string): OfficialId | null {
  const at = contactId.indexOf(':');
  const feed = contactId.slice(0, at);
  const id = contactId.slice(at + 1);
  if (feed === 'fec' && /^[HSP][0-9A-Z]{8}$/.test(id)) return { property: 'P1839', id };
  if (feed === 'congress' && /^[A-Z][0-9]{6}$/.test(id)) return { property: 'P1157', id };
  return null;
}

const idKey = (o: OfficialId) => `${o.property}:${o.id}`;

const SPARQL = 'https://query.wikidata.org/sparql';
const SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
/** Wikimedia asks every client to say who it is. */
const USER_AGENT = 'USTPVote2/1.0 (https://github.com/ggrow3/USTPVote2)';
const TIMEOUT_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED = 5000;
const PHOTO_WIDTH = 240;

/** What the records say about one person; null when Wikidata has nothing to show for them. */
type Found = { readonly profile: ContactProfile | null; readonly photo: ContactPhoto | null } | null;

interface Binding {
  readonly [name: string]: { readonly value: string } | undefined;
}

const qid = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1);
const year = (dateTime: string | undefined) => (dateTime && /^\d{4}-/.test(dateTime) ? dateTime.slice(0, 4) : null);
/** A label, unless the label service fell back to the bare item ID for want of an English one. */
const label = (v: string | undefined) => (v && !/^Q\d+$/.test(v) ? v.slice(0, PROFILE_LIMITS.label) : null);
const unique = (values: readonly (string | null)[], max: number) => [...new Set(values.filter((v): v is string => v !== null))].slice(0, max);

/** Commons' "Artist" is HTML: its text, without tags or entities. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Wikidata (CC0) and Wikipedia (CC BY-SA 4.0, credited on the page). For each person not already known: their
 * Wikidata item by official ID, with its English Wikipedia article and image; the offices they have held (with the
 * district and years), where they studied and their occupations; the start of the article; and the image's author and
 * licence from Wikimedia Commons. Each person's answer, or that there is none, is kept a day; a failure is not kept.
 */
export class WikipediaProfileSource implements ProfileSource {
  private readonly logger = new Logger(WikipediaProfileSource.name);
  private readonly cache = new Map<string, { readonly at: number; readonly found: Found }>();

  constructor(private readonly fetchFn: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init)) {}

  async withProfiles(people: readonly AreaContact[]): Promise<{ people: AreaContact[]; state: ContactFeedState }> {
    const ids = new Map<string, OfficialId>();
    for (const p of people) {
      const o = officialId(p.contactId);
      if (o && !this.fresh(idKey(o))) ids.set(idKey(o), o);
    }
    let state: ContactFeedState = 'ok';
    const now = new Map<string, Found>();
    if (ids.size) {
      try {
        const { found, failed } = await this.lookUp([...ids.values()]);
        for (const [key, value] of found) {
          now.set(key, value);
          if (!failed.has(key)) this.remember(key, value);
        }
        if (failed.size) state = 'unavailable';
      } catch (e) {
        this.logger.warn(`Wikidata unavailable: ${e instanceof Error ? e.message : String(e)}`);
        state = 'unavailable';
      }
    }
    return {
      people: people.map((p) => {
        const o = officialId(p.contactId);
        const found = o ? (now.get(idKey(o)) ?? this.fresh(idKey(o))?.found ?? null) : null;
        return found ? { ...p, profile: found.profile, photo: found.photo ?? p.photo } : p;
      }),
      state,
    };
  }

  private fresh(key: string) {
    const hit = this.cache.get(key);
    return hit && Date.now() - hit.at < DAY_MS ? hit : undefined;
  }

  private remember(key: string, found: Found): void {
    this.cache.delete(key);
    if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: Date.now(), found });
  }

  /** Everyone's answers; `failed` holds those whose article or photo credit did not come, to be asked again. */
  private async lookUp(ids: readonly OfficialId[]): Promise<{ found: Map<string, Found>; failed: Set<string> }> {
    const values = (property: OfficialId['property']) =>
      ids
        .filter((o) => o.property === property)
        .map((o) => `"${o.id}"`)
        .join(' ');
    const branches = [
      values('P1839') && `{ VALUES ?id { ${values('P1839')} } ?item wdt:P1839 ?id . BIND("P1839" AS ?property) }`,
      values('P1157') && `{ VALUES ?id { ${values('P1157')} } ?item wdt:P1157 ?id . BIND("P1157" AS ?property) }`,
    ].filter(Boolean);
    // One query, a row per fact: the article, the image, each office held (with its qualifiers), school and occupation.
    const rows = await this.sparql(`SELECT ?property ?id ?item ?kind ?value ?valueLabel ?start ?end ?placeLabel WHERE {
  ${branches.join(' UNION ')}
  { ?value schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . BIND("article" AS ?kind) }
  UNION { ?item wdt:P18 ?value . BIND("image" AS ?kind) }
  UNION { ?item p:P39 ?st . ?st ps:P39 ?value . FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
    OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end } OPTIONAL { ?st pq:P768 ?place } BIND("position" AS ?kind) }
  UNION { ?item wdt:P69 ?value . BIND("education" AS ?kind) }
  UNION { ?item wdt:P106 ?value . BIND("occupation" AS ?kind) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`);
    const itemOf = new Map<string, string>();
    const articleOf = new Map<string, string>();
    const imageOf = new Map<string, string>();
    for (const b of rows) {
      const item = qid(b.item!.value);
      itemOf.set(`${b.property!.value}:${b.id!.value}`, item);
      if (b.kind?.value === 'article' && !articleOf.has(item)) articleOf.set(item, b.value!.value);
      if (b.kind?.value === 'image' && !imageOf.has(item)) imageOf.set(item, b.value!.value);
    }
    // An item can be found by two IDs (an FEC ID and a Bioguide ID): its facts once each.
    const facts = [...new Map(rows.map((b) => [JSON.stringify([qid(b.item!.value), b.kind?.value, b.value?.value, b.start?.value, b.end?.value, b.placeLabel?.value]), b])).values()];
    const found = new Map<string, Found>(ids.map((o) => [idKey(o), null]));
    const failed = new Set<string>();
    if (!itemOf.size) return { found, failed };
    const [summaries, photos] = await Promise.all([this.summaries([...articleOf.entries()]), this.photos([...imageOf.entries()])]);

    for (const [key, item] of itemOf) {
      const mine = facts.filter((b) => qid(b.item!.value) === item);
      const positions: ProfilePosition[] = mine.flatMap((b) => {
        const title = b.kind?.value === 'position' ? label(b.valueLabel?.value) : null;
        return title ? [{ title, place: label(b.placeLabel?.value), start: year(b.start?.value), end: year(b.end?.value) }] : [];
      });
      const of = (kind: string, max: number) => unique(mine.filter((b) => b.kind?.value === kind).map((b) => label(b.valueLabel?.value)), max);
      const summary = summaries.found.get(item) ?? null;
      const profile: ContactProfile = {
        summary: summary?.text ?? null,
        articleUrl: summary?.url ?? articleOf.get(item) ?? null,
        wikidataUrl: `https://www.wikidata.org/wiki/${item}`,
        positions: orderPositions(positions),
        education: of('education', PROFILE_LIMITS.education),
        occupations: of('occupation', PROFILE_LIMITS.occupations),
      };
      const hasProfile = profile.summary !== null || profile.positions.length > 0 || profile.education.length > 0 || profile.occupations.length > 0;
      const photo = photos.found.get(item) ?? null;
      found.set(key, hasProfile || photo ? { profile: hasProfile ? profile : null, photo } : null);
      if (summaries.failed.has(item) || photos.failed.has(item)) failed.add(key);
    }
    return { found, failed };
  }

  /** The start of each item's English Wikipedia article, as plain text, cut short; none for a disambiguation page. */
  private async summaries(articles: readonly [string, string][]): Promise<{ found: Map<string, { text: string; url: string }>; failed: Set<string> }> {
    const found = new Map<string, { text: string; url: string }>();
    const failed = new Set<string>();
    await Promise.all(
      articles.map(async ([item, article]) => {
        const title = decodeURIComponent(article.slice(article.indexOf('/wiki/') + '/wiki/'.length));
        try {
          const body = await this.json<{ type?: string; extract?: string; content_urls?: { desktop?: { page?: string } } }>(`${SUMMARY}${encodeURIComponent(title)}`);
          const url = body.content_urls?.desktop?.page;
          if (body.type !== 'disambiguation' && body.extract?.trim()) {
            found.set(item, { text: shortened(body.extract, PROFILE_LIMITS.summary), url: url && /^https:\/\//.test(url) ? url : article });
          }
        } catch (e) {
          this.logger.warn(`Wikipedia summary of ${title} unavailable: ${e instanceof Error ? e.message : String(e)}`);
          failed.add(item);
        }
      }),
    );
    return { found, failed };
  }

  /** A thumbnail of each item's image, with its author and licence from Commons; none where Commons gives no licence. */
  private async photos(images: readonly [string, string][]): Promise<{ found: Map<string, ContactPhoto>; failed: Set<string> }> {
    const found = new Map<string, ContactPhoto>();
    const failed = new Set<string>();
    if (!images.length) return { found, failed };
    // `…/Special:FilePath/Mike%20Levin.jpg` → `File:Mike Levin.jpg`; Commons normalizes titles, so compare its way.
    const fileOf = new Map(images.map(([item, url]) => [item, `File:${decodeURIComponent(url.slice(url.lastIndexOf('/') + 1)).replace(/_/g, ' ')}`]));
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: String(PHOTO_WIDTH),
      iiextmetadatafilter: 'Artist|LicenseShortName',
      titles: [...new Set(fileOf.values())].join('|'),
    });
    try {
      const body = await this.json<{
        query?: {
          pages?: {
            title: string;
            imageinfo?: { thumburl?: string; descriptionurl?: string; extmetadata?: Record<string, { value?: string } | undefined> }[];
          }[];
        };
      }>(`${COMMONS}?${params}`);
      const pages = new Map((body.query?.pages ?? []).map((p) => [p.title, p.imageinfo?.[0]]));
      for (const [item, file] of fileOf) {
        const info = pages.get(file);
        const licence = info?.extmetadata?.LicenseShortName?.value?.trim();
        if (!info?.thumburl?.startsWith('https://') || !licence) continue;
        const artist = info.extmetadata?.Artist?.value ? plainText(info.extmetadata.Artist.value) : '';
        found.set(item, {
          url: info.thumburl,
          credit: `Photo: ${artist || 'Wikimedia Commons'}, ${plainText(licence)}`.slice(0, PROFILE_LIMITS.credit),
          creditUrl: info.descriptionurl?.startsWith('https://') ? info.descriptionurl : null,
        });
      }
    } catch (e) {
      this.logger.warn(`Commons unavailable: ${e instanceof Error ? e.message : String(e)}`);
      for (const item of fileOf.keys()) failed.add(item);
    }
    return { found, failed };
  }

  private async sparql(query: string): Promise<Binding[]> {
    const body = await this.json<{ results?: { bindings?: Binding[] } }>(`${SPARQL}?${new URLSearchParams({ query, format: 'json' })}`, {
      accept: 'application/sparql-results+json',
    });
    return body.results?.bindings ?? [];
  }

  private async json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

/**
 * Made-up profiles for the emulators (`DISTRICTS=local`): the representative who runs again (`LocalContactSource`'s
 * Hal House) has a biography, offices held and a photo, as in office and as a candidate; nobody else has one.
 */
export class LocalProfileSource implements ProfileSource {
  async withProfiles(people: readonly AreaContact[]): Promise<{ people: AreaContact[]; state: ContactFeedState }> {
    const profile: ContactProfile = {
      summary: 'Hal House is a made-up U.S. Representative, for testing. Before Congress, Hal served in the State Assembly.',
      articleUrl: 'https://en.wikipedia.org/wiki/Example',
      wikidataUrl: 'https://www.wikidata.org/wiki/Q1',
      positions: [
        { title: 'member of the United States House of Representatives', place: 'Congressional District 1', start: '2019', end: null },
        { title: 'member of the State Assembly', place: null, start: '2012', end: '2018' },
      ],
      education: ['Example State University'],
      occupations: ['lawyer'],
    };
    const photo: ContactPhoto = { url: 'https://upload.wikimedia.org/example.jpg', credit: 'Photo: Example Photographer, CC BY-SA 4.0', creditUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg' };
    return {
      people: people.map((p) => (p.name === 'Hal House' && /^(fec|congress):/.test(p.contactId) ? { ...p, profile, photo } : p)),
      state: 'ok',
    };
  }
}
