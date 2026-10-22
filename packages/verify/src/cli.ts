#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { PublicApi } from './api.js';
import { readAnchorFiles } from './files.js';
import { parseReceipt } from './receipt.js';
import { formatReport, hasFailures } from './report.js';
import { verify } from './run.js';

const DEFAULT_API = 'http://127.0.0.1:8080';

const USAGE = `Usage: ustp-verify [options]

Checks a USTP election system from its public artifacts only: the signed, anchored audit ledger and, if asked, one
election's published record and a ballot receipt. Exits 0 when nothing failed (steps that cannot be checked yet show
as "wait"), 1 when any check failed, and 2 when the checks could not run.

Options:
  --api <url>        the api to check (default ${DEFAULT_API})
  --election <id>    also check this election's published record (scans the public ledger entries)
  --receipt <file>   also check this ballot receipt (the JSON the ballot page downloads); implies its election
  --anchors <dir>    compare downloaded anchor objects (<dir>/v1/blocks/*.json, <dir>/v1/keys/*.pem) with the api
  --entries          scan every public ledger entry, even without --election
  --json             print the report as JSON
  -h, --help         show this help`;

async function main(argv: readonly string[]): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        api: { type: 'string' },
        election: { type: 'string' },
        receipt: { type: 'string' },
        anchors: { type: 'string' },
        entries: { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (e) {
    console.error(`ustp-verify: ${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const base = new URL(values.api ?? DEFAULT_API).href;
  const receipt = values.receipt ? parseReceipt(await readFile(values.receipt, 'utf8')) : undefined;
  const anchors = values.anchors ? await readAnchorFiles(values.anchors) : undefined;
  const api = new PublicApi(base);
  const checkedAt = new Date().toISOString();
  const sections = await verify(api, { electionId: values.election, receipt, anchors, scanEntries: values.entries });
  const failed = hasFailures(sections);
  if (values.json) console.log(JSON.stringify({ api: api.base, checkedAt, ok: !failed, sections }, null, 2));
  else console.log(formatReport(`ustp-verify: ${api.base}, ${checkedAt}`, sections));
  return failed ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(`ustp-verify: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 2;
  },
);
