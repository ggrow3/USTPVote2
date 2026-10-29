import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  DISTRICT_ID,
  NATION_ID,
  STATE_FIPS,
  stateOfDistrict,
  type District,
  type DistrictBoundary,
  type DistrictKind,
} from 'ustp-domain';

/**
 * Where candidacies' districts come from (design §5.8): the districts of a kind in a state, for the declaration form,
 * and a district's outline, for the map. The api looks a district up whenever a member declares, so a candidacy stores
 * the source's own name and GEOID.
 */
export interface DistrictSource {
  /** The districts of a kind in a state (the state itself for `state`, the nation for `nation`), in name order. */
  list(kind: DistrictKind, state: string | null): Promise<District[]>;
  /** The district's outline, simplified for a map; null for the nation, or a GEOID the source does not know. */
  boundary(kind: DistrictKind, geoid: string): Promise<DistrictBoundary | null>;
}

export const DISTRICT_SOURCE = Symbol('DistrictSource');

const NATION: District = { kind: 'nation', geoid: NATION_ID, state: null, name: 'United States', point: { lat: 39.83, lng: -98.58 }, vintage: null };

/** `06` for `CA`; the GEOID of a state's own boundary. */
const fipsOf = (state: string | null) => (state === null ? undefined : STATE_FIPS[state]);

/** The Census Bureau's TIGERweb service of the current boundaries; each layer below is one kind of district. */
const TIGERWEB = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer';
const LAYERS: Readonly<Record<Exclude<DistrictKind, 'nation'>, number>> = {
  state: 80,
  congressional: 54,
  state_upper: 56,
  state_lower: 58,
  county: 82,
  place: 28,
};
const TIMEOUT_MS = 15_000;
/** Lists change once a year, when the Census publishes new lines. */
const LIST_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BOUNDARIES = 200;

interface Listed {
  readonly at: number;
  readonly districts: District[];
  /** Each district's land and water area in m², to simplify its outline in proportion. */
  readonly areas: ReadonlyMap<string, number>;
}

interface TigerAttributes {
  readonly GEOID: string;
  readonly NAME: string;
  readonly INTPTLAT?: string;
  readonly INTPTLON?: string;
  readonly AREALAND?: number;
  readonly AREAWATER?: number;
}

/** Districts the Census does not define ("ZZZ": water, or land in no district) are left out of the lists. */
const undefinedDistrict = (a: TigerAttributes) => /ZZ$/.test(a.GEOID) || /not defined/i.test(a.NAME);

/**
 * TIGERweb (no key needed). Lists are kept a day per kind and state; outlines are kept per process, the most recent
 * 200, and the public routes let browsers and Hosting's CDN keep them too.
 */
export class CensusDistrictSource implements DistrictSource {
  private readonly logger = new Logger(CensusDistrictSource.name);
  private readonly lists = new Map<string, Listed>();
  private readonly boundaries = new Map<string, DistrictBoundary | null>();
  private readonly vintages = new Map<number, Promise<string>>();

  async list(kind: DistrictKind, state: string | null): Promise<District[]> {
    return (await this.listed(kind, state)).districts;
  }

  async boundary(kind: DistrictKind, geoid: string): Promise<DistrictBoundary | null> {
    if (kind === 'nation' || !DISTRICT_ID.test(geoid)) return null;
    const key = `${kind}:${geoid}`;
    if (this.boundaries.has(key)) return this.boundaries.get(key) ?? null;
    const listed = await this.listed(kind, stateOfDistrict(geoid));
    const area = listed.areas.get(geoid);
    if (area === undefined) return null;
    // About 500 points across the district's width: a city block in a city, a few kilometres in Alaska.
    const offset = Math.min(0.02, Math.max(0.00005, Math.sqrt(area) / 111_000 / 500));
    const geojson = await this.query<DistrictBoundary>(LAYERS[kind], {
      where: `GEOID='${geoid}'`,
      outFields: 'GEOID,NAME',
      returnGeometry: 'true',
      maxAllowableOffset: offset.toFixed(6),
      geometryPrecision: '5',
      outSR: '4326',
      f: 'geojson',
    });
    const boundary: DistrictBoundary | null = geojson.features?.length
      ? { type: 'FeatureCollection', features: geojson.features.map((f) => ({ type: 'Feature', geometry: f.geometry, properties: {} })) }
      : null;
    if (this.boundaries.size >= MAX_BOUNDARIES) this.boundaries.delete(this.boundaries.keys().next().value!);
    this.boundaries.set(key, boundary);
    return boundary;
  }

