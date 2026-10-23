import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Tab,
  TextRun,
} from 'docx';
import JSZip from 'jszip';
import { splitLines, type BylawsRecord } from 'ustp-domain';

/**
 * Word documents for the bylaws (design §5.2): reading the text out of a .docx so a Membership Admin can start a
 * version from the party's existing constitution, and writing a stamped copy of a published version to pass around.
 * The published text and its SHA-256 stay the record; a .docx is a convenience copy whose stamp says how to check it.
 */

/** Paragraph style of the stamp block, so re-importing an exported copy yields only the bylaws text. */
export const STAMP_STYLE = 'UstpStamp';

export interface ImportedBylaws {
  /** One line per paragraph (line breaks inside a paragraph start new lines), with list numbers written out. */
  readonly text: string;
  /** The first non-empty line, as a suggested title. */
  readonly title: string | null;
  readonly lines: number;
  /** Paragraphs that had automatic Word numbering, now written into the text. */
  readonly numberedLines: number;
}

// --- Reading ---------------------------------------------------------------------------------------------------------

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

export async function readBylawsDocx(data: ArrayBuffer | Uint8Array): Promise<ImportedBylaws> {
  const zip = await JSZip.loadAsync(data);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) throw new Error('This is not a Word document (.docx): it has no word/document.xml.');
  const numbering = parseNumbering((await zip.file('word/numbering.xml')?.async('string')) ?? '');
  const styleNumbering = parseStyleNumbering((await zip.file('word/styles.xml')?.async('string')) ?? '');

  const counters = new Map<string, number[]>();
  const lines: string[] = [];
  let numberedLines = 0;
  for (const p of paragraphs(documentXml)) {
    const style = attr(firstTag(p, 'w:pStyle'), 'w:val');
    if (style === STAMP_STYLE) continue;
    const numPr = firstElement(p, 'w:numPr');
    const numId = attr(firstTag(numPr, 'w:numId'), 'w:val') ?? (style ? styleNumbering.get(style)?.numId : undefined);
    const ilvl = Number(attr(firstTag(numPr, 'w:ilvl'), 'w:val') ?? (style ? styleNumbering.get(style)?.ilvl : undefined) ?? 0);
    const label = numId && numId !== '0' ? listLabel(numbering, counters, numId, ilvl) : '';
    if (label) numberedLines++;
    const text = paragraphText(p);
    const joined = label ? `${label} ${text}` : text;
    lines.push(...splitLines(joined).map((l) => l.replace(/ /g, ' ').trimEnd()));
  }
  while (lines.length > 0 && lines.at(-1) === '') lines.pop();
  while (lines.length > 0 && lines[0] === '') lines.shift();
  const first = lines.find((l) => l.trim() !== '') ?? null;
  return {
    text: lines.join('\n'),
    title: first && first.length <= 120 ? first.trim() : null,
    lines: lines.length,
    numberedLines,
  };
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

// --- Writing ---------------------------------------------------------------------------------------------------------

export interface StampOptions {
  /** Where a reader can compare this copy with the published record. */
  readonly verifyUrl: string;
  readonly exportedAt: Date;
}

const INK = '1F3A5F';

function stampLine(text: string, options: { bold?: boolean; size?: number } = {}): Paragraph {
  const side = { style: BorderStyle.SINGLE, size: 12, color: INK, space: 6 };
  return new Paragraph({
    style: STAMP_STYLE,
    border: { top: side, bottom: side, left: side, right: side },
    shading: { type: ShadingType.CLEAR, fill: 'EEF2F7', color: 'auto' },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, bold: options.bold, size: options.size, color: INK })],
  });
}

function textParagraph(line: string): Paragraph {
  const parts = line.split('\t');
  const children = parts.flatMap((part, i) => [
    ...(i > 0 ? [new TextRun({ children: [new Tab()] })] : []),
    ...(part ? [new TextRun(part)] : []),
  ]);
  return new Paragraph({ children });
}

const day = (iso: string | Date) => new Date(iso).toISOString().slice(0, 10);

/** A Word document for one published version: a stamp block, the text line by line, and a stamped header and footer. */
export function bylawsDocument(b: BylawsRecord, options: StampOptions): Document {
  const stamp = [
    stampLine('UNITED STATES TRANSHUMANIST PARTY', { bold: true, size: 28 }),
    stampLine(`Official copy · ${b.title}`, { bold: true }),
    stampLine(`Version ${b.version} · published ${day(b.publishedAt)}${b.amends ? ` · amends version ${b.amends}` : ''}`),
    ...(b.changeNote ? [stampLine(`Change: ${b.changeNote}`)] : []),
    stampLine(`SHA-256 of the text: ${b.contentHash}`, { size: 16 }),
    stampLine(`Exported ${day(options.exportedAt)}. Check this copy against the published record at ${options.verifyUrl}`, {
      size: 16,
    }),
    new Paragraph({ style: STAMP_STYLE, children: [] }),
  ];
  return new Document({
    creator: 'USTP Vote',
    title: `${b.title}, version ${b.version}`,
    subject: `Version ${b.version}${b.amends ? `, amending ${b.amends}` : ''}`,
    keywords: `bylaws; version ${b.version}; sha256:${b.contentHash}`,
    description: b.changeNote ?? undefined,
    styles: {
      paragraphStyles: [{ id: STAMP_STYLE, name: 'USTP stamp', basedOn: 'Normal', paragraph: { spacing: { after: 0 } } }],
    },
    sections: [
      {
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `${b.title} · version ${b.version} · SHA-256 ${b.contentHash.slice(0, 16)}…`,
                    size: 16,
                    color: INK,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    size: 16,
                    color: INK,
                    children: [`Official copy of version ${b.version} · page `, PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
                  }),
                ],
              }),
            ],
          }),
        },
        children: [...stamp, ...splitLines(b.text).map(textParagraph)],
      },
    ],
  });
}

export function bylawsDocxBytes(b: BylawsRecord, options: StampOptions): Promise<ArrayBuffer> {
  return Packer.toArrayBuffer(bylawsDocument(b, options));
}

/** `USTP-Bylaws-v2026.2.docx` */
export function bylawsDocxFileName(b: Pick<BylawsRecord, 'title' | 'version'>): string {
  const title = b.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Bylaws';
  return `${title}-v${b.version}.docx`;
}
