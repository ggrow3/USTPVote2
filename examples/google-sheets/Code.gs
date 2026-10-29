/**
 * USTP Vote numbers in a Google Sheet, from the election site's reporting MCP server (design §3.4) at `<site>/mcp`:
 * MCP's Streamable HTTP transport, JSON-RPC over POST. The server reads only the public record: no sign-in, no token or
 * key, no member data, nothing that writes. The one setting, the site's address, is kept in Script Properties.
 *
 * The USTP Vote menu:
 *  - Refresh numbers: the Overview, Elections, Contest turnout, Rolls and Audit tabs, from list_elections,
 *    get_election_status, get_turnout and get_audit_report.
 *  - Build results for the chosen election: the Results tab, from get_results (the summary, and the CSV, which is where
 *    the tools give each ranked-choice round's counts), with charts and a plain-language summary.
 *  - Make PDF report: the Overview, Results and Elections tabs as a PDF in Drive, linked from the Overview.
 *
 * Titles, descriptions and candidate names are written by election administrators: they go into cells as text, never
 * as formulas, and are escaped in the PDF.
 */

const MENU = 'USTP Vote';
const SITE_PROPERTY = 'USTP_SITE';
/** The MCP revision this client speaks; the server's `initialize` answer says which one it uses. */
const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'ustp-vote-sheets', version: '1.0.0' };
/** Tool calls sent at once (UrlFetchApp.fetchAll): the hosted server runs on at most two small instances. */
const BATCH = 8;
const TAB = {
  overview: 'Overview',
  elections: 'Elections',
  contests: 'Contest turnout',
  rolls: 'Rolls',
  audit: 'Audit',
  results: 'Results',
  lists: 'Lists',
};
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Categorical colours in a fixed order, so a candidate keeps one colour in every round. */
const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
/** Yes and no as opposite poles, abstain a neutral grey. */
const VOTE_COLORS = ['#2a78d6', '#e34948', '#a3a29b'];
/** Rows the Results tab keeps above the results: the election picker. */
const PICKER_ROWS = 2;
/** Default row height in pixels, to keep a chart's rows clear of the next contest. */
const ROW_PX = 21;

// ---------------------------------------------------------------------------------------------------------- menu

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(MENU)
    .addItem('Refresh numbers', 'refreshNumbers')
    .addItem('Build results for the chosen election', 'buildResults')
    .addItem('Make PDF report', 'makePdfReport')
    .addSeparator()
    .addItem('Settings…', 'showSettings')
    .addToUi();
}

function showSettings() {
  const page = HtmlService.createTemplateFromFile('Settings');
  page.site = PropertiesService.getScriptProperties().getProperty(SITE_PROPERTY) || '';
  SpreadsheetApp.getUi().showModalDialog(page.evaluate().setWidth(480).setHeight(250), 'USTP Vote settings');
}

/** From the settings dialog: keeps the site once its MCP server has answered and listed the tools this sheet uses. */
function saveSettings(typed) {
  const origin = siteOrigin_(typed);
  const session = connect_(origin);
  const tools = rpc_(session, 'tools/list', {}).tools.map((t) => t.name);
  const missing = ['list_elections', 'get_election_status', 'get_turnout', 'get_results', 'get_audit_report'].filter((t) => !tools.includes(t));
  if (missing.length) throw new Error(`${origin}/mcp answered, but has no ${missing.join(', ')}`);
  PropertiesService.getScriptProperties().setProperty(SITE_PROPERTY, origin);
  return `Saved. ${session.server.name} ${session.server.version} answered at ${origin}/mcp with ${tools.length} tools.`;
}

