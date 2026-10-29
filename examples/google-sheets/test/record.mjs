// Records a site's MCP answers as the tests' fixture: initialize, tools/list, list_elections, and for each published
// election its status, turnout and results (summary and CSV), and the whole-ledger audit report.
//
//   node examples/google-sheets/test/record.mjs https://ustpvote2-dev.web.app > examples/google-sheets/test/fixtures/dev.json
import { callKey } from './apps-script.mjs';

const site = (process.argv[2] ?? 'https://ustpvote2-dev.web.app').replace(/\/+$/, '');
const endpoint = `${site}/mcp`;
let id = 0;

async function rpc(method, params) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const answer = await res.json();
  if (answer.error) throw new Error(`${method}: ${answer.error.message}`);
  return answer.result;
}

const answers = {};
const call = async (name, args = {}) => {
  const result = await rpc('tools/call', { name, arguments: args });
  answers[callKey(name, args)] = result;
  return result;
};

answers.initialize = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'record', version: '1' } });
answers['tools/list'] = await rpc('tools/list', {});
const { elections } = JSON.parse((await call('list_elections')).content[0].text);
for (const e of elections.filter((e) => e.state !== 'deleted')) {
  const args = { election_id: e.electionId };
  await Promise.all([call('get_election_status', args), call('get_turnout', args), call('get_results', args), call('get_results', { ...args, format: 'csv' })]);
}
await call('get_audit_report');
process.stdout.write(`${JSON.stringify({ site, recordedAt: new Date().toISOString(), answers }, null, 1)}\n`);
