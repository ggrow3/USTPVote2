# Google Sheets: election numbers, results and a PDF report

An Apps Script for a Google Sheet that reads the USTP Vote site's **reporting MCP server** (`apps/mcp`, design §3.4)
at `<site>/mcp`, on dev `https://ustpvote2-dev.web.app/mcp`. It calls the server's tools over MCP's Streamable HTTP
transport, as JSON-RPC requests (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`) sent with
`UrlFetchApp`, and adds a **USTP Vote** menu:

| Menu item | What it does |
|---|---|
| **Refresh numbers** | Fills the Overview, Elections, Contest turnout, Rolls and Audit tabs, and the Results tab's list of elections |
| **Build results for the chosen election** | Fills the Results tab for the election picked in its cell B1: facts, a plain-language summary, a table and a chart per contest, and the results check |
| **Make PDF report** | Saves the Overview, the Results tab (summary and charts included) and the elections as a PDF in your Drive, and links it from the Overview |
| **Settings…** | The site's address, tested and kept in Script Properties |

The server is public and read-only: no sign-in, **no token or API key**, nothing that writes. So the only setting is
the site's address, and there is nothing secret to keep. It is still kept in Script Properties, set from the Settings
dialog, never in the code.

## Files

| File | In the Apps Script editor |
|---|---|
| `Code.gs` | the script file `Code.gs` |
| `Settings.html` | an HTML file named `Settings` |
| `appsscript.json` | the manifest: the OAuth scopes and the Drive advanced service |
| `test/` | not pasted: tests that run `Code.gs` in Node (see [Testing](#testing)) |

## Set it up

1. Make a Google Sheet ([sheets.new](https://sheets.new)).
2. **Extensions › Apps Script**.
3. In the editor, **Project Settings** (the gear): tick **Show "appsscript.json" manifest file in editor**.
4. Back in **Editor**:
   - Replace the contents of `Code.gs` with this folder's `Code.gs`.
   - Replace the contents of `appsscript.json` with this folder's. Its `timeZone` does not matter: dates are shown in
     the spreadsheet's own time zone (**File › Settings** in the sheet).
   - **+ › HTML**, name it `Settings` (the editor adds `.html`), and paste `Settings.html`.
   - Save (Ctrl+S).
5. Reload the sheet. A **USTP Vote** menu appears after a few seconds.
6. **USTP Vote › Settings…**. The first time, Google asks you to authorize the script (see [Permissions](#permissions));
   a script you made yourself shows "Google hasn't verified this app": choose **Advanced › Go to (project name)**, allow,
   then choose **USTP Vote › Settings…** again. Enter the site, e.g. `https://ustpvote2-dev.web.app` (the bare host or
   the `/mcp` link work too), and **Test and save**: it saves the site only once the server has answered and listed the
   five tools the sheet uses.
7. **USTP Vote › Refresh numbers**.
8. On the **Results** tab, pick an election in **B1** (only elections with published results are listed), then
   **USTP Vote › Build results for the chosen election**. With none picked, it takes the newest real election with
   results, else the newest rehearsal.
9. **USTP Vote › Make PDF report**. The PDF goes to the top of your My Drive; the Overview's **Report PDF** cell (B3)
   links to it, and each run makes a new one.

To keep the numbers fresh without the menu, add a time-driven trigger in the editor (**Triggers › Add Trigger**,
function `refreshNumbers`, time-driven, e.g. every hour). From a trigger there is no toast or alert; a failure shows
in the trigger's executions.

## Permissions

`appsscript.json` asks for these scopes and nothing else:

| Scope | Why |
|---|---|
| `spreadsheets.currentonly` | read and write this spreadsheet only |
| `script.container.ui` | the menu, the Settings dialog, alerts |
| `script.external_request` | call `<site>/mcp` with `UrlFetchApp` |
| `drive.file` | save the PDF: access to the files this script creates, not the rest of your Drive |

`drive.file` is why the PDF is saved through the **Drive advanced service** (Drive API v3, enabled by the manifest's
`enabledAdvancedServices`) rather than `DriveApp`, which asks for the whole Drive. If the editor reports `Drive is not
defined`, add it under **Services › + › Drive API**, version v3, identifier `Drive`.

## The tabs