function refreshNumbers() {
  run_('Refreshing numbers', () => {
    const ss = SpreadsheetApp.getActive();
    const fmt = dateFormatter_(ss.getSpreadsheetTimeZone());
    const session = connect_(site_());
    const elections = callTool_(session, 'list_elections').data.elections;
    const published = elections.filter((e) => e.state !== 'deleted');
    const answers = callTools_(session, [
      ...published.map((e) => ({ name: 'get_election_status', args: { election_id: e.electionId } })),
      ...published.map((e) => ({ name: 'get_turnout', args: { election_id: e.electionId } })),
      { name: 'get_audit_report', args: {} },
    ]);
    const byElection = (offset) => Object.fromEntries(published.map((e, i) => [e.electionId, answers[offset + i]]));
    const report = { elections, status: byElection(0), turnout: byElection(published.length), audit: answers[2 * published.length] };

    writeOverview_(tab_(ss, TAB.overview), session, overviewFigures_(report, fmt), fmt);
    writeTab_(tab_(ss, TAB.elections), electionsTable_(report, fmt));
    writeTab_(tab_(ss, TAB.contests), contestTurnoutTable_(report));
    writeTab_(tab_(ss, TAB.rolls), rollsTable_(report), { note: ROLLS_NOTE });
    const audit = tab_(ss, TAB.audit);
    const auditRows = auditTable_(report.audit);
    writeTab_(audit, auditRows, { resize: false });
    if (auditRows.length > 3) audit.getRange(4, 1, auditRows.length - 3, 1).setFontFamily('Roboto Mono');
    fillPicker_(ss, pickerOptions_(elections, dateFormatter_(ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd')));
    ss.getSheetByName(TAB.overview).activate();
    return `${published.length} elections read from ${session.endpoint}.`;
  });
}

function buildResults() {
  run_('Building the results', () => {
    const ss = SpreadsheetApp.getActive();
    const sheet = resultsTab_(ss);
    const session = connect_(site_());
    if (!UUID.test(String(sheet.getRange('B1').getValue()))) {
      const day = dateFormatter_(ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
      fillPicker_(ss, pickerOptions_(callTool_(session, 'list_elections').data.elections, day));
    }
    const chosen = UUID.exec(String(sheet.getRange('B1').getValue()));
    if (!chosen) throw new Error('no election has published results yet');
    const id = chosen[0].toLowerCase();
    const [summary, csv] = callTools_(session, [
      { name: 'get_results', args: { election_id: id } },
      { name: 'get_results', args: { election_id: id, format: 'csv' } },
    ]);
    for (const answer of [summary, csv]) if (answer.error) throw new Error(answer.error);
    const fmt = dateFormatter_(ss.getSpreadsheetTimeZone());
    clearResults_(sheet);
    sheet.activate();
    if (!summary.data.published) {
      writeTable_(sheet, PICKER_ROWS + 1, [[`${summary.data.title}: no results yet (${localTimes_(summary.data.stage, fmt)}).`]]);
      return 'No results published for that election yet.';
    }
    writeResults_(sheet, resultsModel_(summary.data, csv.text, fmt));
    return `Results built: ${summary.data.synopsis.title}.`;
  });
}

function makePdfReport() {
  run_('Making the PDF report', () => {
    const ss = SpreadsheetApp.getActive();
    const overview = ss.getSheetByName(TAB.overview);
    if (!overview) throw new Error('refresh the numbers first (USTP Vote › Refresh numbers)');
    const tz = ss.getSpreadsheetTimeZone();
    const now = new Date();
    const name = `USTP Vote report ${Utilities.formatDate(now, tz, 'yyyy-MM-dd HHmm')}.pdf`;
    const results = ss.getSheetByName(TAB.results);
    const html = reportHtml_({
      made: dateFormatter_(tz)(now.toISOString()),
      site: PropertiesService.getScriptProperties().getProperty(SITE_PROPERTY) || '',
      overview: sheetContent_(overview, 4),
      results: results ? sheetContent_(results, PICKER_ROWS) : null,
      elections: sheetValues_(ss.getSheetByName(TAB.elections)),
    });
    const pdf = Utilities.newBlob(html, 'text/html', 'report.html').getAs('application/pdf').setName(name);
    // The Drive advanced service, so the script needs only drive.file: access to the files it creates, nothing else.
    const file = Drive.Files.create({ name, mimeType: 'application/pdf' }, pdf, { fields: 'id,webViewLink' });
    const url = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
    overview.getRange('B3').setRichTextValue(SpreadsheetApp.newRichTextValue().setText(name).setLinkUrl(url).build());
    overview.getRange('C3').setValue(`'made ${dateFormatter_(tz)(now.toISOString())}`);
    const note = HtmlService.createHtmlOutput(
      `<p style="font:14px Arial,sans-serif">Saved to your Drive: <a href="${escapeHtml_(url)}" target="_blank" rel="noopener">` +
        `${escapeHtml_(name)}</a>. The Overview tab links to it.</p>`,
    )
      .setWidth(460)
      .setHeight(110);
    SpreadsheetApp.getUi().showModelessDialog(note, 'PDF report');
    return `Saved ${name}.`;
  });
}

/**
 * Runs a menu action with a toast while it works and an alert if it fails. From a time-driven trigger, which has no
 * UI, a failure is thrown instead, so the trigger's run shows it.
 */
function run_(what, work) {
  const ss = SpreadsheetApp.getActive();
  const toast = (message, seconds) => {
    try {
      ss.toast(message, MENU, seconds);
    } catch (e) {
      // No UI.
    }
  };
  toast(`${what}…`, -1);
  try {
    toast(work() || 'Done.', 5);
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    toast('Failed.', 3);
    let ui;
    try {
      ui = SpreadsheetApp.getUi();
    } catch (noUi) {
      throw e;
    }
    ui.alert(MENU, `${what} failed: ${e && e.message ? e.message : e}`, ui.ButtonSet.OK);
  }
}

function site_() {
  const site = PropertiesService.getScriptProperties().getProperty(SITE_PROPERTY);
  if (!site) throw new Error('set the election site first (USTP Vote › Settings…)');
  return site;
}

/** The site's origin from what was typed: "ustpvote2-dev.web.app", its https address, or its /mcp link. */
function siteOrigin_(typed) {
  const text = String(typed || '').trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  const origin = /^(https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?)(?:[/?#]|$)/i.exec(withScheme);
  if (!origin) throw new Error(`"${text}" is not the https address of an election site, such as https://ustpvote2-dev.web.app`);
  return origin[1].toLowerCase();
}

// ---------------------------------------------------------------------------------------------------- MCP client

/**
 * An MCP session over Streamable HTTP: `initialize`, then `notifications/initialized`, then requests. The server is
 * stateless (design §3.4): it issues no session ID, and every POST stands alone, so tool calls can go out together.
 */
function connect_(origin) {
  const session = { endpoint: `${origin}/mcp`, version: null, server: null };
  const init = rpc_(session, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO });
  session.version = init.protocolVersion || PROTOCOL_VERSION;
  session.server = { name: 'MCP server', version: '', ...init.serverInfo };
  const [notified] = UrlFetchApp.fetchAll([rpcRequest_(session, null, 'notifications/initialized')]);
  if (notified.getResponseCode() >= 300) throw new Error(`${session.endpoint} refused the initialized notification (HTTP ${notified.getResponseCode()})`);
  return session;
}

/** One JSON-RPC request and its result. */
function rpc_(session, method, params) {
  const [response] = UrlFetchApp.fetchAll([rpcRequest_(session, 1, method, params)]);
  return rpcResult_(response, 1);
}

/** A UrlFetchApp request for a JSON-RPC message; a null `id` makes it a notification. */
function rpcRequest_(session, id, method, params) {
  const message = { jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params === undefined ? {} : { params }) };
  const headers = { Accept: 'application/json, text/event-stream' };
  if (session.version) headers['MCP-Protocol-Version'] = session.version;
  return { url: session.endpoint, method: 'post', contentType: 'application/json', payload: JSON.stringify(message), headers, muteHttpExceptions: true };
}

function rpcResult_(response, id) {
  const headers = response.getHeaders();
  const type = Object.keys(headers).find((h) => h.toLowerCase() === 'content-type');
  return rpcAnswer_(response.getResponseCode(), type ? String(headers[type]) : '', response.getContentText(), id);
}

/** The result of JSON-RPC request `id` from an HTTP answer: a JSON body, or an event stream that carries it. */
function rpcAnswer_(status, contentType, body, id) {
  if (status < 200 || status >= 300) throw new Error(`the MCP server answered HTTP ${status}: ${String(body).slice(0, 300)}`);
  let messages;
  try {
    messages = /text\/event-stream/i.test(contentType) ? sseMessages_(body) : [JSON.parse(body)];
  } catch (e) {
    throw new Error(`the MCP server's answer is not JSON-RPC: ${String(body).slice(0, 200)}`);
  }
  const answer = messages.flat().find((m) => m && m.id === id);
  if (!answer) throw new Error(`the MCP server sent no answer to request ${id}`);
  if (answer.error) throw new Error(`MCP error ${answer.error.code}: ${answer.error.message}`);
  return answer.result;
}

/** The JSON messages in a server-sent event stream: each event's `data:` lines. */
function sseMessages_(text) {
  return String(text)
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n'),
    )
    .filter((data) => data.trim() !== '')
    .map((data) => JSON.parse(data));
}

/**
 * Tool calls, sent together a batch at a time, answered in order: each `{data, text}` (the tool's JSON, and its second
 * text block if any: the results CSV or the audit report), or `{error}` (a tool error, such as an unpublished election).
 */
function callTools_(session, calls) {
  const answers = [];
  for (let i = 0; i < calls.length; i += BATCH) {
    const batch = calls.slice(i, i + BATCH);
    const requests = batch.map((call, j) => rpcRequest_(session, i + j + 1, 'tools/call', { name: call.name, arguments: call.args || {} }));
    UrlFetchApp.fetchAll(requests).forEach((response, j) => {
      try {
        answers.push(toolAnswer_(batch[j].name, rpcResult_(response, i + j + 1)));
      } catch (e) {
        answers.push({ error: e.message });
      }
    });
  }
  return answers;
}

function callTool_(session, name, args) {
  const [answer] = callTools_(session, [{ name, args }]);
  if (answer.error) throw new Error(answer.error);
  return answer;
}

/** A tool's answer: its first text block as JSON, the second as text. A tool error throws, with the tool's words. */
function toolAnswer_(name, result) {
  const texts = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text);
  if (result.isError) throw new Error(`${name}: ${texts.join(' ') || 'the tool failed'}`);
  return { data: texts.length ? JSON.parse(texts[0]) : result.structuredContent || {}, text: texts.length > 1 ? texts[1] : null };
}

// --------------------------------------------------------------------------------------------------- the numbers

const ROLLS_NOTE =
  'The MCP server serves no member data (design §3.4). A real election’s roll is the count of Active members when it ' +
  'was frozen: the public record’s only membership figure. Rehearsal rolls hold test voters only.';

/** The data of an answer, or null if the call failed. */
function ok_(answer) {
  return answer && !answer.error ? answer.data : null;
}

/** The Overview's figures: real elections only, rehearsals and deleted elections counted apart. */
function overviewFigures_(report, fmt) {
  const listed = report.elections.filter((e) => e.state !== 'deleted');
  const real = listed.filter((e) => !e.rehearsal);
  const states = ['scheduled', 'open', 'closed', 'certified', 'cancelled']
    .map((state) => [state, real.filter((e) => e.state === state).length])
    .filter(([, n]) => n > 0)
    .map(([state, n]) => `${n} ${state}`);
  const rows = [
    ['Real elections', real.length, states.join(', ') || 'none published yet'],
    ['Rehearsals', listed.length - real.length, 'test voters only: left out of the figures below'],
    ['Deleted elections', report.elections.length - listed.length, 'only their ledger entries remain public'],
  ];
  // Newest first, as list_elections orders them.
  const rolled = real.map((e) => ({ e, status: ok_(report.status[e.electionId]) })).find(({ status }) => status && status.roll);
  rows.push(
    rolled
      ? ['Active members on the latest roll', rolled.status.roll.size, `the roll of ${rolled.e.title}, frozen ${fmt(rolled.status.roll.asOf)}`]
      : ['Active members on the latest roll', '', 'no real election yet, and member data itself is not public'],
  );
  const turnouts = real.map((e) => ok_(report.turnout[e.electionId])).filter(Boolean);
  rows.push([
    'Ballots in real elections',
    turnouts.reduce((n, t) => n + t.ballots, 0),
    turnouts.some((t) => !t.exact) ? 'a lower bound while voting is open: only sealed ballots are public' : 'counted or sealed ballots',
  ]);
  const counted = real.find((e) => e.results && ok_(report.turnout[e.electionId]));
  const turnout = counted && ok_(report.turnout[counted.electionId]);
  rows.push(
    turnout
      ? ['Turnout, latest real results', turnout.turnoutPercent || '', `${counted.title}: ${turnout.ballots} of ${turnout.rollSize} voters`]
      : ['Turnout, latest real results', '', 'no real election has published results yet'],
  );
  const provisional = real.filter((e) => e.results === 'provisional').length;
  rows.push(['Results certified', real.filter((e) => e.results === 'certified').length, `${provisional} provisional, awaiting two Election Admins`]);
  const audit = ok_(report.audit);
  rows.push(
    audit
      ? ['Public ledger audit', audit.verified ? 'verified' : 'FAILED', `the whole public ledger: ${audit.passed} passed, ${audit.failed} failed, ${audit.pending} pending (Audit tab)`]
      : ['Public ledger audit', 'not run', report.audit.error],
  );
  return rows;
}

function electionsTable_(report, fmt) {
  const rows = [
    ['Election', 'State', 'Rehearsal', 'Voting opens', 'Voting closes', 'Voters on the roll', 'Ballots', 'Turnout', 'Turnout exact',
      'Results', 'Results hash', 'Results page', 'Election ID', 'Where it stands'],
  ];
  for (const e of report.elections) {
    const status = ok_(report.status[e.electionId]);
    const turnout = ok_(report.turnout[e.electionId]);
    const failed = [report.status[e.electionId], report.turnout[e.electionId]].find((a) => a && a.error);
    rows.push([
      e.title,
      e.state,
      yesNo_(e.rehearsal),
      date_(e.opensAt),
      date_(e.closesAt),
      count_(e.rollSize),
      count_(turnout ? turnout.ballots : e.ballotsSealed),
      (turnout && turnout.turnoutPercent) || '',
      turnout ? (turnout.exact ? 'yes' : 'no: a lower bound') : '',
      e.results || '',
      status && status.results ? status.results.resultsHash : '',
      status ? { text: 'results page', url: status.links.resultsPage } : '',
      e.electionId,
      failed ? `could not read: ${failed.error}` : status ? localTimes_(status.stage, fmt) : 'deleted: only its ledger entry is public',
    ]);
  }
  return rows;
}

function contestTurnoutTable_(report) {
  const rows = [['Election', 'Rehearsal', 'Contest', 'Kind', 'Ballots', 'Invalid', 'Blank', 'Abstain', 'Quorum']];
  for (const e of report.elections) {
    const turnout = ok_(report.turnout[e.electionId]);
    for (const c of (turnout && turnout.contests) || []) {
      const proposal = 'abstain' in c;
      const quorum = c.quorum ? `${c.quorum.met ? 'met' : 'not met'}: ${c.ballots} of ${c.quorum.required} needed` : proposal ? 'none' : '';
      rows.push([e.title, yesNo_(e.rehearsal), c.title, c.kind, c.ballots, c.invalid, count_(c.blank), count_(c.abstain), quorum]);
    }
  }
  return rows;
}

function rollsTable_(report) {
  const rows = [['Election', 'Rehearsal', 'State', 'Roll frozen', 'Voters on the roll', 'Who']];
  for (const e of report.elections) {
    const status = ok_(report.status[e.electionId]);
    if (status && status.roll) rows.push([e.title, yesNo_(e.rehearsal), e.state, date_(status.roll.asOf), status.roll.size, status.roll.voters]);
  }
  return rows;
}

/** The whole-ledger audit's counts, then its report a line a row. */
function auditTable_(audit) {
  if (!ok_(audit)) return [['The audit report could not be made'], [audit.error]];
  const { verified, passed, failed, pending } = audit.data;
  return [
    ['Verified', 'Passed', 'Failed', 'Pending'],
    [verified ? 'yes' : 'NO', passed, failed, pending],
    [],
    ...String(audit.text || '').split(/\r?\n/).map((line) => [line]),
  ];
}

/** Picker entries for elections with published results: real ones first, then rehearsals, newest first in each. */
function pickerOptions_(elections, day) {
  const label = (e) =>
    [e.title, e.opensAt ? day(e.opensAt) : '', e.results, e.rehearsal ? 'rehearsal' : '', e.electionId].filter(Boolean).join(' · ');
  const withResults = elections.filter((e) => e.results);
  return [...withResults.filter((e) => !e.rehearsal), ...withResults.filter((e) => e.rehearsal)].map(label);
}

// --------------------------------------------------------------------------------------------------- the results

/**
 * The Results tab for one election: facts, a plain-language summary, a block per contest (a table, and a chart beside
 * it) and the results check. From get_results' summary (synopsis, verification, hash) and its CSV, which is where the
 * tools give the counts in each ranked-choice round.
 */
function resultsModel_(summary, csv, fmt) {
  const s = summary.synopsis;
  const csvContests = csvContests_(parseCsv_(csv || ''));
  const verification = { verified: 'verified', failed: 'FAILED', pending: 'not finished: try again in a minute' }[summary.verification.status];
  return {
    title: `Results: ${s.title}`,
    facts: [
      ['Status', s.status === 'certified' ? 'Certified' : 'Provisional', summary.statusMeaning],
      ['Rehearsal', summary.rehearsal ? 'yes' : 'no', summary.rehearsal ? 'test voters only: not a real election' : ''],
      ['Voting', `${fmt(s.opensAt)} to ${fmt(s.closesAt)}`, ''],
      ['Turnout', `${s.turnout.count} of ${s.turnout.of}`, s.turnout.percent || ''],
      ['Counted', fmt(s.computedAt), ''],
      ['Certified', s.certifiedAt ? fmt(s.certifiedAt) : 'not yet', ''],
      ['Results check', verification || summary.verification.status, 'from public data: hash, signature, a full re-tally, the ledger'],
      ['Results hash', summary.resultsHash, ''],
      ['Results page', { text: summary.links.resultsPage, url: summary.links.resultsPage }, ''],
    ],
    summary: resultsSummary_(summary, csvContests, fmt),
    contests: s.contests.map((c) => contestBlock_(c, csvContests[c.contestId])),
    checks: [
      ['Check', 'Result', 'Detail'],
      ...summary.verification.steps.map((step) => [step.label, step.ok === true ? 'ok' : step.ok === false ? 'FAIL' : 'wait', step.detail || '']),
    ],
  };
}

const KIND_LABEL = { irv: 'ranked choice', choose_n: 'choose candidates', proposal: 'proposal' };

/**
 * One contest's table (`header`: its first row is one) and chart. A chart's size is in rows and columns of the table,
 * from its top left cell.
 */
function contestBlock_(c, csvRows) {
  const heading = `Contest ${c.number}: ${c.title} (${KIND_LABEL[c.kind]})`;
  switch (c.kind) {
    case 'irv': {
      const rounds = irvRounds_(csvRows);
      const footer = [['Ballots', c.ballots], ['Blank', c.blank.count], ['Invalid', c.invalid], ['Elected', c.winner ? c.winner.name : 'nobody']];
      if (!rounds) return { heading, table: footer, header: false, chart: null };
      return {
        heading,
        header: true,
        table: [rounds.header, ...rounds.candidates, ['Continuing ballots', ...rounds.continuing], ['Exhausted', ...rounds.exhausted],
          ['Round result', ...rounds.results], ...footer],
        chart: {
          type: 'column', rows: 1 + rounds.candidates.length, cols: rounds.header.length, transpose: true, legend: true,
          title: `Votes in each round: ${c.title}`, colors: SERIES_COLORS.slice(0, rounds.candidates.length),
        },
      };
    }
    case 'choose_n':
      return {
        heading,
        header: true,
        table: [
          ['Candidate', 'Votes', 'Share of ballots', 'Elected'],
          ...c.candidates.map((k) => [k.name, k.votes.count, k.votes.percent || '', k.elected ? 'elected' : '']),
          ['Blank', c.blank.count, c.blank.percent || '', ''],
          ['Invalid', c.invalid, '', ''],
          ['Seats', c.seats, '', c.vacantSeats ? `${c.vacantSeats} vacant` : ''],
        ],
        chart: { type: 'bar', rows: 1 + c.candidates.length, cols: 2, title: `Votes: ${c.title}`, colors: SERIES_COLORS.slice(0, 1) },
      };
    case 'proposal':
      return {
        heading,
        header: true,
        table: [
          ['Choice', 'Votes', 'Share of ballots'],
          ['Yes', c.yes.count, c.yes.percent || ''],
          ['No', c.no.count, c.no.percent || ''],
          ['Abstain', c.abstain.count, c.abstain.percent || ''],
          ['Outcome', OUTCOME[c.outcome], ''],
          ['Needed', c.passRule.rule, c.passRule.yesShare ? `yes had ${c.passRule.yesShare}` : ''],
          ['Quorum', c.quorum ? `${c.ballots} of ${c.quorum.required} needed` : 'none', c.quorum ? (c.quorum.met ? 'met' : 'not met') : ''],
        ],
        chart: {
          type: 'bar', rows: 4, cols: 2, transpose: true, stacked: 'percent', legend: true, height: 160,
          title: `Yes, no and abstain: ${c.title}`, colors: VOTE_COLORS,
        },
      };
    default:
      return { heading, table: [['Ballots', c.ballots]], header: false, chart: null };
  }
}

const OUTCOME = { passed: 'Passed', failed: 'Failed', no_quorum: 'No quorum' };

/** The plain-language summary, a sentence or two a line. */
function resultsSummary_(summary, csvContests, fmt) {
  const s = summary.synopsis;
  const lines = [
    s.status === 'certified'
      ? `${s.title}: certified results, approved by two Election Admins ${fmt(s.certifiedAt)}.`
      : `${s.title}: provisional results, counted ${fmt(s.computedAt)} and not yet certified by two Election Admins.`,
  ];
  if (summary.rehearsal) lines.push('This was a rehearsal with test voters only, not a real election.');
  lines.push(`${s.turnout.count} of the ${plural_(s.turnout.of, 'voter', 'voters')} on the roll cast a ballot${s.turnout.percent ? ` (${s.turnout.percent} turnout)` : ''}.`);
  for (const c of s.contests) lines.push(contestSentence_(c, csvContests[c.contestId]));
  lines.push(tallySentence_(s.tally));
  lines.push(verificationSentence_(summary.verification));
  lines.push(`Results hash: ${summary.resultsHash}.`);
  return lines;
}

function contestSentence_(c, csvRows) {
  const blank = c.blank && c.blank.count ? ` ${plural_(c.blank.count, 'ballot', 'ballots')} left it blank.` : '';
  switch (c.kind) {
    case 'irv': {
      if (!c.winner) return `${c.title}: nobody was elected, as no ballot ranked a candidate.${blank}`;
      const { firstRound: first, finalRound: final } = c.winner;
      let text =
        c.rounds === 1
          ? `${c.title}: ${c.winner.name} won by ranked choice in the first round, with ${first.count} of ${first.of} first choices${pct_(first)}.`
          : `${c.title}: ${c.winner.name} won by ranked choice in round ${c.rounds}, with ${final.count} of ${final.of} continuing ballots` +
            `${pct_(final)}, from ${first.count} first ${first.count === 1 ? 'choice' : 'choices'}${pct_(first)}.`;
      const rounds = irvRounds_(csvRows);
      const out = rounds ? rounds.results.filter((r) => / eliminated$/.test(r)).map((r) => r.replace(/ eliminated$/, '')) : [];
      if (out.length) text += ` ${list_(out)} ${out.length === 1 ? 'was eliminated' : 'were eliminated in turn'}.`;
      return text + blank;
    }
    case 'choose_n': {
      const elected = c.candidates.filter((k) => k.elected).map((k) => `${k.name} (${k.votes.count} of ${plural_(k.votes.of, 'ballot', 'ballots')}${pct_(k.votes, ', ')})`);
      const seats = c.seats === 1 ? '' : ` to ${elected.length === c.seats ? 'its' : `${elected.length} of its`} ${c.seats} seats`;
      let text = elected.length
        ? `${c.title}: ${list_(elected)} ${elected.length === 1 ? 'was' : 'were'} elected${seats}.`
        : `${c.title}: nobody was elected.`;
      if (c.vacantSeats) text += ` ${c.vacantSeats} ${c.vacantSeats === 1 ? 'seat was' : 'seats were'} left vacant.`;
      return text + blank;
    }
    case 'proposal': {
      const outcome = { passed: 'passed', failed: 'failed', no_quorum: 'did not reach its quorum' }[c.outcome];
      let text = `"${c.title}" ${outcome}: ${c.yes.count} yes, ${c.no.count} no and ${plural_(c.abstain.count, 'abstention', 'abstentions')}.`;
      if (c.outcome === 'no_quorum' && c.quorum) text += ` It needed ${plural_(c.quorum.required, 'ballot', 'ballots')} and had ${c.ballots}.`;
      else if (c.passRule.yesShare) text += ` Yes had ${c.passRule.yesShare}; passing needed ${c.passRule.rule}.`;
      return text;
    }
    default:
      return `${c.title}: ${plural_(c.ballots, 'ballot', 'ballots')}.`;
  }
}

function tallySentence_(tally) {
  const k = tally.candidateContests;
  const p = tally.proposals;
  const parts = [];
  if (k.total) parts.push(`${k.elected} of ${plural_(k.seats, 'seat', 'seats')} filled${k.vacantSeats ? `, ${k.vacantSeats} left vacant` : ''}`);
  if (p.total) parts.push(`${p.passed} of ${plural_(p.total, 'proposal', 'proposals')} passed${p.noQuorum ? `, ${p.noQuorum} without a quorum` : ''}`);
  return parts.length ? `In all: ${parts.join('; ')}.` : 'There were no contests.';
}

function verificationSentence_(verification) {
  const labels = (ok) => verification.steps.filter((step) => step.ok === ok).map((step) => step.label.replace(/\.$/, ''));
  switch (verification.status) {
    case 'verified':
      return 'The results verified from public data: their hash, the audit signature, a full re-tally of the sealed ballots and the ledger all check out.';
    case 'pending':
      return `The results check is not finished (${labels(null).join('; ') || 'waiting for the ledger'}): the ledger is signed every minute, so try again shortly.`;
    default:
      return `WARNING: the published results did not verify (${labels(false).join('; ') || 'see the checks below'}).`;
  }
}

/** The results CSV's contests, by contest ID: each one's rows, from its "Contest" row to the blank row after it. */
function csvContests_(rows) {
  const contests = {};
  let current = null;
  for (const row of rows) {
    const cells = trimRow_(row);
    if (!cells.length) current = null;
    else if (cells[0] === 'Contest') current = [cells];
    else if (current && cells[0] === 'Contest ID') contests[cells[1]] = current;
    else if (current) current.push(cells);
  }
  return contests;
}

/** A ranked-choice contest's rounds from its CSV rows: candidates by round, continuing, exhausted, what each round did. */
function irvRounds_(csvRows) {
  if (!csvRows) return null;
  const start = csvRows.findIndex((r) => r[0] === 'Candidate' && /^Round \d+$/.test(String(r[1])));
  const end = csvRows.findIndex((r) => r[0] === 'Continuing ballots');
  if (start < 0 || end < start) return null;
  const header = csvRows[start];
  const width = header.length;
  const row = (label) => {
    const found = csvRows.find((r) => r[0] === label);
    return Array.from({ length: width - 1 }, (_, i) => (found && found[i + 1] !== undefined ? found[i + 1] : ''));
  };
  return {
    header,
    candidates: csvRows.slice(start + 1, end).map((r) => Array.from({ length: width }, (_, i) => (r[i] !== undefined ? r[i] : ''))),
    continuing: row('Continuing ballots'),
    exhausted: row('Exhausted'),
    results: row('Round result'),
  };
}

/** RFC 4180 CSV: quoted cells, doubled quotes, CRLF or LF. Whole numbers become numbers; a formula guard (') goes. */
function parseCsv_(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  const end = () => {
    row.push(wasQuoted ? cell : csvValue_(cell));
    cell = '';
    wasQuoted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (ch === ',') end();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      end();
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    end();
    rows.push(row);
  }
  return rows.map((r) => r.map((v) => (typeof v === 'string' && /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v)));
}

function csvValue_(text) {
  return /^\d+$/.test(text) && text.length < 16 ? Number(text) : text;
}

function trimRow_(row) {
  const cells = row.slice();
  while (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

// ------------------------------------------------------------------------------------------------------ the PDF

/** A sheet's display values from `fromRow` down, with which cells are bold, and its charts as PNGs by anchor row. */
function sheetContent_(sheet, fromRow) {
  const last = sheet.getLastRow();
  if (last <= fromRow) return { blocks: [], charts: [] };
  const range = sheet.getRange(fromRow + 1, 1, last - fromRow, Math.max(sheet.getLastColumn(), 1));
  const blocks = sheetBlocks_(range.getDisplayValues(), range.getFontWeights(), fromRow + 1);
  const charts = sheet.getCharts().map((chart) => ({
    row: chart.getContainerInfo().getAnchorRow(),
    png: Utilities.base64Encode(chart.getAs('image/png').getBytes()),
  }));
  return { blocks, charts };
}

function sheetValues_(sheet) {
  return sheet && sheet.getLastRow() > 0 ? sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues() : [];
}

/**
 * Runs of non-empty rows, cells trimmed at the right: a run that opens with a lone bold cell is headed by it; its other
 * rows are paragraphs when each holds one cell, otherwise a table whose first row is its header when bold.
 */
function sheetBlocks_(values, weights, firstRow) {
  const blocks = [];
  let block = null;
  values.forEach((row, i) => {
    const cells = trimRow_(row.map((v) => String(v)));
    if (!cells.length) return (block = null);
    const bold = cells.every((v, j) => v === '' || weights[i][j] === 'bold');
    if (!block) {
      block = { row: firstRow + i, lastRow: firstRow + i, heading: null, rows: [], headerRow: false };
      blocks.push(block);
      if (cells.length === 1 && bold) return (block.heading = cells[0]);
    }
    if (!block.rows.length) block.headerRow = bold && cells.length > 1;
    block.rows.push(cells);
    block.lastRow = firstRow + i;
  });
  return blocks;
}

/** The report as HTML for Drive's PDF conversion: plain tables, inline images, no scripts or external files. */
function reportHtml_(report) {
  const parts = [
    '<html><head><meta charset="utf-8"><style>',
    'body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#0b0b0b}',
    'h1{font-size:18pt;margin:0 0 4pt}h2{font-size:14pt;margin:18pt 0 6pt;border-bottom:1px solid #c3c2b7;padding-bottom:2pt}',
    'h3{font-size:11pt;margin:12pt 0 4pt}p{margin:0 0 5pt;line-height:1.35}.muted{color:#52514e}',
    'table{border-collapse:collapse;margin:0 0 8pt}th,td{border:1px solid #e1e0d9;padding:3pt 6pt;text-align:left;vertical-align:top}',
    'th{background:#f0efec}td.n{text-align:right}img{width:440px;margin:2pt 0 10pt}',
    '</style></head><body>',
    '<h1>USTP Vote report</h1>',
    `<p class="muted">Made ${escapeHtml_(report.made)} from the public record at ${escapeHtml_(report.site)}, through its reporting MCP ` +
      'server: nothing private (no voter names or choices, no member data). Figures for real elections leave rehearsals out.</p>',
    '<h2>Overview</h2>',
    blocksHtml_(report.overview.blocks, []),
  ];
  const results = report.results && report.results.blocks.length ? report.results : null;
  parts.push('<h2>Election results</h2>');
  parts.push(results ? blocksHtml_(results.blocks, results.charts) : '<p>No election’s results are on the Results tab yet.</p>');
  const elections = pickColumns_(report.elections, ['Election', 'State', 'Rehearsal', 'Voting opens', 'Voting closes', 'Voters on the roll', 'Ballots', 'Turnout', 'Results']);
  const listed = elections.slice(1).filter((r) => r[1] !== 'deleted');
  parts.push('<h2>Elections</h2>');
  parts.push(listed.length ? tableHtml_([elections[0], ...listed], true) : '<p>No elections are published yet.</p>');
  parts.push('</body></html>');
  return parts.join('\n');
}

function blocksHtml_(blocks, charts) {
  return blocks
    .map((block) => {
      const html = [];
      if (block.heading) html.push(`<h3>${escapeHtml_(block.heading)}</h3>`);
      if (block.rows.length && block.rows.every((r) => r.length === 1)) html.push(...block.rows.map((r) => `<p>${escapeHtml_(r[0])}</p>`));
      else if (block.rows.length) html.push(tableHtml_(block.rows, block.headerRow));
      for (const chart of charts.filter((c) => c.row >= block.row && c.row <= block.lastRow)) {
        html.push(`<img src="data:image/png;base64,${chart.png}" alt="">`);
      }
      return html.join('\n');
    })
    .join('\n');
}

function tableHtml_(rows, headerRow) {
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r, tag) =>
    '<tr>' +
    Array.from({ length: width }, (_, i) => {
      const v = r[i] === undefined ? '' : String(r[i]);
      const numeric = tag === 'td' && /^-?[\d,]+(\.\d+)?%?$/.test(v);
      return `<${tag}${numeric ? ' class="n"' : ''}>${escapeHtml_(v)}</${tag}>`;
    }).join('') +
    '</tr>';
  return `<table>${rows.map((r, i) => line(r, headerRow && i === 0 ? 'th' : 'td')).join('')}</table>`;
}

/** The named columns of a table whose first row is its header, in that order. */
function pickColumns_(values, names) {
  if (!values.length) return [];
  const at = names.map((n) => values[0].indexOf(n));
  return values.map((r) => at.map((i) => (i < 0 ? '' : r[i])));
}

function escapeHtml_(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// ------------------------------------------------------------------------------------------------- the sheet tabs

function tab_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name, ss.getNumSheets());
}

/** The Results tab, with its picker row. */
function resultsTab_(ss) {
  const sheet = tab_(ss, TAB.results);
  sheet.getRange('A1').setValue('Election').setFontWeight('bold');
  sheet.getRange('C1').setValue('Pick an election, then USTP Vote › Build results for the chosen election.').setFontColor('#52514e');
  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 360);
  return sheet;
}

/**
 * Fills the picker (Results!B1): a dropdown over a range on the hidden Lists tab, so an entry can be any title as
 * written. A chosen election stays chosen; otherwise the first entry is.
 */
function fillPicker_(ss, options) {
  const lists = tab_(ss, TAB.lists);
  lists.clear();
  lists.getRange(1, 1).setValue('Elections with published results');
  if (options.length) lists.getRange(2, 1, options.length, 1).setValues(options.map((o) => [cellValue_(o)]));
  if (!lists.isSheetHidden()) lists.hideSheet();
  const cell = resultsTab_(ss).getRange('B1');
  const chosen = UUID.exec(String(cell.getValue()));
  const keep = chosen && options.find((o) => o.includes(chosen[0].toLowerCase()));
  cell.clearDataValidations();
  cell.setValue(cellValue_(keep || options[0] || ''));
  if (options.length) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(lists.getRange(2, 1, options.length, 1), true)
      .setAllowInvalid(false)
      .setHelpText('An election whose results are published. USTP Vote › Refresh numbers updates this list.')
      .build();
    cell.setDataValidation(rule);
  }
}

