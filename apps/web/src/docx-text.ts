import JSZip from 'jszip';
import { splitLines } from 'ustp-domain';
import { STAMP_STYLE } from './docx-stamp.js';

/**
 * A Word document's text read back, one line per paragraph (table cells too; line breaks inside a paragraph start new
 * lines), with Word's automatic list numbers and bullets written out, and the stamp block left out. The election
 * export's tests read what it wrote with it; nothing in the app reads Word files.
 */

interface Level {
  readonly start: number;
  readonly format: string;
  readonly text: string;
  /** Legal numbering: every number in the label is decimal ("1.1" under "Article I"). */
  readonly legal: boolean;
}

interface NumberingDefinitions {
  /** numId → abstractNumId */
  readonly nums: Map<string, string>;
  /** abstractNumId → levels by ilvl */
  readonly abstracts: Map<string, Map<number, Level>>;
  /** numId → ilvl → start override */
  readonly overrides: Map<string, Map<number, number>>;
}

export async function readDocxText(data: ArrayBuffer | Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) throw new Error('This is not a Word document (.docx): it has no word/document.xml.');
  const numbering = parseNumbering((await zip.file('word/numbering.xml')?.async('string')) ?? '');
  const styleNumbering = parseStyleNumbering((await zip.file('word/styles.xml')?.async('string')) ?? '');

  const counters = new Map<string, number[]>();
  const lines: string[] = [];
  for (const p of paragraphs(documentXml)) {
    const style = attr(firstTag(p, 'w:pStyle'), 'w:val');
    if (style === STAMP_STYLE) continue;
    const numPr = firstElement(p, 'w:numPr');
    const numId = attr(firstTag(numPr, 'w:numId'), 'w:val') ?? (style ? styleNumbering.get(style)?.numId : undefined);
    const ilvl = Number(attr(firstTag(numPr, 'w:ilvl'), 'w:val') ?? (style ? styleNumbering.get(style)?.ilvl : undefined) ?? 0);
    const label = numId && numId !== '0' ? listLabel(numbering, counters, numId, ilvl) : '';
    const text = paragraphText(p);
    const joined = label ? `${label} ${text}` : text;
    lines.push(...splitLines(joined).map((l) => l.replace(/ /g, ' ').trimEnd()));
  }
  while (lines.length > 0 && lines.at(-1) === '') lines.pop();
  while (lines.length > 0 && lines[0] === '') lines.shift();
  return lines.join('\n');
}

/** Each `<w:p>` element's XML, in document order (tables included; nested paragraphs in text boxes stay inside theirs). */
function paragraphs(xml: string): string[] {
  const out: string[] = [];
  const re = /<w:p\b[^>]*?(\/?)>|<\/w:p>/g;
  let depth = 0;
  let start = 0;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[0] === '</w:p>') {
      depth--;
      if (depth === 0) out.push(xml.slice(start, m.index + m[0].length));
    } else if (m[1] === '/') {
      if (depth === 0) out.push(m[0]);
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return out;
}

/** Visible text of a paragraph: `w:t` runs (tracked insertions included, deletions not), tabs and breaks. */
function paragraphText(p: string): string {
  let text = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)\b[^>]*\/>/g;
  for (let m = re.exec(p); m; m = re.exec(p)) {
    if (m[1] !== undefined) text += decodeXml(m[1]);
    else text += m[0].startsWith('<w:tab') ? '\t' : '\n';
  }
  return text;
}