| Tab | From | What it holds |
|---|---|---|
| **Overview** | all of them | Real elections by state, rehearsals and deleted elections counted apart, Active members on the latest roll, ballots and turnout, results certified, the ledger audit, and the PDF's link |
| **Elections** | `list_elections`, `get_election_status`, `get_turnout` | Every election in the public record, deleted ones included: state, rehearsal, voting window, roll, ballots, turnout (and whether it is exact), results status and hash, results page, where it stands |
| **Contest turnout** | `get_turnout` | Per contest once counted: ballots, invalid, blank or abstain, quorum |
| **Rolls** | `get_election_status` | Each election's roll: when it was frozen, how many voters, Active members or test voters |
| **Audit** | `get_audit_report` (no election) | `ustp-verify`'s check of the whole public ledger: counts, then the report line by line |
| **Results** | `get_results` (`summary` and `csv`) | For the chosen election: facts (status, rehearsal, turnout, hash, the results check), a plain-language summary, a block per contest with a chart, and the check's steps |
| **Lists** (hidden) | `list_elections` | The picker's entries: B1's dropdown reads them from this range |

Charts on the Results tab:

- **Ranked choice**: votes in each round, a column per candidate per round, one colour per candidate in every round.
- **Choose candidates**: votes per candidate.
- **Proposal**: one bar split into yes (blue), no (red) and abstain (grey), as shares of the contest's ballots.

The summary says whether the results are provisional or certified, names a rehearsal as one, gives turnout and each
contest's outcome (who won a ranked-choice contest, in which round and with what share, and who was eliminated;
who was elected to how many seats; whether a proposal passed, by what rule, or missed its quorum), the overall tally,
whether the results verified from public data, and the results hash: what the server's own instructions ask a report
to say. You can edit the summary's cells before making the PDF; the PDF takes the tab as it stands.

## What the MCP server does not give, and what the sheet does instead

- **Membership counts.** The server serves no member data, on purpose (design §3.4: admin-only figures such as members
  "stay out"; a tool that needs them would be an authenticated, role-checked route, a new decision). The public record's
  only membership figure is a real election's roll: the Active members when it was frozen. The Overview shows the
  latest one and the Rolls tab shows them all. There is no public api for more, so the sheet goes no further.
- **Each ranked-choice round.** `get_results`' summary gives the winner's first and final rounds only. Its `csv`
  format, the same CSV as `/v1/public/elections/{id}/results.csv`, has every round (each candidate's votes, continuing
  and exhausted ballots, who was eliminated or elected). The sheet reads the rounds from that, so it needs no other api.
- **Turnout while voting is open** is a lower bound: only sealed ballots are public (design §7.2). The Elections tab
  says "no: a lower bound", and the Overview says so when it adds them up.
- **Drafts** are not public. A **deleted** election keeps only its title and ballot count from its ledger entry.
- The election list is as of the last signed ledger block, so an election scheduled in the last minute may not show yet.

Rehearsals (test voters only) are listed and can be picked, but the Overview's figures leave them out, as the server's
instructions ask of reports on real elections, and their summaries say they were rehearsals.

Titles, descriptions and candidate names are written by election administrators: the script writes them to cells as
text, never as formulas (a title that starts with `=` stays text), and escapes them in the PDF.

## Testing

The tests run `Code.gs` unchanged in Node, in a `vm` context with stand-ins for the Apps Script services it uses
(`test/apps-script.mjs`), against MCP answers recorded from the dev site (`test/fixtures/dev.json`):

```bash
node --test "examples/google-sheets/test/*.test.mjs"
```

They cover the JSON-RPC client (JSON and event-stream answers, HTTP and JSON-RPC errors, tool errors, the protocol
version header), each tab's rows, the CSV and ranked-choice parsing, the summary's wording, the Results tab's layout
and chart ranges, the PDF's HTML, and that no cell becomes a formula. To record new fixtures, or to run the three menu
actions against a live site and write what the sheet would hold (`tabs.txt`) and the PDF's HTML (`report.html`):

```bash
node examples/google-sheets/test/record.mjs https://ustpvote2-dev.web.app > examples/google-sheets/test/fixtures/dev.json
```

```bash
node examples/google-sheets/test/live.mjs https://ustpvote2-dev.web.app out
```

What only Google can show: how Sheets draws the charts, how Drive converts the HTML to PDF, and the authorization
prompts. Check those by hand in a real sheet after changing the chart options, the report's HTML or the manifest.
