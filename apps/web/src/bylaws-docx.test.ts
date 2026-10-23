import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { BylawsRecord } from 'ustp-domain';
import { bylawsDocxBytes, bylawsDocxFileName, readBylawsDocx, STAMP_STYLE } from './bylaws-docx.js';

const record: BylawsRecord = {
  version: '2026.2',
  title: 'USTP Constitution',
  text: 'Article I. Name.\nThe name of this organization is the United States Transhumanist Party.\n\nArticle II. Purpose.\n\tSection 1. To promote science & reason <always>.',
  contentHash: 'ab'.repeat(32),
  publishedAt: '2026-10-23T04:00:00.000Z',
  publishedBy: '01a16403-534d-7178-aa25-1d51c059bfe1',
  amends: '2026.1',
  changeNote: 'Adds Article II.',
};

/** A minimal .docx from raw WordprocessingML, for exercising the reader. */
async function docx(body: string, numbering?: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  if (numbering) zip.file('word/numbering.xml', `<w:numbering xmlns:w="w">${numbering}</w:numbering>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

const para = (text: string, pPr = '') => `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const listItem = (ilvl: number, text: string) => para(text, `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="7"/></w:numPr>`);

describe('exporting a version', () => {
  it('re-imports to exactly the published text, without the stamp', async () => {
    const bytes = await bylawsDocxBytes(record, { verifyUrl: 'https://example.test/bylaws', exportedAt: new Date('2026-10-24') });
    const imported = await readBylawsDocx(bytes);
    expect(imported.text).toBe(record.text);
    expect(imported.title).toBe('Article I. Name.');
  });

  it('stamps the version, hash and source on the page and in the header', async () => {
    const zip = await JSZip.loadAsync(await bylawsDocxBytes(record, { verifyUrl: 'https://example.test/bylaws', exportedAt: new Date() }));
    const body = await zip.file('word/document.xml')!.async('string');
    expect(body).toContain(`w:val="${STAMP_STYLE}"`);
    expect(body).toContain('Version 2026.2 · published 2026-10-23 · amends version 2026.1');
    expect(body).toContain(`SHA-256 of the text: ${record.contentHash}`);
    expect(body).toContain('https://example.test/bylaws');
    const header = await zip.file(/word\/header\d*\.xml/)[0]!.async('string');
    expect(header).toContain('version 2026.2');
    expect(bylawsDocxFileName(record)).toBe('USTP-Constitution-v2026.2.docx');
  });
});

describe('importing a .docx', () => {
  it('writes out Word list numbers, tabs, breaks and entities, and skips deleted text', async () => {
    const numbering =
      '<w:abstractNum w:abstractNumId="3">' +
      '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="Article %1."/></w:lvl>' +
      '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:isLgl/><w:lvlText w:val="%1.%2"/></w:lvl>' +
      '<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%3)"/></w:lvl>' +
      '</w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="3"/></w:num>';
    const body =
      para('USTP Constitution') +
      listItem(0, 'Name') +
      listItem(1, 'The party is named.') +
      listItem(2, 'first') +
      listItem(2, 'second') +
      listItem(0, 'Purpose') +
      listItem(1, 'Science &amp; reason') +
      '<w:p><w:r><w:t>Kept</w:t></w:r><w:del><w:r><w:delText> removed</w:delText></w:r></w:del><w:r><w:tab/><w:t>tabbed</w:t><w:br/><w:t>next line</w:t></w:r></w:p>' +
      '<w:p/>' +
      para('Copy stamp', `<w:pStyle w:val="${STAMP_STYLE}"/>`);
    const imported = await readBylawsDocx(await docx(body, numbering));
    expect(imported.text.split('\n')).toEqual([
      'USTP Constitution',
      'Article I. Name',
      '1.1 The party is named.',
      '(a) first',
      '(b) second',
      'Article II. Purpose',
      '2.1 Science & reason',
      'Kept\ttabbed',
      'next line',
    ]);
    expect(imported).toMatchObject({ title: 'USTP Constitution', numberedLines: 6 });
  });

  it('keeps a parent number in its own format unless the level uses legal numbering', async () => {
    const numbering = (legal: string) =>
      '<w:abstractNum w:abstractNumId="1">' +
      '<w:lvl w:ilvl="0"><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl>' +
      `<w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/>${legal}<w:lvlText w:val="%1.%2"/></w:lvl>` +
      '</w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="1"/></w:num>';
    const body = listItem(0, 'Name') + listItem(1, 'Named.');
    expect((await readBylawsDocx(await docx(body, numbering('')))).text).toBe('I. Name\nI.1 Named.');
    expect((await readBylawsDocx(await docx(body, numbering('<w:isLgl/>')))).text).toBe('I. Name\n1.1 Named.');
  });

  it('refuses files that are not Word documents', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'hi');
    await expect(readBylawsDocx(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow(/not a Word document/);
  });
});