function parseNumbering(xml: string): NumberingDefinitions {
  const abstracts = new Map<string, Map<number, Level>>();
  for (const a of elements(xml, 'w:abstractNum')) {
    const levels = new Map<number, Level>();
    for (const lvl of elements(a, 'w:lvl')) {
      levels.set(Number(attr(lvl, 'w:ilvl') ?? 0), {
        start: Number(attr(firstTag(lvl, 'w:start'), 'w:val') ?? 1),
        format: attr(firstTag(lvl, 'w:numFmt'), 'w:val') ?? 'decimal',
        text: decodeXml(attr(firstTag(lvl, 'w:lvlText'), 'w:val') ?? ''),
        legal: firstTag(lvl, 'w:isLgl') !== undefined && attr(firstTag(lvl, 'w:isLgl'), 'w:val') !== '0',
      });
    }
    abstracts.set(attr(a, 'w:abstractNumId') ?? '', levels);
  }
  const nums = new Map<string, string>();
  const overrides = new Map<string, Map<number, number>>();
  for (const n of elements(xml, 'w:num')) {
    const numId = attr(n, 'w:numId') ?? '';
    nums.set(numId, attr(firstTag(n, 'w:abstractNumId'), 'w:val') ?? '');
    const starts = new Map<number, number>();
    for (const o of elements(n, 'w:lvlOverride')) {
      const start = attr(firstTag(o, 'w:startOverride'), 'w:val');
      if (start !== undefined) starts.set(Number(attr(o, 'w:ilvl') ?? 0), Number(start));
    }
    overrides.set(numId, starts);
  }
  return { nums, abstracts, overrides };
}

/** Paragraph styles that carry numbering themselves (e.g. "Article" headings). */
function parseStyleNumbering(xml: string): Map<string, { numId: string; ilvl: number }> {
  const out = new Map<string, { numId: string; ilvl: number }>();
  for (const s of elements(xml, 'w:style')) {
    const numPr = firstElement(s, 'w:numPr');
    const numId = attr(firstTag(numPr, 'w:numId'), 'w:val');
    const id = attr(s, 'w:styleId');
    if (id && numId) out.set(id, { numId, ilvl: Number(attr(firstTag(numPr, 'w:ilvl'), 'w:val') ?? 0) });
  }
  return out;
}

/** Advances the list counters for this paragraph and renders its label, e.g. "Article IV." or "2.3". */
function listLabel(defs: NumberingDefinitions, counters: Map<string, number[]>, numId: string, ilvl: number): string {
  const levels = defs.abstracts.get(defs.nums.get(numId) ?? '');
  const level = levels?.get(ilvl);
  if (!levels || !level) return '';
  const startOf = (l: number) => defs.overrides.get(numId)?.get(l) ?? levels.get(l)?.start ?? 1;
  const c = counters.get(numId) ?? [];
  for (let l = 0; l < ilvl; l++) c[l] ??= startOf(l);
  c[ilvl] = c[ilvl] === undefined ? startOf(ilvl) : c[ilvl]! + 1;
  c.length = ilvl + 1;
  counters.set(numId, c);
  // A parent's number keeps the parent level's format ("I.1"), unless this level uses legal numbering ("1.1").
  return level.text
    .replace(/%(\d)/g, (_, n: string) => {
      const l = Number(n) - 1;
      const format = level.legal && level.format !== 'bullet' ? 'decimal' : (levels.get(l)?.format ?? 'decimal');
      return formatNumber(c[l] ?? startOf(l), format);
    })
    .trim();
}

function formatNumber(n: number, format: string): string {
  switch (format) {
    case 'upperRoman':
      return roman(n);
    case 'lowerRoman':
      return roman(n).toLowerCase();
    case 'upperLetter':
      return letters(n);
    case 'lowerLetter':
      return letters(n).toLowerCase();
    case 'decimalZero':
      return String(n).padStart(2, '0');
    case 'bullet':
      return '•';
    case 'none':
      return '';
    default:
      return String(n);
  }
}

function roman(n: number): string {
  const table: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  for (const [value, digits] of table) {
    while (n >= value) {
      out += digits;
      n -= value;
    }
  }
  return out;
}

/** Word's letter numbering: A…Z, then AA…ZZ. */
function letters(n: number): string {
  const letter = String.fromCharCode(65 + ((n - 1) % 26));
  return letter.repeat(Math.floor((n - 1) / 26) + 1);
}

function elements(xml: string, tag: string): string[] {
  return xml.match(new RegExp(`<${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`, 'g')) ?? [];
}

function firstElement(xml: string | undefined, tag: string): string | undefined {
  return xml ? elements(xml, tag)[0] : undefined;
}

function firstTag(xml: string | undefined, tag: string): string | undefined {
  return xml?.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0];
}

function attr(tagOrElement: string | undefined, name: string): string | undefined {
  const open = tagOrElement?.match(/^<[^>]*>/)?.[0];
  return open?.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(Number(e.slice(1)));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e]!;
  });
}
