import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import opentype, { type Font, type Path } from 'opentype.js';
import sharp from 'sharp';
import { CARD_SIZE, type CardBar, type LinkCard } from 'ustp-domain';

/**
 * A page's card image for link previews (design §15, "Link previews"): 1200 × 630, the brand orange with the site's
 * mark and name, what the page is, its title, and a few lines or bars under it.
 *
 * Text is drawn as outlines from the site's own typeface (Lato, SIL Open Font License, from `@fontsource/lato`) with
 * opentype.js, then the SVG is rendered by sharp. So the image looks the same wherever the api runs, and needs no fonts
 * installed in the server image; and no text from a page ever reaches the SVG as text, only as shapes, so nothing a
 * Course or Communications Admin types can become markup. A character neither face has (an emoji, say) is left out.
 */

/** Where the site is, for the card's header and footer. */
export interface CardSite {
  /** The site's name (`og:site_name`), beside the mark. */
  readonly name: string;
  /** The party's name, in the footer. */
  readonly party: string;
  /** The site's host ("vote.example.org"), in the footer. */
  readonly host: string;
}

const W = CARD_SIZE.width;
const H = CARD_SIZE.height;
const MARGIN = 72;
const TEXT_WIDTH = W - 2 * MARGIN;
const ORANGE = '#bd4e00';
const FOOTER = '#8f3b00';
const WHITE = '#ffffff';
const FOOTER_TOP = H - 76;
/** The space between the kicker and the footer that the title and what follows it must fit in. */
const BODY_TOP = 196;
/** A bar's row: its label and value, then the bar. */
const ROW = 62;
const BODY_BOTTOM = FOOTER_TOP - 24;

interface Faces {
  /** Each weight's faces, Latin first, then Latin Extended, in the order a character is looked for. */
  readonly regular: readonly Font[];
  readonly bold: readonly Font[];
}

let faces: Faces | null = null;

function loadFaces(): Faces {
  if (faces) return faces;
  const require = createRequire(import.meta.url);
  const load = (file: string): Font => {
    const bytes = readFileSync(require.resolve(`@fontsource/lato/files/${file}`));
    return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  };
  faces = {
    regular: [load('lato-latin-400-normal.woff'), load('lato-latin-ext-400-normal.woff')],
    bold: [load('lato-latin-700-normal.woff'), load('lato-latin-ext-700-normal.woff')],
  };
  return faces;
}

interface Run {
  readonly font: Font;
  readonly text: string;
}

/** The text in runs of the first face that has each character; characters none has are dropped. */
function runs(text: string, fonts: readonly Font[]): Run[] {
  const out: { font: Font; text: string }[] = [];
  for (const char of text) {
    const font = /\s/.test(char) ? fonts[0]! : fonts.find((f) => f.charToGlyphIndex(char) > 0);
    if (!font) continue;
    const last = out.at(-1);
    if (last?.font === font) last.text += /\s/.test(char) ? ' ' : char;
    else out.push({ font, text: /\s/.test(char) ? ' ' : char });
  }
  return out;
}

/** Kerning is left off: opentype.js 2.0 misplaces some glyphs after certain kerned pairs in these faces. */
const SETTING = { kerning: false } as const;

const num = (n: number) => String(Math.round(n * 10) / 10);

/**
 * SVG path data from opentype.js's commands. Its own `toPathData` (2.0) writes NaN into some paths whose commands are
 * all numbers ("USTP Vote"), which ends the outline there, so the commands are written out here instead.
 */
export function pathData(path: Path): string {
  return path.commands
    .map((c) => {
      switch (c.type) {
        case 'M':
        case 'L':
          return `${c.type}${num(c.x!)} ${num(c.y!)}`;
        case 'Q':
          return `Q${num(c.x1!)} ${num(c.y1!)} ${num(c.x!)} ${num(c.y!)}`;
        case 'C':
          return `C${num(c.x1!)} ${num(c.y1!)} ${num(c.x2!)} ${num(c.y2!)} ${num(c.x!)} ${num(c.y!)}`;
        case 'Z':
          return 'Z';
        default:
          return '';
      }
    })
    .join('');
}

