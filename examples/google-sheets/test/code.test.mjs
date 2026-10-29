// Code.gs in Node, against the fakes in apps-script.mjs and answers recorded from the dev site (fixtures/dev.json):
//   node --test "examples/google-sheets/test/*.test.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { callKey, fixtureFetch, loadCode } from './apps-script.mjs';

const recording = JSON.parse(readFileSync(new URL('./fixtures/dev.json', import.meta.url), 'utf8'));
const SITE = 'https://ustpvote2-dev.web.app';
const DEMO = '01a17d23-ede7-7c0b-ac92-38c52a360a9b'; // Transhumanist Party Demo 2: two ranked-choice contests, two proposals
const GUILD = '01a184e3-79de-732d-80e6-da6aaa948d61'; // [Demo] 2027 Open Biology Guild: choose-N, ranked choice, a proposal
const OPEN = '01a17525-8bea-7323-8f9e-13685927f93f'; // Test 2026: a real election, voting open
const quiet = { error: () => {}, log: () => {} };

/** Values made in the vm context have its prototypes: compare them as JSON. */
const plain = (v) => JSON.parse(JSON.stringify(v));
const answer = (name, args) => recording.answers[callKey(name, args)];
const data = (name, args) => JSON.parse(answer(name, args).content[0].text);
const csvOf = (id) => answer('get_results', { election_id: id, format: 'csv' }).content[1].text;
const clone = (v) => structuredClone(v);

function load(options = {}) {
  return loadCode({ fetchAll: fixtureFetch(recording, options), properties: { USTP_SITE: SITE }, console: quiet, ...options.load });
}

const utc = (gs) => gs.dateFormatter_('Etc/UTC');

function formulas(env) {
  return env.ss.sheets.flatMap((s) => [...s.cells.entries()].filter(([, c]) => c.formula).map(([k, c]) => `${s.name}!${k} ${c.formula}`));
}

describe('settings', () => {
  it('takes the site in any usual form and keeps only its https origin', () => {
    const { gs } = load();
    for (const typed of ['https://ustpvote2-dev.web.app', 'ustpvote2-dev.web.app', ' https://USTPVote2-dev.web.app/mcp ', 'https://ustpvote2-dev.web.app/results/x?y#z']) {
      assert.equal(gs.siteOrigin_(typed), SITE);
    }
    assert.equal(gs.siteOrigin_('https://vote.example.org:8443/'), 'https://vote.example.org:8443');
    for (const bad of ['', 'http://ustpvote2-dev.web.app', 'localhost', 'javascript:alert(1)', 'https://', 'not a site']) {
      assert.throws(() => gs.siteOrigin_(bad), /is not the https address of an election site/);
    }
  });

  it('saves the site once its MCP server answers with the tools the sheet uses', () => {
    const { gs, env } = load({ load: { properties: {} } });
    assert.equal(gs.saveSettings('ustpvote2-dev.web.app/mcp'), `Saved. ustp-vote-reports 0.1.0 answered at ${SITE}/mcp with 5 tools.`);
    assert.equal(env.props.get('USTP_SITE'), SITE);
  });

  it('refuses a server without those tools, and keeps nothing', () => {
    const { gs, env } = load({ load: { properties: {} }, override: { 'tools/list': { tools: [{ name: 'list_elections' }] } } });
    assert.throws(() => gs.saveSettings(SITE), /has no get_election_status, get_turnout, get_results, get_audit_report/);
    assert.equal(env.props.has('USTP_SITE'), false);
  });

  it('asks for the site before anything else', () => {
    const { gs, env } = load({ load: { properties: {} } });
    gs.refreshNumbers();
    assert.match(env.ui.alerts[0].prompt, /set the election site first \(USTP Vote › Settings…\)/);
    assert.equal(env.requests.length, 0);
  });

  it('adds the USTP Vote menu', () => {
    const { gs, env } = load();
    gs.onOpen();
    assert.deepEqual(plain(env.ui.menus), [
      {
        name: 'USTP Vote',
        items: [
          ['Refresh numbers', 'refreshNumbers'],
          ['Build results for the chosen election', 'buildResults'],
          ['Make PDF report', 'makePdfReport'],
          ['-'],
          ['Settings…', 'showSettings'],
        ],
      },
    ]);
  });
});

