import { AlignmentType, BorderStyle, type IParagraphOptions, Paragraph, ShadingType, Tab, TextRun } from 'docx';

/**
 * The stamp block and page setup of the Word documents the app writes (the election export, design §9): a boxed,
 * shaded block of lines saying what the document is and how to check it against the published record.
 */

/** Paragraph style of the stamp block, so a reader of the document's text can leave it out. */
export const STAMP_STYLE = 'UstpStamp';

/** The stamp's ink, also used for running headers and footers. */
export const INK = '1F3A5F';

/** US Letter with one-inch margins, in twentieths of a point. */
export const LETTER_PAGE = { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } };

/** For a document's `styles.paragraphStyles`, so its stamp lines sit together as one block. */
export const STAMP_PARAGRAPH_STYLE = { id: STAMP_STYLE, name: 'USTP stamp', basedOn: 'Normal', paragraph: { spacing: { after: 0 } } };

/** One line of a stamp block: centred, boxed and shaded. */
export function stampLine(text: string, options: { bold?: boolean; size?: number } = {}): Paragraph {
  const side = { style: BorderStyle.SINGLE, size: 12, color: INK, space: 6 };
  return new Paragraph({
    style: STAMP_STYLE,
    border: { top: side, bottom: side, left: side, right: side },
    shading: { type: ShadingType.CLEAR, fill: 'EEF2F7', color: 'auto' },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, bold: options.bold, size: options.size, color: INK })],
  });
}

/** One line of plain text as a paragraph, its tabs kept as Word tabs. */
export function textParagraph(line: string, options: Omit<IParagraphOptions, 'children'> = {}): Paragraph {
  const parts = line.split('\t');
  const children = parts.flatMap((part, i) => [
    ...(i > 0 ? [new TextRun({ children: [new Tab()] })] : []),
    ...(part ? [new TextRun(part)] : []),
  ]);
  return new Paragraph({ ...options, children });
}
