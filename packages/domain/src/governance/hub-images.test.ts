import { describe, expect, it } from 'vitest';
import { contrast, TEXT_CONTRAST } from './accent.js';
import {
  BACKDROP_SCRIMS,
  HUB_IMAGE_SIZES,
  hubImageProblem,
  isHubImageId,
  scrimContrast,
  scrimCss,
  underScrim,
} from './hub-images.js';

describe('image IDs', () => {
  it('are a SHA-256 in lower-case hex, never a path or an address', () => {
    expect(isHubImageId('0123456789abcdef'.repeat(4))).toBe(true);
    expect(isHubImageId('0123456789ABCDEF'.repeat(4))).toBe(false);
    expect(isHubImageId('a'.repeat(63))).toBe(false);
    expect(isHubImageId('../hub_logos/x')).toBe(false);
    expect(isHubImageId('https://example.org/banner.webp')).toBe(false);
  });
});

describe('the sizes taken', () => {
  it('keep the cover banner at twice the hub column, 3:1, and the background at most 2560px wide', () => {
    expect(HUB_IMAGE_SIZES.cover).toMatchObject({ width: 1120, height: 374, ratio: 3, recommended: '1500×500' });
    expect(HUB_IMAGE_SIZES.background).toMatchObject({ minWidth: 1920, minHeight: 1080, width: 2560 });
  });

  it('take a logo at least 64 pixels each way, of any shape', () => {
    expect(hubImageProblem('logo', 64, 64)).toBeNull();
    expect(hubImageProblem('logo', 400, 100)).toBeNull();
    expect(hubImageProblem('logo', 63, 200)).toBe('the logo must be at least 64×64 pixels');
  });

  it('take a cover banner of 3:1, give or take 5%, from 1120×374', () => {
    expect(hubImageProblem('cover', 1500, 500)).toBeNull();
    expect(hubImageProblem('cover', 1120, 374)).toBeNull();
    expect(hubImageProblem('cover', 3000, 1000)).toBeNull();
    expect(hubImageProblem('cover', 1500, 520)).toBeNull(); // 2.88:1
    expect(hubImageProblem('cover', 1584, 396)).toBe(
      'the cover banner must be 3:1 and at least 1120×374 pixels, such as 1500×500; this one is 1584×396',
    );
    expect(hubImageProblem('cover', 1920, 1080)).toMatch(/must be 3:1/);
    expect(hubImageProblem('cover', 900, 300)).toMatch(/this one is 900×300$/);
    expect(hubImageProblem('cover', 0, 0)).not.toBeNull();
  });

  it('take a background photo of at least 1920×1080', () => {
    expect(hubImageProblem('background', 1920, 1080)).toBeNull();
    expect(hubImageProblem('background', 4032, 3024)).toBeNull();
    expect(hubImageProblem('background', 1280, 720)).toBe(
      'the background photo must be at least 1920×1080 pixels, such as 2560×1440; this one is 1280×720',
    );
    expect(hubImageProblem('background', 1080, 1920)).not.toBeNull();
  });
});

describe('the scrim over a background photo', () => {
  it("keeps the theme's text at 4.5:1 over any photo, in both themes", () => {
    for (const scrim of Object.values(BACKDROP_SCRIMS)) {
      expect(scrimContrast(scrim)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
      for (const pixel of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#808080', '#bd4e00']) {
        expect(contrast(scrim.text, underScrim(scrim, pixel))).toBeGreaterThanOrEqual(TEXT_CONTRAST);
      }
    }
    expect(scrimContrast(BACKDROP_SCRIMS.light)).toBeCloseTo(5.2, 1);
    expect(scrimContrast(BACKDROP_SCRIMS.dark)).toBeCloseTo(5.2, 1);
  });

  it('would not be enough any lighter', () => {
    expect(scrimContrast({ ...BACKDROP_SCRIMS.light, opacity: 0.45 })).toBeLessThan(TEXT_CONTRAST);
    expect(scrimContrast({ ...BACKDROP_SCRIMS.dark, opacity: 0.5 })).toBeLessThan(TEXT_CONTRAST);
  });

  it('blends as browsers do and is written as a CSS colour', () => {
    expect(underScrim(BACKDROP_SCRIMS.light, '#000000')).toBe('#8c8c8c');
    expect(scrimCss(BACKDROP_SCRIMS.light)).toBe('rgb(255 255 255 / 0.55)');
    expect(scrimCss(BACKDROP_SCRIMS.dark)).toBe('rgb(12 10 14 / 0.6)');
  });
});