function measure(text: string, fonts: readonly Font[], size: number): number {
  return runs(text, fonts).reduce((width, run) => width + run.font.getAdvanceWidth(run.text, size, SETTING), 0);
}

/** The outline of a line of text with its baseline's left end at (x, y). */
function outline(text: string, fonts: readonly Font[], size: number, x: number, y: number): string {
  let at = x;
  const parts: string[] = [];
  for (const run of runs(text, fonts)) {
    const data = pathData(run.font.getPath(run.text, at, y, size, SETTING));
    // A run that still comes out with a NaN in it is left out rather than cutting short the rest of the outline.
    if (!data.includes('NaN')) parts.push(data);
    at += run.font.getAdvanceWidth(run.text, size, SETTING);
  }
  return parts.join('');
}

/** `line` cut with an ellipsis until it fits `width`. */
function ellipsize(line: string, fonts: readonly Font[], size: number, width: number): string {
  if (measure(line, fonts, size) <= width) return line;
  const chars = [...line];
  while (chars.length && measure(`${chars.join('').trimEnd()}…`, fonts, size) > width) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

/**
 * The text wrapped at spaces into lines no wider than `width`, a word too long for a line broken where it must; past
 * `maxLines` the last line ends with an ellipsis.
 */
export function wrapText(text: string, fonts: readonly Font[], size: number, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  const push = () => {
    if (line) lines.push(line);
    line = '';
  };
  for (const word of words) {
    const tried = line ? `${line} ${word}` : word;
    if (measure(tried, fonts, size) <= width) {
      line = tried;
      continue;
    }
    push();
    if (measure(word, fonts, size) <= width) {
      line = word;
      continue;
    }
    let piece = '';
    for (const char of word) {
      if (piece && measure(piece + char, fonts, size) > width) {
        lines.push(piece);
        piece = '';
      }
      piece += char;
    }
    line = piece;
  }
  push();
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(`${kept[maxLines - 1]!} ${lines[maxLines]!}`, fonts, size, width);
  return kept;
}

/** The title's size and lines: the largest size at which it fits `maxLines`, else the smallest, cut short. */
function titleLayout(title: string, fonts: readonly Font[], maxLines: number): { size: number; lines: string[] } {
  for (const size of [68, 60, 52]) {
    const lines = wrapText(title, fonts, size, TEXT_WIDTH, Number.POSITIVE_INFINITY);
    if (lines.length <= maxLines) return { size, lines };
  }
  return { size: 52, lines: wrapText(title, fonts, 52, TEXT_WIDTH, maxLines) };
}

const fmt = (n: number) => Math.round(n * 10) / 10;

/** The site's mark, the ticked box of its icon (`icons/icon.svg`) without the tile, `size` pixels square at (x, y). */
function mark(x: number, y: number, size: number): string {
  // The icon's box is 240 units square with a 32-unit stroke, at 136 in a 512-unit tile: 272 units from edge to edge.
  const scale = size / 272;
  return (
    `<g transform="translate(${fmt(x - 120 * scale)} ${fmt(y - 120 * scale)}) scale(${scale.toFixed(4)})">` +
    `<rect x="136" y="136" width="240" height="240" rx="40" fill="none" stroke="${WHITE}" stroke-width="32"/>` +
    `<path d="M190,258 L240,308 L326,206" fill="none" stroke="${WHITE}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>` +
    '</g>'
  );
}

function barRows(bars: readonly CardBar[], top: number, f: Faces): { svg: string; height: number } {
  const rowHeight = ROW;
  const parts: string[] = [];
  bars.forEach((bar, i) => {
    const y = top + i * rowHeight;
    const valueWidth = measure(bar.value, f.bold, 28);
    parts.push(`<path d="${outline(ellipsize(bar.label, f.bold, 28, TEXT_WIDTH - valueWidth - 24), f.bold, 28, MARGIN, y + 28)}" fill="${WHITE}"/>`);
    parts.push(`<path d="${outline(bar.value, f.bold, 28, W - MARGIN - valueWidth, y + 28)}" fill="${WHITE}"/>`);
    parts.push(`<rect x="${MARGIN}" y="${y + 40}" width="${TEXT_WIDTH}" height="14" rx="7" fill="${WHITE}" fill-opacity="0.25"/>`);
    const filled = Math.round(TEXT_WIDTH * bar.share);
    if (filled > 0) {
      parts.push(
        `<rect x="${MARGIN}" y="${y + 40}" width="${Math.max(filled, 14)}" height="14" rx="7" fill="${WHITE}" fill-opacity="${bar.highlight ? 1 : 0.6}"/>`,
      );
    }
  });
  return { svg: parts.join(''), height: bars.length * rowHeight };
}

/** The card as SVG, every letter an outline. */
export function cardSvg(card: LinkCard, site: CardSite): string {
  const f = loadFaces();
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="${ORANGE}"/>`, `<rect y="${FOOTER_TOP}" width="${W}" height="${H - FOOTER_TOP}" fill="${FOOTER}"/>`];

  // Header: the mark and the site's name.
  parts.push(mark(MARGIN, 58, 60));
  parts.push(`<path d="${outline(ellipsize(site.name, f.bold, 34, TEXT_WIDTH - 84), f.bold, 34, MARGIN + 84, 100)}" fill="${WHITE}"/>`);

  // What the page is.
  const kicker = ellipsize(card.kicker.toLocaleUpperCase('en-US'), f.bold, 26, TEXT_WIDTH);
  parts.push(`<path d="${outline(kicker, f.bold, 26, MARGIN, 172)}" fill="${WHITE}" fill-opacity="0.85"/>`);

  // The title, then lines or bars, as much as fits above the footer.
  const bars = card.bars?.length ? card.bars : null;
  const lines = bars ? [] : (card.lines ?? []).filter((line) => line.trim());
  const below = bars ? bars.length * ROW + 8 : lines.length ? 16 + lines.length * 40 : 0;
  const room = BODY_BOTTOM - BODY_TOP - below;
  const maxTitleLines = Math.max(1, Math.min(3, Math.floor(room / (52 * 1.15))));
  const title = titleLayout(card.title, f.bold, maxTitleLines);
  const leading = Math.round(title.size * 1.15);
  const firstBaseline = BODY_TOP + title.size * 0.8;
  title.lines.forEach((line, i) => {
    parts.push(`<path d="${outline(line, f.bold, title.size, MARGIN, firstBaseline + i * leading)}" fill="${WHITE}"/>`);
  });
  /** Just under the title's last line. */
  const titleBottom = firstBaseline + (title.lines.length - 1) * leading + title.size * 0.25;
  if (bars) {
    const top = titleBottom + 24;
    parts.push(barRows(bars.slice(0, Math.max(0, Math.floor((BODY_BOTTOM - top + 14) / ROW))), top, f).svg);
  } else {
    let baseline = titleBottom + 24 + 24;
    for (const line of lines) {
      if (baseline > BODY_BOTTOM + 8) break;
      parts.push(`<path d="${outline(ellipsize(line, f.regular, 30, TEXT_WIDTH), f.regular, 30, MARGIN, baseline)}" fill="${WHITE}" fill-opacity="0.92"/>`);
      baseline += 40;
    }
  }

  // Footer: the party, and where the site is.
  const hostWidth = measure(site.host, f.regular, 26);
  parts.push(`<path d="${outline(ellipsize(site.party, f.bold, 26, TEXT_WIDTH - hostWidth - 32), f.bold, 26, MARGIN, H - 29)}" fill="${WHITE}"/>`);
  parts.push(`<path d="${outline(site.host, f.regular, 26, W - MARGIN - hostWidth, H - 29)}" fill="${WHITE}" fill-opacity="0.85"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

/** The card as a PNG. */
export async function renderCard(card: LinkCard, site: CardSite): Promise<Buffer> {
  return sharp(Buffer.from(cardSvg(card, site))).png({ compressionLevel: 9 }).toBuffer();
}
