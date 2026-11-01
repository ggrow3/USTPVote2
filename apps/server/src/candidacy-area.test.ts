import { describe, expect, it } from 'vitest';
import { CensusDistrictSource, LocalDistrictSource } from './candidacies/district-source.js';
import { pointsInside } from './candidacies/zip-points.js';

/** A square of `size` degrees with its south-west corner at (x, y), as a GeoJSON ring. */
const square = (x: number, y: number, size: number) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];

describe('points inside a ZIP code’s area', () => {
  it('keeps the lattice points inside, away from the outline', () => {
    const all = pointsInside({ type: 'Polygon', coordinates: [square(0, 0, 1)] }, 10, 0);
    expect(all).toHaveLength(100);
    const away = pointsInside({ type: 'Polygon', coordinates: [square(0, 0, 1)] }, 10, 0.12);
    expect(away).toHaveLength(64);
    expect(away.every(([x, y]) => x > 0.12 && x < 0.88 && y > 0.12 && y < 0.88)).toBe(true);
  });

  it('leaves out holes, and samples every part of a multipolygon', () => {
    const holed = pointsInside({ type: 'Polygon', coordinates: [square(0, 0, 1), square(0.25, 0.25, 0.5)] }, 10, 0);
    expect(holed).toHaveLength(100 - 25);
    expect(holed.some(([x, y]) => x > 0.3 && x < 0.7 && y > 0.3 && y < 0.7)).toBe(false);
    const parts = pointsInside({ type: 'MultiPolygon', coordinates: [[square(0, 0, 1)], [square(3, 0, 1)]] }, 8, 0);
    expect(parts.some(([x]) => x < 1)).toBe(true);
    expect(parts.some(([x]) => x > 3)).toBe(true);
  });
});

const TIGERWEB = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer';

/** TIGERweb with one ZIP Code Tabulation Area, 94612, over California's 12th and 13th congressional districts. */
function fakeTigerweb(seen: { url: string; form: URLSearchParams | null }[]): typeof globalThis.fetch {
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const features = (rows: Record<string, unknown>[]) => json({ features: rows.map((attributes) => ({ attributes })) });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const form = init?.body instanceof URLSearchParams ? init.body : null;
    seen.push({ url, form });
    const layer = Number(url.slice(TIGERWEB.length + 1).split(/[/?]/)[0]);
    if (url.endsWith('?f=json')) return json({ name: `Layer ${layer}` });
    if (layer === 2) {
      if (form?.get('where') !== "GEOID='94612'") return features([]);
      if (form.get('returnGeometry') === 'false') return features([{ GEOID: '94612', INTPTLAT: '+37.80', INTPTLON: '-122.27', AREALAND: 5_000_000, AREAWATER: 0 }]);
      return json({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [square(-122.3, 37.78, 0.04)] }, properties: {} }] });
    }
    if (!form) {
      // A state's list, as the declaration form reads it.
      if (layer === 54) return features([{ GEOID: '0612', NAME: 'Congressional District 12' }, { GEOID: '0613', NAME: 'Congressional District 13' }, { GEOID: '0614', NAME: 'Congressional District 14' }]);
      return features([{ GEOID: layer === 28 ? '0653000' : '06001', NAME: layer === 28 ? 'Oakland city' : 'Alameda' }]);
    }
    // Which districts hold the sampled points: the 12th and 13th, plus one GEOID the state's list leaves out.
    if (layer === 54) return features([{ GEOID: '0612' }, { GEOID: '0613' }, { GEOID: '06ZZ' }]);
    return features(layer === 28 ? [{ GEOID: '0653000' }] : [{ GEOID: '06001' }]);
  }) as typeof globalThis.fetch;
}

describe('the Census’s area for a ZIP code', () => {
  it('finds the districts of each kind holding points well inside it, as the state’s lists name them', async () => {
    const seen: { url: string; form: URLSearchParams | null }[] = [];
    const source = new CensusDistrictSource(fakeTigerweb(seen));
    const area = await source.area('94612-1234', 'CA');
    expect(area?.map((d) => [d.kind, d.geoid, d.name])).toEqual([
      ['congressional', '0612', 'Congressional District 12'],
      ['congressional', '0613', 'Congressional District 13'],
      ['state_upper', '06001', 'Alameda'],
      ['state_lower', '06001', 'Alameda'],
      ['county', '06001', 'Alameda'],
      ['place', '0653000', 'Oakland city'],
    ]);
    // Only the five digits leave the api, never in a URL; each district query sends the sampled points, in the state.
    expect(seen.some((r) => r.url.includes('94612'))).toBe(false);
    expect(seen.flatMap((r) => [...(r.form?.values() ?? [])]).some((v) => v.includes('1234'))).toBe(false);
    const cd = seen.find((r) => r.url === `${TIGERWEB}/54/query` && r.form)!.form!;
    expect(cd.get('where')).toBe("STATE='06'");
    expect(cd.get('geometryType')).toBe('esriGeometryMultipoint');
    const points = (JSON.parse(cd.get('geometry')!) as { points: [number, number][] }).points;
    expect(points[0]).toEqual([-122.27, 37.8]);
    expect(points.length).toBeGreaterThan(100);
    expect(points.every(([x, y]) => x > -122.3 && x < -122.26 && y > 37.78 && y < 37.82)).toBe(true);
    // Kept a day: asking again sends nothing.
    const asked = seen.length;
    await source.area('94612', 'CA');
    expect(seen).toHaveLength(asked);
  });

  it('has no area for a ZIP code the Census does not draw, or one that is not five digits', async () => {
    const source = new CensusDistrictSource(fakeTigerweb([]));
    expect(await source.area('99999', 'CA')).toBeNull();
    expect(await source.area('9461', 'CA')).toBeNull();
    expect(await source.area('94612', 'XX')).toBeNull();
  });

  it('says the Census is not answering', async () => {
    const source = new CensusDistrictSource((async () => new Response('busy', { status: 503 })) as typeof globalThis.fetch);
    await expect(source.area('94612', 'CA')).rejects.toMatchObject({ status: 503 });
  });

  it('the local stand-in: the first district of each kind, both congressional ones for a ZIP code ending in 5', async () => {
    const source = new LocalDistrictSource();
    expect((await source.area('94612', 'CA'))?.map((d) => d.geoid)).toEqual(['0601', '06001', '06001', '06001', '0600100']);
    expect((await source.area('94615', 'CA'))?.filter((d) => d.kind === 'congressional').map((d) => d.geoid)).toEqual(['0601', '0602']);
    expect(await source.area('00000', 'CA')).toBeNull();
  });
});
