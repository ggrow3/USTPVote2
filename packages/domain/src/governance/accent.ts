/**
 * The hub's theme accent (design §10.6) and the colours made from it. System Admins choose one colour; the page fills
 * buttons with it under white text, and in the dark theme writes and glows with a brighter tone of it, so both stay
 * readable whatever colour is chosen (WCAG 1.4.3).
 */

/** The party's burnt orange (transhumanist-party.org), the default accent. */
export const DEFAULT_ACCENT = '#bd4e00';

/** The hub's card colour in the dark theme, which text in the bright tone must read on. */
export const DARK_CARD = '#212121';

/** WCAG's minimum contrast for body text. */
export const TEXT_CONTRAST = 4.5;

const HEX = /^#[0-9a-f]{6}$/;

/** `#rrggbb` in lower case, the only form an accent is stored in. */
export function isHexColour(value: string): boolean {
  return HEX.test(value);
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2 relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return `#${[0, 8, 4].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The accent's bright tone, for hover glow and for text in the dark theme: the same hue and saturation at 50% lightness
 * or more, raised until it reads on the dark card at 4.5:1. The party's #bd4e00 gives its site's #ff6900.
 */
export function brightAccent(accent: string): string {
  const [h, s, l] = toHsl(accent);
  for (let lightness = Math.max(l, 0.5); lightness < 1; lightness += 0.01) {
    const tone = fromHsl(h, s, lightness);
    if (contrast(tone, DARK_CARD) >= TEXT_CONTRAST) return tone;
  }
  return '#ffffff';
}