describe('the MCP client', () => {
  it('reads a JSON answer, or one in an event stream after other messages', () => {
    const { gs } = load();
    assert.deepEqual(plain(gs.rpcAnswer_(200, 'application/json', '{"jsonrpc":"2.0","id":3,"result":{"x":1}}', 3)), { x: 1 });
    const stream =
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\n' +
      'event: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":3,"result":{"x":2}}\r\n\r\n';
    assert.deepEqual(plain(gs.rpcAnswer_(200, 'text/event-stream; charset=utf-8', stream, 3)), { x: 2 });
  });

  it('turns HTTP errors, JSON-RPC errors and stray answers into messages', () => {
    const { gs } = load();
    assert.throws(() => gs.rpcAnswer_(406, 'application/json', '{"error":"Not Acceptable"}', 1), /answered HTTP 406: \{"error":"Not Acceptable"\}/);
    assert.throws(() => gs.rpcAnswer_(200, 'application/json', '{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"bad"}}', 1), /MCP error -32602: bad/);
    assert.throws(() => gs.rpcAnswer_(200, 'application/json', '{"jsonrpc":"2.0","id":2,"result":{}}', 1), /no answer to request 1/);
    assert.throws(() => gs.rpcAnswer_(200, 'text/html', '<html>', 1), /not JSON-RPC: <html>/);
  });

  it('reads a tool answer as JSON and its second block as text, and a tool error as an error', () => {
    const { gs } = load();
    const csv = gs.toolAnswer_('get_results', answer('get_results', { election_id: DEMO, format: 'csv' }));
    assert.equal(csv.data.published, true);
    assert.match(csv.text, /^Election,Transhumanist Party Demo 2,/);
    assert.throws(() => gs.toolAnswer_('get_results', { isError: true, content: [{ type: 'text', text: 'no published election x' }] }), /get_results: no published election x/);
  });

  it('initializes, notifies, then calls tools with the negotiated protocol version', () => {
    const { gs, env } = load();
    gs.refreshNumbers();
    assert.deepEqual(env.ui.alerts, []);
    const sent = env.requests.map((r) => ({ ...JSON.parse(r.payload), headers: r.headers, url: r.url }));
    assert.ok(sent.every((m) => m.url === `${SITE}/mcp` && m.headers.Accept === 'application/json, text/event-stream' && m.jsonrpc === '2.0'));
    assert.equal(sent[0].method, 'initialize');
    assert.equal(sent[0].params.protocolVersion, '2025-06-18');
    assert.equal(sent[0].headers['MCP-Protocol-Version'], undefined);
    assert.deepEqual([sent[1].method, sent[1].id], ['notifications/initialized', undefined]);
    assert.ok(sent.slice(1).every((m) => m.headers['MCP-Protocol-Version'] === '2025-06-18'));
    const calls = sent.filter((m) => m.method === 'tools/call').map((m) => callKey(m.params.name, m.params.arguments));
    assert.deepEqual(calls.sort(), [
      callKey('get_audit_report'),
      ...[GUILD, DEMO, OPEN].flatMap((id) => [callKey('get_election_status', { election_id: id }), callKey('get_turnout', { election_id: id })]),
      callKey('list_elections'),
    ].sort());
  });

  it('works the same when the server answers with an event stream', () => {
    const json = load();
    const sse = load({ sse: true });
    json.gs.refreshNumbers();
    sse.gs.refreshNumbers();
    assert.deepEqual(sse.env.ui.alerts, []);
    for (const tab of ['Elections', 'Contest turnout', 'Rolls']) {
      assert.deepEqual(sse.env.ss.getSheetByName(tab).dump(), json.env.ss.getSheetByName(tab).dump());
    }
  });
});

