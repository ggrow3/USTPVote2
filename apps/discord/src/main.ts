#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { startHttp } from './http.js';
import { Site } from './site.js';

const USAGE = `Usage: ustp-discord [options]

The Discord bot's slash commands: answers Discord's signed requests at /interactions from the site's public api only.
It holds no credentials; the key it checks signatures with is read from the site.

Options:
  --site <url>   the web app (Firebase Hosting serves the api under /v1); or env USTP_SITE
  --port <n>     HTTP port (default env PORT, else 8091)
  --host <addr>  address to listen on (default 127.0.0.1; 0.0.0.0 in a container)
  -h, --help     show this help`;

/** The exit code, or null while it serves. */
async function main(argv: readonly string[]): Promise<number | null> {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { site: { type: 'string' }, port: { type: 'string' }, host: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (e) {
    console.error(`ustp-discord: ${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    console.error(USAGE);
    return 0;
  }
  const siteArg = values.site ?? process.env.USTP_SITE;
  const site = siteArg ? URL.parse(siteArg) : null;
  if (!site || (site.protocol !== 'https:' && site.protocol !== 'http:')) {
    console.error(`ustp-discord: give the site with --site or USTP_SITE, e.g. https://ustpvote2-dev.web.app\n\n${USAGE}`);
    return 2;
  }
  const port = Number(values.port ?? process.env.PORT ?? 8091);
  const host = values.host ?? '127.0.0.1';
  await startHttp(new Site(site.origin), { port, host });
  console.error(`ustp-discord: answering for ${site.origin} at http://${host.includes(':') ? `[${host}]` : host}:${port}/interactions`);
  return null;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== null) process.exitCode = code;
  },
  (e: unknown) => {
    console.error(`ustp-discord: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 2;
  },
);
