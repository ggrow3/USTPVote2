/**
 * Points well inside a ZIP code's area, for asking the Census which districts it reaches into (design §5.8). The
 * outline comes simplified, so a point near it could fall on either side of the true line: only points farther from it
 * than `margin` are kept, and a district that holds one of them truly shares ground with the ZIP code, not just an edge.
 */

/** A GeoJSON polygon or multipolygon, longitude before latitude. */
export interface AreaGeometry {
  readonly type: 'Polygon' | 'MultiPolygon';
  readonly coordinates: unknown;
}

type Ring = readonly (readonly [number, number])[];

function ringsOf(geometry: AreaGeometry): Ring[] {
  if (geometry.type === 'Polygon') return geometry.coordinates as Ring[];
  return (geometry.coordinates as Ring[][]).flat();
}

/** Even-odd ray casting over every ring, so holes and separate parts count as they should. */
function inside(x: number, y: number, rings: readonly Ring[]): boolean {
  let odd = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
  }
  return odd;
}

/** Whether the point is within `margin` of any edge; longitudes are scaled by `kx` so distances are in degrees of latitude. */
function nearOutline(x: number, y: number, rings: readonly Ring[], margin: number, kx: number): boolean {
  const m2 = margin * margin;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const ax = ring[i - 1]![0] * kx;
      const ay = ring[i - 1]![1];
      const dx = ring[i]![0] * kx - ax;
      const dy = ring[i]![1] - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x * kx - ax) * dx + (y - ay) * dy) / len2));
      const ex = x * kx - (ax + t * dx);
      const ey = y - (ay + t * dy);
      if (ex * ex + ey * ey < m2) return true;
    }
  }
  return false;
}

/**
 * The centres of a `grid` × `grid` lattice over the area's bounding box that lie inside it and more than `margin`
 * (degrees of latitude) from its outline, as `[lng, lat]`.
 */
export function pointsInside(geometry: AreaGeometry, grid: number, margin: number): [number, number][] {
  const rings = ringsOf(geometry);
  const all = rings.flat();
  if (!all.length) return [];
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const kx = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const points: [number, number][] = [];
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const x = minX + ((i + 0.5) * (maxX - minX)) / grid;
      const y = minY + ((j + 0.5) * (maxY - minY)) / grid;
      if (inside(x, y, rings) && !nearOutline(x, y, rings, margin, kx)) points.push([x, y]);
    }
  }
  return points;
}