describe('Refresh numbers', () => {
  it('writes the overview from real elections, counting rehearsals and deleted ones apart', () => {
    const { gs, env } = load();
    gs.refreshNumbers();
    const overview = env.ss.getSheetByName('Overview').dump();
    assert.deepEqual(overview.slice(4), [
      ['Figure', 'Value', 'Notes'],
      ['Real elections', '1', '1 open'],
      ['Rehearsals', '2', 'test voters only: left out of the figures below'],
      ['Deleted elections', '6', 'only their ledger entries remain public'],
      ['Active members on the latest roll', '10', 'the roll of Test 2026, frozen 25 Oct 2026, 22:25 UTC'],
      ['Ballots in real elections', '0', 'a lower bound while voting is open: only sealed ballots are public'],
      ['Turnout, latest real results', '', 'no real election has published results yet'],
      ['Results certified', '0', '0 provisional, awaiting two Election Admins'],
      ['Public ledger audit', 'verified', 'the whole public ledger: 5 passed, 0 failed, 0 pending (Audit tab)'],
    ]);
    assert.match(overview[1][0], /^From https:\/\/ustpvote2-dev\.web\.app\/mcp \(ustp-vote-reports 0\.1\.0\), refreshed /);
    assert.deepEqual(overview[2], ['Report PDF', 'not made yet: USTP Vote › Make PDF report']);
  });

  it('lists every election with its turnout, and links its results page', () => {
    const { gs, env } = load();
    gs.refreshNumbers();
    const sheet = env.ss.getSheetByName('Elections');
    const rows = sheet.dump();
    assert.equal(rows.length, 10);
    assert.deepEqual(rows[2], [
      'Transhumanist Party Demo 2', 'closed', 'yes', '2026-10-27 21:31', '2026-10-27 22:01', '9', '9', '100.0%', 'yes', 'provisional',
      'e50a6d16b0dd420731706374d512688ac1f20391f91f0cd6babb877981f77f3b', 'results page', DEMO,
      'provisional results published 27 Oct 2026, 22:01 UTC; awaiting certification by two Election Admins',
    ]);
    assert.deepEqual(rows[3].slice(0, 9), ['Test 2026', 'open', 'no', '2026-10-25 22:30', '2026-11-15 22:18', '10', '0', '0.0%', 'no: a lower bound']);
    assert.deepEqual(rows[9], ['Transhumanist Party Demo', 'deleted', 'yes', '', '', '', '9', '', '', '', '', '', '01a17afa-d272-7485-8601-971fee588d8f', 'deleted: only its ledger entry is public']);
    assert.equal(sheet.cell(3, 12).rich.getLinkUrl(), `${SITE}/results/${DEMO}`);
    assert.equal(sheet.cell(3, 4).value.toISOString(), '2026-10-27T21:31:00.000Z');
    assert.equal(sheet.frozenRows, 1);
  });

  it('writes contest turnout, rolls and the audit report', () => {
    const { gs, env } = load();
    gs.refreshNumbers();
    const contests = env.ss.getSheetByName('Contest turnout').dump();
    assert.equal(contests.length, 9);
    assert.deepEqual(contests[7], ['Transhumanist Party Demo 2', 'yes', 'Platform plank: Morphological freedom', 'proposal (yes / no / abstain)', '9', '0', '', '1', 'none']);
    const rolls = env.ss.getSheetByName('Rolls').dump();
    assert.match(rolls[0][0], /^The MCP server serves no member data/);
    assert.deepEqual(rolls[5], ['Test 2026', 'no', 'open', '2026-10-25 22:25', '10', 'Active members']);
    const audit = env.ss.getSheetByName('Audit').dump();
    assert.deepEqual(audit.slice(0, 2), [['Verified', 'Passed', 'Failed', 'Pending'], ['yes', '5', '0', '0']]);
    assert.equal(audit.at(-1)[0], 'VERIFIED: 5 passed, 0 failed, 0 pending');
    assert.ok(audit.some((r) => r[0] === '  [ ok ] Every block\'s signature verifies with a listed audit key'));
  });

  it('fills the picker with elections whose results are published, from a hidden tab', () => {
    const { gs, env } = load();
    gs.refreshNumbers();
    const lists = env.ss.getSheetByName('Lists');
    assert.equal(lists.hidden, true);
    assert.deepEqual(lists.dump().slice(1), [
      [`[Demo] 2027 Open Biology Guild Steering Election · 2026-10-28 · provisional · rehearsal · ${GUILD}`],
      [`Transhumanist Party Demo 2 · 2026-10-27 · provisional · rehearsal · ${DEMO}`],
    ]);
    const picker = env.ss.getSheetByName('Results').cell(1, 2);
    assert.equal(picker.value, lists.dump()[1][0]);
    assert.deepEqual([picker.validation.range.row, picker.validation.range.rows, picker.validation.allowInvalid], [2, 2, false]);
  });

  it('puts real elections first in the picker', () => {
    const { gs } = load();
    const e = (title, rehearsal, results, opensAt) => ({ title, rehearsal, results, opensAt, electionId: `id-${title}` });
    const options = gs.pickerOptions_([e('R2', true, 'provisional', '2026-10-02T00:00:00Z'), e('A', false, 'certified', '2026-09-01T00:00:00Z'), e('B', false, null, '2026-10-03T00:00:00Z'), e('R1', true, 'certified', '2026-08-01T00:00:00Z')], (iso) => iso.slice(0, 10));
    assert.deepEqual(plain(options), ['A · 2026-09-01 · certified · id-A', 'R2 · 2026-10-02 · provisional · rehearsal · id-R2', 'R1 · 2026-08-01 · certified · rehearsal · id-R1']);
  });

  it('runs from a time-driven trigger, which has no UI, and fails there by throwing', () => {
    const { gs, env } = load({ load: { noUi: true } });
    gs.refreshNumbers();
    assert.equal(env.ss.getSheetByName('Elections').dump().length, 10);
    const unset = load({ load: { noUi: true, properties: {} } });
    assert.throws(() => unset.gs.refreshNumbers(), /set the election site first/);
  });

  it('keeps going when one election cannot be read, and says so on its row', () => {
    const failing = { isError: true, content: [{ type: 'text', text: 'the election api did not answer: 503' }] };
    const { gs, env } = load({ override: { [callKey('get_election_status', { election_id: OPEN })]: failing } });
    gs.refreshNumbers();
    assert.deepEqual(env.ui.alerts, []);
    const row = env.ss.getSheetByName('Elections').dump()[3];
    assert.equal(row[0], 'Test 2026');
    assert.equal(row.at(-1), 'could not read: get_election_status: the election api did not answer: 503');
  });

  it('writes titles as text, never as formulas', () => {
    const list = clone(answer('list_elections'));
    const listed = JSON.parse(list.content[0].text);
    listed.elections[1].title = '=IMPORTXML("https://evil.example","//a")<script>alert(1)</script>';
    list.content[0].text = JSON.stringify(listed);
    const { gs, env } = load({ override: { [callKey('list_elections')]: list } });
    gs.refreshNumbers();
    gs.makePdfReport();
    assert.deepEqual(formulas(env), []);
    assert.equal(env.ss.getSheetByName('Elections').dump()[2][0], listed.elections[1].title);
    const html = env.drive.files[0].media.data;
    assert.ok(html.includes('=IMPORTXML(&quot;https://evil.example&quot;,&quot;//a&quot;)&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<script'));
  });
});