  private async listed(kind: DistrictKind, state: string | null): Promise<Listed> {
    if (kind === 'nation') return { at: Date.now(), districts: [NATION], areas: new Map() };
    const fips = fipsOf(state);
    if (fips === undefined) return { at: Date.now(), districts: [], areas: new Map() };
    const key = `${kind}:${fips}`;
    const cached = this.lists.get(key);
    if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached;
    const layer = LAYERS[kind];
    const [result, vintage] = await Promise.all([
      this.query<{ features?: { attributes: TigerAttributes }[] }>(layer, {
        where: kind === 'state' ? `GEOID='${fips}'` : `STATE='${fips}'`,
        outFields: 'GEOID,NAME,INTPTLAT,INTPTLON,AREALAND,AREAWATER',
        returnGeometry: 'false',
        f: 'json',
      }),
      this.vintage(layer),
    ]);
    const attributes = (result.features ?? []).map((f) => f.attributes).filter((a) => !undefinedDistrict(a));
    const districts = attributes
      .map((a): District => {
        const lat = Number(a.INTPTLAT);
        const lng = Number(a.INTPTLON);
        return {
          kind,
          geoid: a.GEOID,
          state,
          name: a.NAME,
          point: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
          vintage,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    const listed: Listed = {
      at: Date.now(),
      districts,
      areas: new Map(attributes.map((a) => [a.GEOID, (a.AREALAND ?? 0) + (a.AREAWATER ?? 0)])),
    };
    this.lists.set(key, listed);
    return listed;
  }

  /** The layer's name, which says which lines it holds ("120th Congressional Districts"). */
  private vintage(layer: number): Promise<string> {
    let name = this.vintages.get(layer);
    if (!name) {
      name = this.fetchJson<{ name?: string }>(`${TIGERWEB}/${layer}?f=json`).then((info) => info.name ?? `TIGERweb layer ${layer}`);
      name.catch(() => this.vintages.delete(layer));
      this.vintages.set(layer, name);
    }
    return name;
  }

  private query<T>(layer: number, params: Record<string, string>): Promise<T> {
    return this.fetchJson<T>(`${TIGERWEB}/${layer}/query?${new URLSearchParams(params)}`);
  }

  private async fetchJson<T>(url: string): Promise<T> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as T & { error?: { message?: string } };
      if (body.error) throw new Error(body.error.message ?? 'error');
      return body;
    } catch (e) {
      this.logger.warn(`TIGERweb unavailable: ${e instanceof Error ? e.message : String(e)}`);
      throw new ServiceUnavailableException('the Census Bureau’s district lookup is not answering; try again in a minute');
    }
  }
}

/** Made-up districts for the emulators (`DISTRICTS=local`): two of each kind per state, each a small square. */
export class LocalDistrictSource implements DistrictSource {
  async list(kind: DistrictKind, state: string | null): Promise<District[]> {
    if (kind === 'nation') return [NATION];
    const fips = fipsOf(state);
    if (fips === undefined) return [];
    const point = { lat: 30 + (Number(fips) % 20), lng: -120 + Number(fips) / 2 };
    const district = (geoid: string, name: string, shift = 0): District => ({
      kind,
      geoid,
      state,
      name,
      point: { lat: point.lat + shift, lng: point.lng + shift },
      vintage: 'Local test districts',
    });
    switch (kind) {
      case 'state':
        return [district(fips, `State ${state}`)];
      case 'congressional':
        return [district(`${fips}01`, 'Congressional District 1'), district(`${fips}02`, 'Congressional District 2', 0.5)];
      case 'state_upper':
        return [district(`${fips}001`, 'State Senate District 1'), district(`${fips}002`, 'State Senate District 2', 0.5)];
      case 'state_lower':
        return [district(`${fips}001`, 'State House District 1'), district(`${fips}002`, 'State House District 2', 0.5)];
      case 'county':
        return [district(`${fips}001`, 'First County'), district(`${fips}003`, 'Second County', 0.5)];
      case 'place':
        return [district(`${fips}00100`, 'Example city'), district(`${fips}00200`, 'Sample town', 0.5)];
    }
  }

  async boundary(kind: DistrictKind, geoid: string): Promise<DistrictBoundary | null> {
    const found = (await this.list(kind, stateOfDistrict(geoid))).find((d) => d.geoid === geoid);
    if (!found?.point || kind === 'nation') return null;
    const { lat, lng } = found.point;
    const ring = [
      [lng - 0.2, lat - 0.2],
      [lng + 0.2, lat - 0.2],
      [lng + 0.2, lat + 0.2],
      [lng - 0.2, lat + 0.2],
      [lng - 0.2, lat - 0.2],
    ];
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }] };
  }
}
