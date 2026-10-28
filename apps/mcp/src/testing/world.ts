import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { seedCommitment } from 'ustp-audit';
import { buildResultsBundle, resultsCsv, resultsHash, resultsSigningInput, resultsSummary, type ResultsRecord } from 'ustp-domain';
import { fakeFetch, type World } from '../../../../packages/verify/src/testing/fixtures.js';
import { CachingPublicApi } from '../cached-api.js';
import { ElectionReports } from '../reports.js';
import { createServer } from '../server.js';

export const SITE = 'https://vote.test';

/**
 * The world's election tallied for real: its sealed blocks counted with a revealed seed, the bundle signed by the
 * world's key, and the record pointing at it. `ledgerSeq` names no entry, so the ledger step of the check waits.
 */
export async function withResults(world: World, status: ResultsRecord['status'] = 'provisional'): Promise<{ world: World; results: ResultsRecord }> {
  const seed = 'ab'.repeat(32);
  const { election, definition, roll } = world.record;
  const tieBreakSeedCommitment = seedCommitment(seed);
  const bundle = buildResultsBundle({
    definition,
    definitionHash: election.definitionHash!,
    roll: { snapshotId: roll!.snapshotId, merkleRoot: roll!.merkleRoot, count: roll!.count },
    tieBreakSeed: seed,
    tieBreakSeedCommitment,
    blocks: world.sealedBlocks,
  });
  const results: ResultsRecord = {
    electionId: election.electionId,
    status,
    bundle,
    resultsHash: resultsHash(bundle),
    signature: await world.signer.sign(resultsSigningInput(bundle)),
    computedAt: '2026-10-21T12:27:00.000Z',
    ledgerSeq: 999,
    certifiedAt: status === 'certified' ? '2026-10-21T13:00:00.000Z' : null,
    certifiedLedgerSeq: null,
  };
  const record = { ...world.record, election: { ...election, tieBreakSeedCommitment }, results: resultsSummary(results) };
  return { world: { ...world, record }, results };
}

/** The world's public api, plus the results CSV the fixture does not serve; `paths` records every request. */
export function serve(world: World, results?: ResultsRecord) {
  const inner = fakeFetch(world, results ? { results } : {});
  const paths: string[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname.endsWith('/results.csv')) {
      if (!results) return new Response('not found', { status: 404 });
      const csv = resultsCsv({ results, definition: world.record.definition, origin: url.origin });
      return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8' } });
    }
    return inner(input, init);
  };
  return { fetchFn, paths };
}

/** An MCP client talking to a fresh server over memory, as Gemini CLI would over stdio. */
export async function connect(fetchFn: typeof fetch) {
  const reports = new ElectionReports(new CachingPublicApi(SITE, fetchFn));
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([createServer(reports).connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    reports,
    /** The tool's result; text blocks only. */
    call: async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as CallToolResult,
  };
}

export function texts(result: CallToolResult): string[] {
  return result.content.map((c) => (c.type === 'text' ? c.text : ''));
}

/** The JSON report a tool answered with, loosely typed for assertions. */
export function report(result: CallToolResult): any {
  if (result.isError) throw new Error(`tool error: ${texts(result).join(' ')}`);
  return JSON.parse(texts(result)[0]!);
}
