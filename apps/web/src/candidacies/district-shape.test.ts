import { describe, expect, it } from 'vitest';
import type { DistrictBoundary } from 'ustp-domain';
import { districtShape } from './district-shape.js';

const boundary = (...geometries: DistrictBoundary['features'][number]['geometry'][]): DistrictBoundary => ({
  type: 'FeatureCollection',
  features: geometries.map((geometry) => ({ type: 'Feature', geometry, properties: {} })),
});

const numbers = (text: string) => text.match(/-?[\d.]+/g)!.map(Number);

describe('a district’s outline, drawn small', () => {
  it('draws every ring with north up, narrowing longitude by the latitude, with room around it', () => {
    // A square degree at 60°N is half as wide as it is tall.
    const shape = districtShape(
      boundary({
        type: 'Polygon',
        coordinates: [
          [
            [10, 59.5],
            [11, 59.5],
            [11, 60.5],
            [10, 60.5],
            [10, 59.5],
          ],
        ],
      }),
    )!;
    const [x, y, width, height] = numbers(shape.viewBox);
    expect([width, height]).toEqual([0.62, 1.12]); // 0.5 wide and 1 tall, with 0.06 on each side
    expect(x).toBeCloseTo(5 - 0.06, 3);
    expect(y).toBeCloseTo(-60.5 - 0.06, 3);
    expect(shape.path.startsWith('M5 -59.5L5.5 -59.5L5.5 -60.5')).toBe(true);
    expect(shape.path.endsWith('Z')).toBe(true);
  });

  it('keeps holes and every polygon of a district, and draws across the 180th meridian as one piece', () => {
    const square = (lng: number, lat: number, size: number) => [
      [lng, lat],
      [lng + size, lat],
      [lng + size, lat + size],
      [lng, lat + size],
      [lng, lat],
    ];
    const islands = districtShape(
      boundary(
        { type: 'Polygon', coordinates: [square(0, 0, 4), square(1, 1, 1)] },
        { type: 'MultiPolygon', coordinates: [[square(6, 0, 1)], [square(8, 0, 1)]] },
      ),
    )!;
    expect(islands.path.match(/M/g)).toHaveLength(4);
    // Alaska: from 179°E across to 169°W is 12 degrees, not 348.
    const alaska = districtShape(boundary({ type: 'MultiPolygon', coordinates: [[square(179, 52, 0.5)], [square(-170, 52, 1)]] }))!;
    const [x, , width] = numbers(alaska.viewBox);
    expect(width! / Math.cos((52.5 * Math.PI) / 180)).toBeLessThan(14);
    expect(x! / Math.cos((52.5 * Math.PI) / 180)).toBeLessThan(-181);
  });

  it('draws nothing for a boundary with no polygon', () => {
    expect(districtShape(boundary())).toBeNull();
  });
});
