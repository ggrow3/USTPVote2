#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CachingPublicApi } from './cached-api.js';
import { startHttp } from './http.js';
import { ElectionReports } from './reports.js';
import { createServer } from './server.js';

const USAGE = `Usage: ustp-mcp [options]

A read-only MCP server for AI-assisted election reports (Gemini CLI, Gemini Enterprise, Claude): election status,
turnout, public results and audit reports, from the election system's public api only. It holds no credentials.

Options:
  --site <url>     the election web app (Firebase Hosting serves the api under /v1); or env USTP_SITE
  --http           serve MCP's Streamable HTTP transport at /mcp instead of stdio
  --port <n>       HTTP port (default env PORT, else 8090)
  --host <addr>    HTTP address to listen on (default 127.0.0.1; 0.0.0.0 in a container)
  --allowed-hosts <names>  comma-separated Host header names to answer over HTTP (default: loopback names when
                   listening on loopback, otherwise any); or env MCP_ALLOWED_HOSTS
  -h, --help       show this help`;

/** The exit code, or null while it serves. */
async function main(argv: readonly string[]): Promise<number | null> {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        site: { type: 'string' },
        http: { type: 'boolean' },
        port: { type: 'string' },
        host: { type: 'string' },
        'allowed-hosts': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (e) {
    console.error(`ustp-mcp: ${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    console.error(USAGE);
    return 0;
  }
  const siteArg = values.site ?? process.env.USTP_SITE;
  const site = siteArg ? URL.parse(siteArg) : null;
  if (!site || (site.protocol !== 'https:' && site.protocol !== 'http:')) {
    console.error(`ustp-mcp: give the election site with --site or USTP_SITE, e.g. https://ustpvote2-dev.web.app\n\n${USAGE}`);
    return 2;
  }
  const reports = new ElectionReports(new CachingPublicApi(site.origin));

  if (!values.http) {
    // stdout carries the protocol: everything else goes to stderr.
    await createServer(reports).connect(new StdioServerTransport());
    console.error(`ustp-mcp: serving ${site.origin} over stdio`);
    return null;
  }
  const port = Number(values.port ?? process.env.PORT ?? 8090);
  const host = values.host ?? '127.0.0.1';
  const hosts = values['allowed-hosts'] ?? process.env.MCP_ALLOWED_HOSTS;
  const allowedHosts = hosts?.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  await startHttp(reports, { port, host, ...(allowedHosts && { allowedHosts }) });
  console.error(`ustp-mcp: serving ${site.origin} at http://${host.includes(':') ? `[${host}]` : host}:${port}/mcp`);
  return null;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== null) process.exitCode = code;
  },
  (e: unknown) => {
    console.error(`ustp-mcp: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 2;
  },
);
