import { describe, expect, it } from 'vitest';
import { linksInRow } from './menu-fit.js';

/** Register, Ballot, Verify, Offices and Admin at 14px (Arial), with the phone padding, and the More button. */
const LINKS = [92.1, 73.1, 69.9, 80.6, 63.9];
const MORE = 60.4;

describe('menu bar links in one row', () => {
  it('keeps every link when they all fit, with no More button', () => {
    expect(linksInRow(LINKS, MORE, 1200)).toBe(5);
    // Exactly the five links' width: More is not needed, so its width does not count.
    expect(linksInRow(LINKS, MORE, 379.6)).toBe(5);
  });

  it('moves the links that do not fit behind More, in menu order', () => {
    // 320 px less the bar's 8 px each side: Register, Ballot and Verify, then More.
    expect(linksInRow(LINKS, MORE, 304)).toBe(3);
    // 375 px: four links and More.
    expect(linksInRow(LINKS, MORE, 359)).toBe(3);
    expect(linksInRow(LINKS, MORE, 376.1)).toBe(4);
  });

  it('keeps only More when text is enlarged so far that no link fits beside it', () => {
    expect(linksInRow(LINKS.map((w) => w * 4), MORE * 4, 304)).toBe(0);
  });

  it('ignores sub-pixel rounding', () => {
    expect(linksInRow([100, 100], MORE, 199.6)).toBe(2);
    expect(linksInRow([100, 100], 50, 198)).toBe(1);
  });

  it('has nothing to place with no links', () => {
    expect(linksInRow([], MORE, 304)).toBe(0);
  });
});