function clearResults_(sheet) {
  for (const chart of sheet.getCharts()) sheet.removeChart(chart);
  const rows = sheet.getMaxRows() - PICKER_ROWS;
  if (rows > 0) sheet.getRange(PICKER_ROWS + 1, 1, rows, sheet.getMaxColumns()).clear();
}

function writeResults_(sheet, model) {
  let row = PICKER_ROWS + 1;
  sheet.getRange(row, 1).setValue(cellValue_(model.title)).setFontWeight('bold').setFontSize(14);
  row = writeTable_(sheet, row + 1, model.facts);
  sheet.getRange(PICKER_ROWS + 2, 1, model.facts.length, 1).setFontWeight('bold');
  row += 1;
  sheet.getRange(row, 1).setValue('Summary').setFontWeight('bold');
  row = writeTable_(sheet, row + 1, model.summary.map((line) => [line])) + 1;
  for (const block of model.contests) {
    sheet.getRange(row, 1).setValue(cellValue_(block.heading)).setFontWeight('bold');
    const top = row + 1;
    const end = writeTable_(sheet, top, block.table, { header: block.header });
    let chartEnd = end;
    if (block.chart) {
      const col = Math.max(block.table[0].length + 2, 6);
      addChart_(sheet, sheet.getRange(top, 1, block.chart.rows, block.chart.cols), top, col, block.chart);
      chartEnd = top + Math.ceil((block.chart.height || 300) / ROW_PX);
    }
    row = Math.max(end, chartEnd) + 1;
  }
  sheet.getRange(row, 1).setValue('Checks').setFontWeight('bold');
  writeTable_(sheet, row + 1, model.checks, { header: true });
}

