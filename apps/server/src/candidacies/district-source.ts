import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  DISTRICT_ID,
  LISTED_DISTRICT_KINDS,
  NATION_ID,
  STATE_FIPS,
  stateOfDistrict,
  type District,
  type DistrictBoundary,
  type DistrictKind,
} from 'ustp-domain';
import { pointsInside } from './zip-points.js';

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
  /**
   * The districts of the listed kinds in the state that a ZIP code's area reaches into, in kind and name order; null
   * when the source has no area for that ZIP code in the state. Only the five-digit ZIP code leaves the api.
   */
  area(postalCode: string, state: string): Promise<District[] | null>;
  /**
   * The state a ZIP code is in, for a ZIP code someone types (design §5.12): the one holding the Census internal
   * point of its area; null when the source has no area for it (a PO box's ZIP code has none).
   */
  stateOfZip(postalCode: string): Promise<string | null>;
}

export const DISTRICT_SOURCE = Symbol('DistrictSource');

const NATION: District = { kind: 'nation', geoid: NATION_ID, state: null, name: 'United States', point: { lat: 39.83, lng: -98.58 }, vintage: null };

/** `06` for `CA`; the GEOID of a state's own boundary. */
const fipsOf = (state: string | null) => (state === null ? undefined : STATE_FIPS[state]);
/** `CA` for `06`. */
const stateOfFips = (fips: string | undefined) => Object.keys(STATE_FIPS).find((s) => STATE_FIPS[s] === fips) ?? null;

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
/** The 2020 Census ZIP Code Tabulation Areas: what the Census draws for a ZIP code (a PO box's has none). */
const ZCTA_LAYER = 2;
const TIMEOUT_MS = 15_000;
/** Lists change once a year, when the Census publishes new lines. */
const LIST_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BOUNDARIES = 200;
const MAX_AREAS = 1000;
/** Points sampled across a ZIP code's area, at most `AREA_GRID`²: a district holding less of it than a cell may be missed. */
const AREA_GRID = 20;

