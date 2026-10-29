// Runs the menu's three actions against a live site, through the same fakes as the tests but with real HTTP, and
// writes what the sheet would hold (tabs.txt) and the PDF's HTML (report.html) to a folder:
//
//   node examples/google-sheets/test/live.mjs https://ustpvote2-dev.web.app <out-folder> [election ID]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { liveFetch, loadCode } from './apps-script.mjs';

const [site = 'https://ustpvote2-dev.web.app', out = '.', election] = process.argv.slice(2);
const { gs, env } = loadCode({ fetchAll: liveFetch, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });

const started = Date.now();
console.log(gs.saveSettings(site));
gs.refreshNumbers();
if (election) env.ss.getSheetByName('Results').getRange('B1').setValue(`'${election}`);
gs.buildResults();
gs.makePdfReport();
for (const alert of env.ui.alerts) console.error(`ALERT ${alert.prompt}`);
console.log(env.ss.toasts.map((t) => t.message).join('\n'));
console.log(`${env.requests.length} requests in ${((Date.now() - started) / 1000).toFixed(1)} s`);

mkdirSync(out, { recursive: true });
const tabs = env.ss.sheets.map((s) => [`=== ${s.name}${s.hidden ? ' (hidden)' : ''}`, ...s.dump().map((r) => r.join(' | ')), ...s.charts.map((c) => `chart ${JSON.stringify(c.spec)}`)].join('\n'));
writeFileSync(join(out, 'tabs.txt'), `${tabs.join('\n\n')}\n`);
if (env.drive.files.length) writeFileSync(join(out, 'report.html'), env.drive.files[0].media.data);
