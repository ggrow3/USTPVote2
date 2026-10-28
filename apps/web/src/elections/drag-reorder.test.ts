import { describe, expect, it } from 'vitest';
import { dropIndex, shiftFor } from './drag-reorder.js';

// Four items 100px tall, middles at 50, 150, 250, 350.
const middles = [50, 150, 250, 350];

describe('dropping a dragged item', () => {
  it('lands one place for each other item whose middle it has passed', () => {
    expect(dropIndex(middles, 1, 150)).toBe(1);
    expect(dropIndex(middles, 1, 40)).toBe(0);
    expect(dropIndex(middles, 1, 260)).toBe(2);
    expect(dropIndex(middles, 0, 999)).toBe(3);
    expect(dropIndex(middles, 3, -50)).toBe(0);
  });

  it('moves the items in between to make room', () => {
    // Item 0 held over place 2: items 1 and 2 move up by its size.
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 0, 2, 100))).toEqual([0, -100, -100, 0]);
    // Item 3 held over place 1: items 1 and 2 move down.
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 3, 1, 100))).toEqual([0, 100, 100, 0]);
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 2, 2, 100))).toEqual([0, 0, 0, 0]);
  });
});
