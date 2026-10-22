import { info, type Finding } from './report.js';

/**
 * EXTENSION POINT: results verification (design §2 invariant 4, milestone M4a).
 *
 * M4a publishes a results bundle at `GET /v1/public/elections/{id}/results`; it is being built alongside this CLI, so
 * its shape is not known here and nothing about it is checked yet. Once it lands, this is where to check, from the
 * bundle and the sealed blocks `run.ts` already fetched (pass them in):
 * - the revealed tie-break seed hashes to the election's `tieBreakSeedCommitment`;
 * - re-running `ustp-tally` over the sealed parts with that seed reproduces every contest's result;
 * - the bundle's hash is the one its ledger entry (and any certification entry) records, in a verified block.
 *
 * `bundle` is the parsed response, or null when the api answered 404.
 */
export function resultsFindings(bundle: unknown): Finding[] {
  if (bundle === null) return [info('Results', 'results not published')];
  return [info('Results bundle published', 'not checked: this version of ustp-verify predates the results bundle')];
}