describe('the results', () => {
  const demo = () => data('get_results', { election_id: DEMO });
  const guild = () => data('get_results', { election_id: GUILD });

  it('reads the ranked-choice rounds from the results CSV', () => {
    const { gs } = load();
    const contests = gs.csvContests_(gs.parseCsv_(csvOf(DEMO)));
    assert.deepEqual(Object.keys(contests), ['chair', 'vice-chair', 'plank', 'convention']);
    assert.deepEqual(plain(gs.irvRounds_(contests.chair)), {
      header: ['Candidate', 'Round 1', 'Round 2', 'Round 3'],
      candidates: [['Avery Lin', 4, 4, 5], ['Jordan Okoye', 3, 3, 4], ['Morgan Reyes', 2, 2, ''], ['Test Voter 6', 0, '', '']],
      continuing: [9, 9, 9],
      exhausted: [0, 0, 0],
      results: ['Test Voter 6 eliminated', 'Morgan Reyes eliminated', 'Avery Lin elected'],
    });
    assert.equal(gs.irvRounds_(contests.plank), null);
  });

  it('parses CSV as RFC 4180, undoing the formula guard', () => {
    const { gs } = load();
    assert.deepEqual(plain(gs.parseCsv_('a,"b, ""c""",12\r\n\'=SUM(A1),"\'=x",\'plain\r\n"multi\nline",,007\n')), [
      ['a', 'b, "c"', 12],
      ['=SUM(A1)', '=x', "'plain"],
      ['multi\nline', '', 7],
    ]);
  });

  it('sums up an election in plain language', () => {
    const { gs } = load();
    const lines = gs.resultsSummary_(demo(), gs.csvContests_(gs.parseCsv_(csvOf(DEMO))), utc(gs));
    assert.deepEqual(plain(lines), [
      'Transhumanist Party Demo 2: provisional results, counted 27 Oct 2026, 22:01 UTC and not yet certified by two Election Admins.',
      'This was a rehearsal with test voters only, not a real election.',
      '9 of the 9 voters on the roll cast a ballot (100.0% turnout).',
      'Chair: Avery Lin won by ranked choice in round 3, with 5 of 9 continuing ballots (55.6%), from 4 first choices (44.4%). ' +
        'Test Voter 6 and Morgan Reyes were eliminated in turn.',
      'Vice Chair: Sam Petrov won by ranked choice in round 2, with 5 of 9 continuing ballots (55.6%), from 4 first choices (44.4%). Taylor Nwosu was eliminated.',
      '"Platform plank: Morphological freedom" passed: 6 yes, 2 no and 1 abstention. Yes had 75.0%; passing needed more than 50.0% of yes + no votes.',
      '"Proposal: Hold the 2027 convention online" failed: 3 yes, 5 no and 1 abstention. Yes had 37.5%; passing needed more than 50.0% of yes + no votes.',
      'In all: 2 of 2 seats filled; 1 of 2 proposals passed.',
      'The results verified from public data: their hash, the audit signature, a full re-tally of the sealed ballots and the ledger all check out.',
      'Results hash: e50a6d16b0dd420731706374d512688ac1f20391f91f0cd6babb877981f77f3b.',
    ]);
  });

  it('describes choose-N contests, first-round wins and seats', () => {
    const { gs } = load();
    const lines = gs.resultsSummary_(guild(), gs.csvContests_(gs.parseCsv_(csvOf(GUILD))), utc(gs));
    assert.deepEqual(plain(lines.slice(3, 7)), [
      'Vice-Chair: Perpetua Umberfield (1 of 1 ballot, 100.0%) was elected.',
      'Cryonics Liaison: Ione Corvane won by ranked choice in the first round, with 1 of 1 first choices (100.0%).',
      'Ethics Board (2 seats): Halcyon Moonfield (1 of 1 ballot, 100.0%) and Elowen Cindervale (1 of 1 ballot, 100.0%) were elected to its 2 seats.',
      '"Add a Plank on Cognitive Liberty" passed: 1 yes, 0 no and 0 abstentions. Yes had 100.0%; passing needed more than 50.0% of yes + no votes.',
    ]);
  });

  it('says when results are certified, a seat is vacant, a quorum missed, nobody ranked or ballots were blank', () => {
    const { gs } = load();
    const summary = demo();
    Object.assign(summary.synopsis, { status: 'certified', certifiedAt: '2026-10-28T09:00:00.000Z' });
    const [chair, , plank] = summary.synopsis.contests;
    Object.assign(chair, { winner: null, blank: { count: 9, of: 9, percent: '100.0%' } });
    Object.assign(plank, { outcome: 'no_quorum', quorum: { required: 20, met: false } });
    const lines = gs.resultsSummary_(summary, {}, utc(gs));
    assert.equal(lines[0], 'Transhumanist Party Demo 2: certified results, approved by two Election Admins 28 Oct 2026, 09:00 UTC.');
    assert.equal(lines[3], 'Chair: nobody was elected, as no ballot ranked a candidate. 9 ballots left it blank.');
    assert.equal(lines[4], 'Vice Chair: Sam Petrov won by ranked choice in round 2, with 5 of 9 continuing ballots (55.6%), from 4 first choices (44.4%).');
    assert.equal(lines[5], '"Platform plank: Morphological freedom" did not reach its quorum: 6 yes, 2 no and 1 abstention. It needed 20 ballots and had 9.');

    const board = guild().synopsis.contests[2];
    Object.assign(board.candidates[1], { elected: false });
    board.vacantSeats = 1;
    assert.equal(gs.contestSentence_(board), 'Ethics Board (2 seats): Halcyon Moonfield (1 of 1 ballot, 100.0%) was elected to 1 of its 2 seats. 1 seat was left vacant.');
    assert.equal(gs.tallySentence_({ proposals: { total: 2, passed: 0, failed: 1, noQuorum: 1 }, candidateContests: { total: 1, seats: 2, elected: 1, vacantSeats: 1 } }),
      'In all: 1 of 2 seats filled, 1 left vacant; 0 of 2 proposals passed, 1 without a quorum.');
  });

  it('warns when the results do not verify, and waits when they cannot be checked yet', () => {
    const { gs } = load();
    const steps = [{ label: 'The results bundle hashes to the published results hash', ok: true }, { label: 'Results signed by the audit key', ok: false }, { label: 'Included in ledger block 44', ok: null }];
    assert.equal(gs.verificationSentence_({ status: 'failed', steps }), 'WARNING: the published results did not verify (Results signed by the audit key).');
    assert.equal(gs.verificationSentence_({ status: 'pending', steps }),
      'The results check is not finished (Included in ledger block 44): the ledger is signed every minute, so try again shortly.');
  });

  it('builds the Results tab for the chosen election: facts, summary, a table and chart per contest, the checks', () => {
    const { gs, env } = load();
    gs.refreshNumbers();
    const sheet = env.ss.getSheetByName('Results');
    sheet.getRange('B1').setValue(`'Transhumanist Party Demo 2 · 2026-10-27 · provisional · rehearsal · ${DEMO}`);
    gs.buildResults();
    assert.deepEqual(env.ui.alerts, []);
    const rows = sheet.dump();
    const at = (text) => rows.findIndex((r) => r[0] === text) + 1;
    assert.deepEqual(rows[2], ['Results: Transhumanist Party Demo 2']);
    assert.deepEqual(rows[3], ['Status', 'Provisional', 'provisional: counted, signed and ledgered by the system, not yet certified by two Election Admins']);
    assert.equal(rows[at('Summary')][0], 'Transhumanist Party Demo 2: provisional results, counted 27 Oct 2026, 22:01 UTC and not yet certified by two Election Admins.');
    const chair = at('Contest 1: Chair (ranked choice)');
    assert.deepEqual(rows.slice(chair, chair + 8), [
      ['Candidate', 'Round 1', 'Round 2', 'Round 3'],
      ['Avery Lin', '4', '4', '5'],
      ['Jordan Okoye', '3', '3', '4'],
      ['Morgan Reyes', '2', '2'],
      ['Test Voter 6', '0'],
      ['Continuing ballots', '9', '9', '9'],
      ['Exhausted', '0', '0', '0'],
      ['Round result', 'Test Voter 6 eliminated', 'Morgan Reyes eliminated', 'Avery Lin elected'],
    ]);
    const plank = at('Contest 3: Platform plank: Morphological freedom (proposal)');
    assert.deepEqual(rows.slice(plank, plank + 5), [['Choice', 'Votes', 'Share of ballots'], ['Yes', '6', '66.7%'], ['No', '2', '22.2%'], ['Abstain', '1', '11.1%'], ['Outcome', 'Passed']]);
    assert.deepEqual(rows[at('Checks')], ['Check', 'Result', 'Detail']);

    const charts = sheet.charts.map((c) => plain(c.spec));
    assert.deepEqual(charts.map((c) => [c.type, c.ranges[0], c.transpose, c.options.colors.length, c.options.isStacked ?? null]), [
      ['COLUMN', { row: chair + 1, col: 1, rows: 5, cols: 4 }, true, 4, null],
      ['COLUMN', { row: at('Contest 2: Vice Chair (ranked choice)') + 1, col: 1, rows: 4, cols: 3 }, true, 3, null],
      ['BAR', { row: plank + 1, col: 1, rows: 4, cols: 2 }, true, 3, 'percent'],
      ['BAR', { row: at('Contest 4: Proposal: Hold the 2027 convention online (proposal)') + 1, col: 1, rows: 4, cols: 2 }, true, 3, 'percent'],
    ]);
    // Each chart sits beside its table and ends before the next contest's heading.
    const headings = [chair, at('Contest 2: Vice Chair (ranked choice)'), plank, at('Contest 4: Proposal: Hold the 2027 convention online (proposal)'), at('Checks')];
    charts.forEach((c, i) => {
      assert.equal(c.position.row, headings[i] + 1);
      assert.ok(c.position.col > c.ranges[0].cols);
      assert.ok(c.position.row + Math.ceil(c.options.height / 21) < headings[i + 1]);
    });
    assert.deepEqual(formulas(env), []);
  });

  it('rebuilds cleanly for another election, keeping the picker', () => {
    const { gs, env } = load();
    gs.refreshNumbers();
    const sheet = env.ss.getSheetByName('Results');
    gs.buildResults();
    assert.equal(sheet.dump()[2][0], 'Results: [Demo] 2027 Open Biology Guild Steering Election');
    assert.equal(sheet.charts.length, 4);
    sheet.getRange('B1').setValue(`'Transhumanist Party Demo 2 · 2026-10-27 · provisional · rehearsal · ${DEMO}`);
    gs.buildResults();
    assert.equal(sheet.dump()[2][0], 'Results: Transhumanist Party Demo 2');
    assert.equal(sheet.charts.length, 4);
    assert.ok(sheet.cell(1, 2).validation);
    assert.ok(!sheet.dump().some((r) => r[0] === 'Contest 1: Vice-Chair (choose candidates)'));
  });

  it('says when the chosen election has no results yet', () => {
    const { gs, env } = load();
    env.ss.insertSheet('Results', 1).getRange('B1').setValue(`'Test 2026 · ${OPEN}`);
    gs.buildResults();
    assert.equal(env.ss.getSheetByName('Results').dump()[2][0], 'Test 2026: no results yet (voting is open until 15 Nov 2026, 22:18 UTC).');
    assert.equal(env.ss.toasts.at(-1).message, 'No results published for that election yet.');
  });

  it('picks the first election with results when none is chosen', () => {
    const { gs, env } = load();
    gs.buildResults();
    assert.deepEqual(env.ui.alerts, []);
    assert.equal(env.ss.getSheetByName('Results').dump()[2][0], 'Results: [Demo] 2027 Open Biology Guild Steering Election');
  });
});

