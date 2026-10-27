import { readFileSync } from 'node:fs';
import { sha256Hex } from 'ustp-audit';
import {
  electionPackageSchema,
  packageProposals,
  packageRecords,
  testVotesSchema,
  buildDefinition,
  type ElectionDefinition,
  type ElectionPackage,
  type ProposalSnapshotRecord,
  type TestVotes,
} from 'ustp-domain';

/** The repository's `examples/` (design §6.7, §10.4), as the tests read them. */

export interface ExamplesManifest {
  readonly offices: readonly { readonly positionId: string; readonly title: string; readonly seats: number; readonly termMonths: number; readonly description: string }[];
  readonly bylaws: { readonly version: string; readonly title: string; readonly file: string };
  readonly elections: readonly {
    readonly file: string;
    readonly seed?: 'scheduled' | 'draft';
    readonly votes?: readonly { readonly file: string; readonly amendedBylaws?: string }[];
  }[];
}

export const readExample = (path: string): string => readFileSync(new URL(`../../../../examples/${path}`, import.meta.url), 'utf8');

export const examplesManifest = JSON.parse(readExample('manifest.json')) as ExamplesManifest;

export function exampleBylaws(): { version: string; title: string; text: string; contentHash: string } {
  const { version, title, file } = examplesManifest.bylaws;
  const text = readExample(file);
  return { version, title, text, contentHash: sha256Hex(text) };
}

export const exampleElection = (file: string): ElectionPackage => electionPackageSchema.parse(JSON.parse(readExample(file)));
export const exampleVotes = (file: string): TestVotes => testVotesSchema.parse(JSON.parse(readExample(file)));

/** The definition a package gives once imported, with placeholder IDs, and the proposal texts it captures. */
export function packageDefinition(pkg: ElectionPackage, now = new Date()): { definition: ElectionDefinition; texts: ProposalSnapshotRecord[] } {
  const proposals = packageProposals(pkg);
  let n = 0;
  const records = packageRecords(pkg, {
    electionId: 'e1',
    createdBy: 'ea',
    now,
    newId: () => `id${++n}`,
    snapshotIds: proposals.map((p, i) => (p ? `p${i}` : null)),
  });
  const texts = proposals.flatMap((p, i): ProposalSnapshotRecord[] =>
    p && 'input' in p ? [{ snapshotId: `p${i}`, ...p.input, source: p.input.source ?? null, contentHash: p.contentHash, capturedAt: '', capturedBy: 'ea' }] : [],
  );
  return { definition: buildDefinition(records.election, records.contests, records.candidates, texts), texts };
}
