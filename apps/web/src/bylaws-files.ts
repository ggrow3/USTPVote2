import { sha256Hex } from 'ustp-audit';
import type { BylawsRecord, BylawsVersionSummary } from 'ustp-domain';

/**
 * Browser side of the bylaws Word files (design §5.2). The .docx code (and its libraries) loads only when someone
 * imports, exports or checks a copy.
 */

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The page a stamped copy points readers to. */
export function bylawsPageUrl(version: string): string {
  return `${location.origin}/bylaws/${encodeURIComponent(version)}`;
}

export async function downloadBylawsDocx(b: BylawsRecord): Promise<void> {
  const { bylawsDocxBytes, bylawsDocxFileName } = await import('./bylaws-docx.js');
  const bytes = await bylawsDocxBytes(b, { verifyUrl: bylawsPageUrl(b.version), exportedAt: new Date() });
  const url = URL.createObjectURL(new Blob([bytes], { type: DOCX_TYPE }));
  const link = document.createElement('a');
  link.href = url;
  link.download = bylawsDocxFileName(b);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function importBylawsDocx(file: File) {
  const { readBylawsDocx } = await import('./bylaws-docx.js');
  return readBylawsDocx(await file.arrayBuffer());
}

/**
 * Which published version a Word copy's text matches, by SHA-256. A copy loses a trailing newline on the way through
 * Word, so the text is also tried with one.
 */
export async function matchCopy(file: File, versions: readonly BylawsVersionSummary[]) {
  const { text } = await importBylawsDocx(file);
  const hashes = [sha256Hex(text), sha256Hex(`${text}\n`)];
  return { version: versions.find((v) => hashes.includes(v.contentHash)) ?? null, hash: hashes[0]! };
}
