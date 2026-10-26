import type { ElectionDefinition, ElectionState, ResultsRecord } from 'ustp-domain';
import { saveDocx } from './bylaws-files.js';
import type { ProposalText } from './election-docx.js';

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