/** Degrees to simplify an outline by: about `across` points over the width of an area of `m2` square metres. */
const simplification = (m2: number, across: number, max: number) => Math.min(max, Math.max(0.00002, Math.sqrt(m2) / 111_000 / across));

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
  private readonly areas = new Map<string, { readonly at: number; readonly districts: District[] | null }>();
  private readonly zipStates = new Map<string, { readonly at: number; readonly state: string | null }>();

  constructor(private readonly fetchFn: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init)) {}

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
    const offset = Math.max(0.00005, simplification(area, 500, 0.02));
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

  async area(postalCode: string, state: string): Promise<District[] | null> {
    const zip = postalCode.slice(0, 5);
    const fips = fipsOf(state);
    if (!/^[0-9]{5}$/.test(zip) || fips === undefined) return null;
    const key = `${zip}:${state}`;
    const cached = this.areas.get(key);
    if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.districts;
    const points = await this.zipPoints(zip);
    const found = points && (await Promise.all(LISTED_DISTRICT_KINDS.map((kind) => this.holding(kind, state, fips, points)))).flat();
    const districts = found?.length ? found : null;
    this.areas.delete(key);
    if (this.areas.size >= MAX_AREAS) this.areas.delete(this.areas.keys().next().value!);
    this.areas.set(key, { at: Date.now(), districts });
    return districts;
  }

  async stateOfZip(postalCode: string): Promise<string | null> {
    const zip = postalCode.slice(0, 5);
    if (!/^[0-9]{5}$/.test(zip)) return null;
    const cached = this.zipStates.get(zip);
    if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.state;
    const found = await this.post<{ features?: { attributes: TigerAttributes }[] }>(ZCTA_LAYER, {
      where: `GEOID='${zip}'`,
      outFields: 'GEOID,INTPTLAT,INTPTLON',
      returnGeometry: 'false',
      f: 'json',
    });
    const zcta = found.features?.[0]?.attributes;
    const lat = Number(zcta?.INTPTLAT);
    const lng = Number(zcta?.INTPTLON);
    let state: string | null = null;
    if (zcta && Number.isFinite(lat) && Number.isFinite(lng)) {
      const holding = await this.post<{ features?: { attributes: Pick<TigerAttributes, 'GEOID'> }[] }>(LAYERS.state, {
        geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryPoint',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'GEOID',
        returnGeometry: 'false',
        f: 'json',
      });
      state = stateOfFips(holding.features?.[0]?.attributes.GEOID);
    }
    this.zipStates.delete(zip);
    if (this.zipStates.size >= MAX_AREAS) this.zipStates.delete(this.zipStates.keys().next().value!);
    this.zipStates.set(zip, { at: Date.now(), state });
    return state;
  }

  /** Points well inside the ZIP Code Tabulation Area, its Census internal point first; null when there is none. */
  private async zipPoints(zip: string): Promise<[number, number][] | null> {
    const where = `GEOID='${zip}'`;
    const found = await this.post<{ features?: { attributes: TigerAttributes }[] }>(ZCTA_LAYER, {
      where,
      outFields: 'GEOID,INTPTLAT,INTPTLON,AREALAND,AREAWATER',
      returnGeometry: 'false',
      f: 'json',
    });
    const zcta = found.features?.[0]?.attributes;
    if (!zcta) return null;
    // A finer outline than a district's, since a ZIP code is small: about 1,000 points across.
    const offset = simplification((zcta.AREALAND ?? 0) + (zcta.AREAWATER ?? 0), 1000, 0.005);
    const outline = await this.post<DistrictBoundary>(ZCTA_LAYER, {
      where,
      outFields: 'GEOID',
      returnGeometry: 'true',
      maxAllowableOffset: offset.toFixed(6),
      geometryPrecision: '6',
      outSR: '4326',
      f: 'geojson',
    });
    const lat = Number(zcta.INTPTLAT);
    const lng = Number(zcta.INTPTLON);
    const centre: [number, number][] = Number.isFinite(lat) && Number.isFinite(lng) ? [[lng, lat]] : [];
    return [...centre, ...(outline.features ?? []).flatMap((f) => pointsInside(f.geometry, AREA_GRID, 2 * offset))];
  }

  /** The districts of a kind in the state holding any of the points, as the state's list names them. */
  private async holding(kind: DistrictKind, state: string, fips: string, points: readonly [number, number][]): Promise<District[]> {
    if (kind === 'nation' || !points.length) return [];
    const [result, listed] = await Promise.all([
      this.post<{ features?: { attributes: Pick<TigerAttributes, 'GEOID'> }[] }>(LAYERS[kind], {
        where: `STATE='${fips}'`,
        geometry: JSON.stringify({ points, spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryMultipoint',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'GEOID',
        returnGeometry: 'false',
        f: 'json',
      }),
      this.listed(kind, state),
    ]);
    const geoids = new Set((result.features ?? []).map((f) => f.attributes.GEOID));
    return listed.districts.filter((d) => geoids.has(d.geoid));
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

  /** A query sent as a form: a sampled geometry is long, and a ZIP code is then never in a URL. */
  private post<T>(layer: number, params: Record<string, string>): Promise<T> {
    return this.fetchJson<T>(`${TIGERWEB}/${layer}/query`, new URLSearchParams(params));
  }

  private async fetchJson<T>(url: string, form?: URLSearchParams): Promise<T> {
    try {
      const res = await this.fetchFn(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json' },
        ...(form && { method: 'POST', body: form }),
      });
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

  /**
   * A ZIP code reaches into the first district of each kind in the state, and one ending in 5 into the second
   * congressional district too, as a ZIP code across a line does; `00000` has no area.
   */
  async area(postalCode: string, state: string): Promise<District[] | null> {
    if (postalCode.startsWith('00000') || fipsOf(state) === undefined) return null;
    const lists = await Promise.all(LISTED_DISTRICT_KINDS.map((kind) => this.list(kind, state)));
    return lists.flatMap((list) => (list[0]?.kind === 'congressional' && postalCode[4] === '5' ? list : list.slice(0, 1)));
  }

  /** `00000` is nowhere; a ZIP code starting with 9 is in California, with 1 in New York, and any other in Texas. */
  async stateOfZip(postalCode: string): Promise<string | null> {
    if (!/^[0-9]{5}/.test(postalCode) || postalCode.startsWith('00000')) return null;
    return postalCode.startsWith('9') ? 'CA' : postalCode.startsWith('1') ? 'NY' : 'TX';
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
