import { electionPackageSchema, type ElectionDefinition, type ElectionPackage, type ElectionState, type ResultsRecord } from 'ustp-domain';
import { saveDocx, saveFile } from './bylaws-files.js';
import type { ProposalText } from './election-docx.js';
import { electionSlug, fileDate } from './election-text.js';

/**
 * Browser side of the election's Word file (design §9): the ballot, and the results once published, for Word or
 * Google Docs. The .docx code (and its libraries) loads only when someone downloads one.
 */
export async function downloadElectionDocx(input: {
  readonly definition: ElectionDefinition;
  readonly state: ElectionState;
  readonly proposals: readonly ProposalText[];
  readonly results: ResultsRecord | null;
}): Promise<void> {
  const { electionDocxBytes, electionDocxFileName } = await import('./election-docx.js');
  const exportedAt = new Date();
  const bytes = await electionDocxBytes({ ...input, origin: location.origin, exportedAt });
  saveDocx(bytes, electionDocxFileName(input.definition, { withResults: !!input.results, exportedAt }));
}

/** `ustp-vote-2026-officer-election-2026-10-26.election.json`. */
export function electionPackageFileName(title: string, exportedAt: Date, timeZone?: string): string {
  return `ustp-vote-${electionSlug(title)}-${fileDate(exportedAt, timeZone)}.election.json`;
}

/** Hands the browser an election package to save (design §6.7). */
export function saveElectionPackage(pkg: ElectionPackage): void {
  const blob = new Blob([`${JSON.stringify(pkg, null, 2)}\n`], { type: 'application/json' });
  saveFile(blob, electionPackageFileName(pkg.title, new Date()));
}

/** "contests.2.title: enter a title"; problems with the file as a whole have no path. */
export function packageProblem(path: string, message: string): string {
  return path ? `${path}: ${message}` : message;
}

/**
 * A chosen `ustp.election` file, checked in the browser with the schema the api uses: the package, or every problem
 * with it by path.
 */
export async function readElectionPackage(file: File): Promise<{ ok: true; pkg: ElectionPackage } | { ok: false; problems: string[] }> {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return { ok: false, problems: [`${file.name} is not a JSON file`] };
  }
  const result = electionPackageSchema.safeParse(json);
  if (result.success) return { ok: true, pkg: result.data };
  return { ok: false, problems: result.error.issues.map((i) => packageProblem(i.path.join('.'), i.message)) };
}
