# ustp-mcp

A read-only [MCP](https://modelcontextprotocol.io) server for one workflow: an AI assistant (Claude, Gemini, ChatGPT,
any that speaks MCP) writing **reports on USTP elections**: where an election stands, turnout, its published results, and an audit report,
for example into a Google Sheet. It reads **only the public api** (`/v1/public/...`, design §12), the same records
anyone can read and check with `ustp-verify`, and it has no credentials, no database access, and nothing that writes.
The reasons it is a separate, narrow service are in design §3.4.

## Tools

| Tool | Gives |
|---|---|
| `list_elections` | Every election the public ledger names, newest first: ID, title, state (including deleted), voting window, roll size, ballots sealed, results status, and whether it was a rehearsal with test voters. Drafts are not public. |
| `get_election_status` | Where one election stands, in a sentence, and its timeline, contests (candidates, proposals), roll, ballots sealed, results status, and links (results page, CSV, a Google Sheets `IMPORTDATA` formula). |
| `get_turnout` | Ballots against the roll as a count and a percentage, per contest once counted. While voting is open the public figure is a **lower bound** (`exact: false`): ballots are sealed in batches, leaving up to 2k − 1 in the encrypted pool (design §7.2). |
| `get_results` | `summary` (default): the synopsis the results page opens with, percentages exact as the page gives them, provisional or certified, the results hash, and the results page's own check of the signed bundle (hash, signature, seed, a full re-tally, the ledger). `csv`: the results CSV as its own text block, for a spreadsheet. |
| `get_audit_report` | `ustp-verify`'s report: with an election, its record, signed roll, sealed blocks and a re-tally of its results; without one, the whole ledger and every public entry. Counts as JSON, then the report as plain text. |

Each tool takes an election ID or any link containing one (a results page, the CSV link). Every tool is annotated
read-only. A mistyped ID, a draft or an unreachable api comes back as a tool error the model can read.

## Run

```bash
npm run build                    # or build packages/tally, audit, domain and verify, then: npm run build -w apps/mcp
node apps/mcp/dist/main.js --site https://ustpvote2-dev.web.app             # stdio, for Gemini CLI or Claude Code
node apps/mcp/dist/main.js --site https://ustpvote2-dev.web.app --http      # Streamable HTTP at http://127.0.0.1:8090/mcp
```

`--site` (or `USTP_SITE`) is the web app's address: Firebase Hosting serves the api under it at `/v1`, and the links in
reports point there. Over HTTP the server is stateless (every POST stands alone, answered as JSON), serves `/health`
for probes, and on loopback answers only loopback host names, against DNS rebinding. `--host 0.0.0.0` and `PORT` are
for a container; `--allowed-hosts` (or `MCP_ALLOWED_HOSTS`) limits the host names it answers there.

## Hosted: connect any AI assistant

Each environment serves it at **`<site>/mcp`**, on dev **`https://ustpvote2-dev.web.app/mcp`**: Streamable HTTP, no
sign-in, no API key. Firebase Hosting passes `/mcp` to the Cloud Run service `mcp`, which runs this server from the
server image with a service account that holds no roles (design §3.4, `infra/terraform/modules/ustpvote/mcp.tf`).
Any client that takes a remote MCP server's URL can use it:

| Client | How |
|---|---|
| Claude Code | `claude mcp add --transport http ustp-vote https://ustpvote2-dev.web.app/mcp` |
| claude.ai, Claude Desktop | Settings → Connectors → Add custom connector, with the URL |
| Claude API | the MCP connector: `mcp_servers: [{type: "url", url: "https://ustpvote2-dev.web.app/mcp", name: "ustp-vote"}]` and `tools: [{type: "mcp_toolset", mcp_server_name: "ustp-vote"}]`, with the beta header `mcp-client-2025-11-20` |
| Gemini CLI | `gemini mcp add -s user -t http ustp-vote https://ustpvote2-dev.web.app/mcp` (in `settings.json`: `"httpUrl"`) |
| Gemini Enterprise | a custom MCP data store with the URL (Standard edition or above; an organisation policy blocks custom MCP data stores until an admin allows them) |
| ChatGPT, others | a custom connector or remote MCP server with the URL and no authentication |

Then ask, for example: *"Using ustp-vote, write a turnout and results report for every real (non-rehearsal) election
this year, and say whether each result verified."* Browser-based clients work too: `/mcp` answers CORS requests from
any origin, since nothing it serves needs credentials.

For Google Sheets, pair it with something that can write to Sheets, such as a Google Workspace MCP server or Gemini
CLI extension: *"Make a Google Sheet with one row per election from list_elections, and a tab per election with its
results CSV."* For a sheet that stays current with no assistant at all, `get_results` and `get_election_status` give an
`IMPORTDATA` formula to paste in a cell; Sheets refreshes it about hourly.

## Run it yourself (stdio)

A client that runs local servers can start its own copy instead, for example in Gemini CLI's `settings.json`:

```json
{
  "mcpServers": {
    "ustp-vote": {
      "command": "node",
      "args": ["C:/DEV/USTPVote/USTPVote2/apps/mcp/dist/main.js", "--site", "https://ustpvote2-dev.web.app"],
      "timeout": 120000
    }
  }
}
```

## Cost

Listing elections and the audit reports scan every ledger entry, one request each, because the api has no index of
entries by type. The server keeps what the signed ledger makes immutable (signed blocks, blocked entries, and private
entries' 404s), so only the first scan is slow: against dev's 80 entries it took about 2.6 s, and later calls 0.3 s.
Election records and results are fetched afresh every time.