function addChart_(sheet, range, row, col, spec) {
  let chart = sheet
    .newChart()
    .setChartType(spec.type === 'bar' ? Charts.ChartType.BAR : Charts.ChartType.COLUMN)
    .addRange(range)
    .setNumHeaders(1)
    .setTransposeRowsAndColumns(!!spec.transpose)
    .setPosition(row, col, 0, 0)
    .setOption('title', spec.title)
    .setOption('colors', spec.colors)
    .setOption('legend', { position: spec.legend ? 'bottom' : 'none' })
    .setOption('width', 520)
    .setOption('height', spec.height || 300);
  if (spec.stacked) chart = chart.setOption('isStacked', spec.stacked);
  sheet.insertChart(chart.build());
}

function writeOverview_(sheet, session, figures, fmt) {
  const pdf = sheet.getRange('B3').getRichTextValue();
  const made = sheet.getRange('C3').getValue();
  sheet.clear();
  sheet.getRange('A1').setValue('USTP Vote numbers').setFontWeight('bold').setFontSize(14);
  sheet.getRange('A2').setValue(
    cellValue_(`From ${session.endpoint} (${session.server.name} ${session.server.version}), refreshed ${fmt(new Date().toISOString())}. ` +
      'The public record only: no voter names or choices, no member data.'),
  ).setFontColor('#52514e');
  sheet.getRange('A3').setValue('Report PDF').setFontWeight('bold');
  if (pdf && pdf.getText()) {
    sheet.getRange('B3').setRichTextValue(pdf);
    sheet.getRange('C3').setValue(cellValue_(String(made)));
  } else sheet.getRange('B3').setValue('not made yet: USTP Vote › Make PDF report');
  writeTable_(sheet, 5, [['Figure', 'Value', 'Notes'], ...figures], { header: true });
  sheet.getRange(6, 1, figures.length, 1).setFontWeight('bold');
  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 140);
}

