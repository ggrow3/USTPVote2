import { describe, expect, it } from 'vitest';
import { brightAccent, contrast, DARK_CARD, DEFAULT_ACCENT, isHexColour, luminance } from './accent.js';

describe('contrast', () => {
  it('follows WCAG 2: black on white is 21:1, a colour on itself 1:1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#bd4e00', '#bd4e00')).toBe(1);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('gives the party orange 4.94:1 under white text', () => {
    expect(contrast(DEFAULT_ACCENT, '#ffffff')).toBeCloseTo(4.94, 2);
  });
});

describe('the bright tone', () => {
  it("of the party's #bd4e00 is its site's #ff6900, which reads on the dark card", () => {
    expect(brightAccent(DEFAULT_ACCENT)).toBe('#ff6900');
    expect(contrast('#ff6900', DARK_CARD)).toBeGreaterThan(4.5);
  });

  it('of any accent reads on the dark card at 4.5:1', () => {
    for (const accent of ['#1565c0', '#2e7d32', '#6a1b9a', '#000000', '#b71c1c', '#00695c']) {
      const tone = brightAccent(accent);
      expect(isHexColour(tone)).toBe(true);
      expect(contrast(tone, DARK_CARD)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('colours', () => {
  it('are #rrggbb in lower case', () => {
    expect(isHexColour('#bd4e00')).toBe(true);
    expect(isHexColour('#BD4E00')).toBe(false);
    expect(isHexColour('#bd4')).toBe(false);
    expect(isHexColour('orange')).toBe(false);
  });
});
