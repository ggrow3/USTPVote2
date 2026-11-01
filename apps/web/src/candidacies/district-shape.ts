import type { DistrictBoundary } from 'ustp-domain';

/**
 * A district's outline drawn small, beside each office on the Candidates and Your area pages (design §5.8): the
 * Census boundary the map draws, as one SVG path, with no map service. Longitude is narrowed by the cosine of the
 * district's middle latitude, so a district keeps its shape; north is up.
 */
export interface DistrictShape {
  /** The SVG `viewBox`: the district with a little room around it. */
  readonly viewBox: string;
  /** Every ring of every polygon, holes too (drawn with `fill-rule: evenodd`). */
  readonly path: string;
}

type Position = readonly [number, number];

/** The rings of a boundary's polygons, as `[longitude, latitude]`. */
function ringsOf(boundary: DistrictBoundary): Position[][] {
  return boundary.features.flatMap((f) => {
    const polygons = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as Position[][][];
    return polygons.flat().filter((ring) => ring.length >= 3);
  });
}

const round = (n: number) => String(Math.round(n * 10_000) / 10_000);

/** The least and greatest of the values (a loop: a long ring is too many arguments to spread). */
function extent(values: readonly number[]): [number, number] {
  let [min, max] = [Infinity, -Infinity];
  for (const v of values) [min, max] = [Math.min(min, v), Math.max(max, v)];
  return [min, max];
}

/** The outline as a path, or null when the boundary has no polygon. */
export function districtShape(boundary: DistrictBoundary): DistrictShape | null {
  let rings = ringsOf(boundary);
  if (!rings.length) return null;
  const [west, east] = extent(rings.flat().map(([lng]) => lng));
  // A district across the 180th meridian (Alaska's Aleutians): its eastern islands are drawn west of it instead.
  if (east - west > 180) rings = rings.map((ring) => ring.map(([lng, lat]): Position => [lng > 0 ? lng - 360 : lng, lat]));
  const [south, north] = extent(rings.flat().map(([, lat]) => lat));
  const scale = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const projected = rings.map((ring) => ring.map(([lng, lat]): Position => [lng * scale, -lat]));
  const [left, right] = extent(projected.flat().map(([x]) => x));
  const [top, bottom] = extent(projected.flat().map(([, y]) => y));
  const [width, height] = [right - left, bottom - top];
  const pad = Math.max(width, height) * 0.06 || 0.01;
  return {
    viewBox: [left - pad, top - pad, width + 2 * pad, height + 2 * pad].map(round).join(' '),
    path: projected.map((ring) => `M${ring.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`).join(''),
  };
}