describe('Make PDF report', () => {
  it('saves the overview, the results with their summary and charts, and the elections as a PDF, linked from the Overview', () => {
    const { gs, env } = load();
    gs.refreshNumbers();
    env.ss.getSheetByName('Results').getRange('B1').setValue(`'x · ${DEMO}`);
    gs.buildResults();
    gs.makePdfReport();
    assert.deepEqual(env.ui.alerts, []);
    const [file] = env.drive.files;
    assert.match(file.resource.name, /^USTP Vote report \d{4}-\d\d-\d\d \d{4}\.pdf$/);
    assert.deepEqual([file.resource.mimeType, file.media.type, file.media.name, file.optional.fields], ['application/pdf', 'application/pdf', file.resource.name, 'id,webViewLink']);
    const html = file.media.data;
    const order = ['<h2>Overview</h2>', '<h2>Election results</h2>', '<h3>Summary</h3>', '<h3>Contest 1: Chair (ranked choice)</h3>', '<h3>Checks</h3>', '<h2>Elections</h2>'];
    assert.deepEqual(order.map((h) => html.indexOf(h) >= 0), order.map(() => true));
    assert.deepEqual([...order.map((h) => html.indexOf(h))].sort((a, b) => a - b), order.map((h) => html.indexOf(h)));
    assert.ok(html.includes('<p>Chair: Avery Lin won by ranked choice in round 3, with 5 of 9 continuing ballots (55.6%), from 4 first choices (44.4%).'));
    assert.ok(html.includes('<p>&quot;Platform plank: Morphological freedom&quot; passed: 6 yes, 2 no and 1 abstention.'));
    assert.equal(html.match(/<img src="data:image\/png;base64,/g).length, 4);
    // Charts follow their own contest's table.
    assert.ok(html.indexOf('<img') > html.indexOf('<h3>Contest 1: Chair') && html.indexOf('<img') < html.indexOf('<h3>Contest 2: Vice Chair'));
    // The elections table leaves deleted elections out.
    const elections = html.slice(html.indexOf('<h2>Elections</h2>'));
    assert.equal(elections.match(/<tr>/g).length, 4);
    assert.ok(!elections.includes('New Officers'));

    const link = env.ss.getSheetByName('Overview').cell(3, 2).rich;
    assert.deepEqual([link.getText(), link.getLinkUrl()], [file.resource.name, 'https://drive.google.com/file/d/file-1/view']);
    assert.match(env.ui.dialogs.at(-1).html, /Saved to your Drive: <a href="https:\/\/drive\.google\.com\/file\/d\/file-1\/view"/);
  });

  it('keeps the PDF link when the numbers are refreshed', () => {
    const { gs, env } = load();
    gs.refreshNumbers();
    gs.makePdfReport();
    gs.refreshNumbers();
    const overview = env.ss.getSheetByName('Overview');
    assert.equal(overview.cell(3, 2).rich.getLinkUrl(), 'https://drive.google.com/file/d/file-1/view');
    assert.match(overview.dump()[2][2], /^made /);
  });

  it('asks for the numbers first', () => {
    const { gs, env } = load();
    gs.makePdfReport();
    assert.match(env.ui.alerts[0].prompt, /refresh the numbers first/);
    assert.equal(env.drive.files.length, 0);
  });

  it('groups a sheet into headings, paragraphs and tables', () => {
    const { gs } = load();
    const values = [['Title', ''], ['k', 'v'], ['', ''], ['Summary', ''], ['One.', ''], ['Two.', ''], ['', ''], ['Head', 'Er'], ['a', 'b']];
    const bold = values.map((r, i) => r.map(() => (['Title', 'Summary', 'Head'].includes(r[0]) ? 'bold' : 'normal')));
    assert.deepEqual(plain(gs.sheetBlocks_(values, bold, 3)), [
      { row: 3, lastRow: 4, heading: 'Title', rows: [['k', 'v']], headerRow: false },
      { row: 6, lastRow: 8, heading: 'Summary', rows: [['One.'], ['Two.']], headerRow: false },
      { row: 10, lastRow: 11, heading: null, rows: [['Head', 'Er'], ['a', 'b']], headerRow: true },
    ]);
  });
});