/**
 * A whole tab: a table with a bold, frozen header, its columns sized to fit (`resize`, by default), under an optional
 * note.
 */
function writeTab_(sheet, rows, options) {
  const { note, resize = true } = options || {};
  sheet.clear();
  const top = note ? 3 : 1;
  writeTable_(sheet, top, rows, { header: true });
  sheet.setFrozenRows(top);
  // Sized before the note is written, so the note overflows its cell rather than widening the first column.
  if (resize && rows.length) sheet.autoResizeColumns(1, rows[0].length);
  if (note) sheet.getRange('A1').setValue(cellValue_(note)).setFontColor('#52514e');
}

/**
 * Writes rows, padded to one width, from (row, 1): strings as text (never formulas or numbers), dates as dates,
 * `{text, url}` as links. Returns the row after them.
 */
function writeTable_(sheet, row, rows, options) {
  if (!rows.length) return row;
  const width = Math.max(1, ...rows.map((r) => r.length));
  const values = rows.map((r) => Array.from({ length: width }, (_, i) => cellValue_(r[i])));
  sheet.getRange(row, 1, rows.length, width).setValues(values);
  rows.forEach((r, i) =>
    r.forEach((v, j) => {
      if (v && typeof v === 'object' && v.url) {
        sheet.getRange(row + i, 1 + j).setRichTextValue(SpreadsheetApp.newRichTextValue().setText(v.text).setLinkUrl(v.url).build());
      }
      if (v instanceof Date) sheet.getRange(row + i, 1 + j).setNumberFormat('yyyy-mm-dd hh:mm');
    }),
  );
  if (options && options.header) sheet.getRange(row, 1, 1, width).setFontWeight('bold');
  return row + rows.length;
}

/** A value for setValues: a leading apostrophe keeps a string text, so "=..." from an election title never runs. */
function cellValue_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date || typeof v === 'number') return v;
  if (typeof v === 'boolean') return yesNo_(v);
  return `'${typeof v === 'object' ? v.text : v}`;
}

// ------------------------------------------------------------------------------------------------------- helpers

/** `iso → text` in the spreadsheet's time zone; empty for none. */
function dateFormatter_(tz, pattern) {
  return (iso) => (iso ? Utilities.formatDate(new Date(iso), tz, pattern || 'd MMM yyyy, HH:mm z') : '');
}

/** The server's sentences give times as ISO timestamps: these, in the sheet's time zone. */
function localTimes_(text, fmt) {
  return String(text).replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, (iso) => fmt(iso));
}

function date_(iso) {
  return iso ? new Date(iso) : '';
}

function count_(n) {
  return typeof n === 'number' ? n : '';
}

function yesNo_(b) {
  return b ? 'yes' : 'no';
}

function plural_(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** " (44.4%)", or nothing when a share has no percentage (a whole of zero). */
function pct_(share, before) {
  return share && share.percent ? (before ? `${before}${share.percent}` : ` (${share.percent})`) : '';
}

function list_(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
