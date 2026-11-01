# Examples

Elections, test votes and bylaws as files (design §6.7, §10.4). The local seed loads them, and the tests run them end to
end, so every example here is known to import, vote, count, certify and verify.

| Path | Format | What it is |
|---|---|---|
| `manifest.json` | `ustp.examples` v1 | What is here and how the seed uses it: the offices, the base bylaws, and each election with its votes files |
| `bylaws/ustp-bylaws-2026.1.txt` | text | Example bylaws (not the party's), published as version 2026.1 by the seed and the tests |
| `bylaws/ustp-bylaws-2026.1-amended.txt` | text | The same bylaws once amendments A and B of `bylaws-amendments` pass |
| `elections/*.election.json` | `ustp.election` v1 | Elections to import (Admin → Elections → Import JSON, or `POST /v1/admin/elections/import`) |
| `votes/*.votes.json` | `ustp.test-votes` v1 | Ballots for test voters in a rehearsal, and the results they must give |

## Elections

- **The dev seed's elections**, moved here unchanged: `2026-officer-election`, `bylaw-amendment-3`,
  `platform-vote-9`, `committee-elections`, `2027-platform-convention` and `2027-bylaws-review` (a draft).
- **`bylaws-amendments`**: three amendments to lines of the example bylaws, two of them on adjacent lines.

Windows are relative (`opensInSeconds`, `votingSeconds`), so an election imported now opens soon after.

## Test votes

A votes file says how test voters 1, 2, … vote, by contest title or ID and candidate name or ID, and what the results
must then be:

```json
{
  "format": "ustp.test-votes", "v": 1,
  "ballots": [{ "voter": 1, "choices": { "Chair": ["Blair Chen", "Alex Rivera"], "Plank 12: Right to repair": "yes" } }],
  "random": { "voters": 12, "seed": "any text" },
  "expect": { "Chair": ["Blair Chen"], "Plank 12: Right to repair": "passed" },
  "expectBylawsSha256": "…"
}
```

- **Choices:** `yes`, `no` or `abstain` for a proposal. The candidates chosen, or ranked, for a candidate contest, with
  `[]` for a blank. `random` for any of them. A contest left out is skipped.
- **`random`:** voters 1 to `voters` without a ballot of their own cast a random one. With a `seed`, the ballots are
  the same every time.
- **`expect`:** a proposal's outcome (`passed`, `failed`, `no_quorum`), or a contest's winners in any order.
- **`expectBylawsSha256`:** the SHA-256 of the bylaws the passed amendments give.

Only test voter personas cast these ballots, through the ordinary ballot endpoint; no endpoint takes a votes file.

## Where they are used

- `npm run seed:emulators -w apps/server` imports the elections marked `seed` in the manifest. It schedules those
  marked `scheduled`, through the roll and scheduling approvals; `draft` stays a draft.
- `apps/server/src/examples.int.test.ts` runs every votes file end to end as a rehearsal, then runs the `ustp-verify`
  checks. The rehearsal goes import, rehearsal roll, scheduling, voting as the test voters, closing, counting, the
  expected results, certification, and for amendments adopting the bylaws.
- `packages/domain/src/examples.test.ts` checks every file against its schema, plans every votes file, and checks the
  amended bylaws file against `expectBylawsSha256`.

## Google Sheets

`google-sheets/` is something else: an Apps Script for a Google Sheet that reads the reporting MCP server (design §3.4)
into tabs, builds an election's results with charts and a plain-language summary, and saves a PDF report. Its README
says how to set it up.

## Course site

`course-site/` is another site built from the public course api (design §10.8): one HTML file that lists an election
site's courses and shows each published course from its `ustp.course` file, quizzes graded in the page. Its README
says what it reads.

## Course explorer

`course-explorer/` queries the same api for the course map and every published course: `query.mjs` writes them as one
JSON file, and `index.html` runs the query in the browser (or opens that file) and shows the answer as a structured
form, as its JSON, and as every lesson with its quiz and answers.
