import { contrast } from './accent.js';

/**
 * The images System Admins upload under Admin › Link hub (design §10.6): the hub's logo and cover banner, and the photo
 * behind every other page. The API decodes each one and re-encodes it as WebP, which drops its metadata, and keeps it
 * under the SHA-256 of the stored bytes. An image shows only once the hub is saved with its ID.
 */
export const HUB_IMAGE_KINDS = ['logo', 'cover', 'background'] as const;
export type HubImageKind = (typeof HUB_IMAGE_KINDS)[number];

/** Each image's name in messages. */
export const HUB_IMAGE_NAMES: Readonly<Record<HubImageKind, string>> = {
  logo: 'logo',
  cover: 'cover banner',
  background: 'background photo',
};

export interface HubImageSize {
  /** The smallest upload taken, in pixels. */
  readonly minWidth: number;
  readonly minHeight: number;
  /** The width : height an upload must have (within `RATIO_TOLERANCE`), or null for any shape. */
  readonly ratio: number | null;
  /** As stored: the cover is cropped to exactly this size; the others are shrunk to fit inside it, never enlarged. */
  readonly width: number;
  readonly height: number;
  /** The size to upload, written next to the upload button. */
  readonly recommended: string;
}

/**
 * The logo is kept as a 256px square (the hub's tile is 104px). The cover banner is 3:1 across the hub's 560px column,
 * kept at twice that width for sharp screens. The background covers the whole window, so it needs a full-HD photo at
 * least, and is kept at 2560px wide at most.
 */
export const HUB_IMAGE_SIZES: Readonly<Record<HubImageKind, HubImageSize>> = {
  logo: { minWidth: 64, minHeight: 64, ratio: null, width: 256, height: 256, recommended: '512×512' },
  cover: { minWidth: 1120, minHeight: 374, ratio: 3, width: 1120, height: 374, recommended: '1500×500' },
  background: { minWidth: 1920, minHeight: 1080, ratio: null, width: 2560, height: 2560, recommended: '2560×1440' },
};

/** How far an upload's shape may be from the one asked for (5%); the difference is cropped from the middle. */
export const RATIO_TOLERANCE = 0.05;

/** An uploaded image's ID: the SHA-256 of its stored bytes, in hex. */
const IMAGE_ID = /^[0-9a-f]{64}$/;

export function isHubImageId(id: string): boolean {
  return IMAGE_ID.test(id);
}

/** Why an upload of this size cannot be used as this image, if it cannot. */
export function hubImageProblem(kind: HubImageKind, width: number, height: number): string | null {
  const size = HUB_IMAGE_SIZES[kind];
  const shaped = size.ratio === null || (height > 0 && Math.abs(width / height / size.ratio - 1) <= RATIO_TOLERANCE);
  if (shaped && width >= size.minWidth && height >= size.minHeight) return null;
  const least = `${size.minWidth}×${size.minHeight}`;
  switch (kind) {
    case 'logo':
      return `the logo must be at least ${least} pixels`;
    case 'cover':
      return `the cover banner must be ${size.ratio}:1 and at least ${least} pixels, such as ${size.recommended}; this one is ${width}×${height}`;
    case 'background':
      return `the background photo must be at least ${least} pixels, such as ${size.recommended}; this one is ${width}×${height}`;
  }
}

// --- The scrim over a background photo -------------------------------------------------------------------------------

export interface Scrim {
  /** Laid over the whole photo at `opacity`. */
  readonly colour: string;
  readonly opacity: number;
  /** The theme's text colour, which must keep 4.5:1 over any photo under the scrim. */
  readonly text: string;
}

/**
 * The veil over a background photo in each theme: white in the light theme, the dark ground in the dark one. Strong
 * enough that the theme's text keeps 4.5:1 over any pixel of any photo (WCAG 1.4.3, `scrimContrast`), so the page's
 * card, its shadow and anything set straight on the picture stay readable, whatever photo is chosen. The text colours
 * are the ones `.ustp-scrim` uses.
 */
export const BACKDROP_SCRIMS: Readonly<Record<'light' | 'dark', Scrim>> = {
  light: { colour: '#ffffff', opacity: 0.55, text: '#1a1a1a' },
  dark: { colour: '#0c0a0e', opacity: 0.6, text: '#ffffff' },
};

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (values: number[]) => `#${values.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** The colour seen where the scrim lies over a pixel of `under`, blended as browsers do (in sRGB). */
export function underScrim(scrim: Scrim, under: string): string {
  const top = channels(scrim.colour);
  return hex(channels(under).map((c, i) => scrim.opacity * top[i]! + (1 - scrim.opacity) * c));
}

/**
 * The least contrast the theme's text has over the photo once veiled. Each blended channel rises with the photo's, so
 * the extremes are over pure black and pure white, and the scrim keeps every blend on one side of the text colour.
 */
export function scrimContrast(scrim: Scrim): number {
  return Math.min(contrast(scrim.text, underScrim(scrim, '#000000')), contrast(scrim.text, underScrim(scrim, '#ffffff')));
}

/** The scrim as a CSS colour. */
export function scrimCss(scrim: Scrim): string {
  return `rgb(${channels(scrim.colour).join(' ')} / ${scrim.opacity})`;
}
