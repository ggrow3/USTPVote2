# ustp-verify

An independent verifier for USTP elections. It checks the signed audit ledger, its anchors, an election's published
record and ballot receipts using **only public artifacts**: the unauthenticated `/v1/public/...` endpoints (design §12)
and, optionally, anchor objects you downloaded yourself. It sends no credentials and needs no database access. Its only
dependencies are `ustp-audit` and `ustp-domain`, the same pure code the server and the browser's `/verify` page run, and
Node built-ins.

## Usage

```bash
npm run build                                   # or: npm run build -w packages/verify
node packages/verify/dist/cli.js --help
node packages/verify/dist/cli.js --api https://vote.example.org --election <electionId>
```

Inside the workspace the `ustp-verify` bin works too (`npx ustp-verify ...`).

| Option | |
|---|---|
| `--api <url>` | The api to check. Default `http://127.0.0.1:8080` (the local dev stack). |
| `--election <id>` | Also check this election's published record. Scans the public ledger entries (see [Cost](#cost)). |
| `--receipt <file>` | Also check a ballot receipt (the JSON the ballot page downloads). Implies its election when `--election` is not given. |
| `--anchors <dir>` | Compare downloaded anchor objects with the api. `<dir>` is the bucket root (holding `v1/`) or `v1/` itself, for example after `gcloud storage cp -r gs://<anchors-bucket>/v1 <dir>`. |
| `--entries` | Scan and check every public ledger entry, even without `--election`. |
| `--json` | Print the report as JSON (`{ api, checkedAt, ok, sections }`). |

The report lists findings by section. `[ ok ]` passed. `[FAIL]` failed. `[wait]` cannot be checked yet and is not a
failure: the worker seals, blocks, signs and anchors on each tick (once a minute in production), so re-run shortly.
`[info]` is context.

**Exit codes:** `0` nothing failed (some steps may be waiting), `1` at least one check failed, `2` the checks could not
run (bad arguments, an unreadable file, an api that is unreachable or answers 5xx).

## What each check proves, and what it does not

The ledger check runs first, and every later check trusts only the ledger blocks it verified: the blocks before the
first problem of any kind, because a chain is only as good as its first break.

### Ledger (always)

- **Blocks chain from genesis.** Blocks are numbered 1, 2, ... without gaps. Each covers the entries right after the
  previous block's, links to it through `prevBlockHash`, and its `blockHash` recomputes as `H(JCS(block))`.
- **Signing keys** are listed under the key IDs derived from their key versions (`v1/keys/{keyId}.pem` in the bucket).
- **Every block's signature** (ECDSA P-256 over `JCS(block)`, the form Cloud KMS produces) verifies with a listed key.
- **The latest anchor covers the head.** The anchor names a block the api serves, with the same hash, at that block's
  anchor object path. An anchor for a block the api no longer serves is a failure, because history was cut. An anchor
  behind the head is `wait`.

*Does not prove:*
- Merkle roots over private entries. The api publishes only public entries, so a block's root is checked only through
  the public entries' inclusion proofs. The full `verifyBlocks` over every entry hash stays with Auditors
  (`GET /v1/admin/audit/verify`).
- That the listed key is the real audit key. That is the api's word, unless you compare it with the anchored key
  object (`--anchors`) or a fingerprint USTP publishes elsewhere.
- That the api is not showing you a different history from everyone else. Only anchors held outside the api settle
  that: download them yourself, ideally from a public mirror, and pass `--anchors`.

### Anchor objects (`--anchors`)

- Each downloaded `v1/blocks/<12-digit index>.json` is byte for byte `JCS({v: 1, block, blockHash, signature})` of the
  block the api serves. An object for a block the api does not serve is a failure.
- Each downloaded `v1/keys/<keyId>.pem` is byte for byte the public key the api lists.
- Blocks and keys you did not download are listed as `info`.

*Does not prove:* that the objects are write-once. Bucket Lock and object generations are bucket properties: check the
bucket's locked retention policy, and the generation each anchor record names, with `gcloud storage`.

### Public ledger entries (with `--election` or `--entries`)

Every entry covered by a verified block is requested; private ones answer 404. For each public entry:

- its `hash` recomputes as `H(JCS(entry without hash))`, and its type is one that is meant to be public;
- the block served with it is the verified block of that index;
- its RFC 9162 inclusion proof leads from the entry hash to that block's Merkle root, at its position (and the head
  entry of a block is its `headEntryHash`);
- neighbouring public entries link by `prevHash`.

*Does not prove:* that the api has not withheld a public entry by answering 404 for it. The election checks below catch
withheld entries where the record implies them: lifecycle steps, rolls and sealed blocks.

### Election (`--election <id>`)

- **Definition.** `H(JCS(definition))` equals the published `definitionHash`, and the definition agrees with the
  election record (ID, title, description, secrecy, voting window, k).
- **Ledger history.** Each step the record shows (`election.scheduled`, `opened`, `closed`, `sealed`, `cancelled`) is
  ledgered exactly once, with the same definition hash, voting window, roll, tie-break seed commitment and final count.
  A ledgered step the record does not show is also a failure.
- **Roll.** A `roll.approved` entry records the published roll (count, Merkle root, as-of time), and the snapshot it
  approved is the one `election.scheduled` names. The roll signature verifies over `rollSigningInput` (JCS of the roll
  statement). The statement's snapshot and approval IDs come from that ledger entry, and its criteria are
  `{status: 'active'}`, the only roll there is.
- **Sealed block summaries.** Each summary matches its `ballots.sealed` entry (index, ballot count, Merkle root, sealed
  hash), the entries chain through `prevSealedHash`, and every `ballots.sealed` entry for the election has a summary, so
  the record cannot leave a block out.
- **k-anonymity (secret ballots).** Every sealed block holds at least k ballots, unless turnout itself was below k
  (one block, sealed at close).
- **Invariant 1, as far as public data goes.** Ballots sealed (and the record's `ballotsSealed`) never exceed the voters
  on the roll.
- **Contents (once closed).** `sealedBlockProblems` recomputes every block (numbering, `prevSealedHash` links, Merkle
  root over the sorted part commitments, commitment list, `sealedHash`). Each block matches its summary. Every part is
  filed under its own contest and is a valid answer to the frozen definition, and no contest has more parts than the
  block has ballots. Secret parts name no voter. Roll-call parts name their voter, each voter answers a contest once,
  the voters match the ballot count, and nobody appears in two blocks. While voting is open the contents are `wait`;
  after close, an api that still withholds them fails.

*Does not prove:*
- "Sealed ballots = participation records" and "every participant is on the roll" (invariant 1 in full). Participation
  and the roll's entries are not public; Auditors check those.
- That every eligible member could vote, or that the api did not cast for members who did not vote. Design §2 states
  this residual trust, and the post-election participation check addresses it.
- Anything about results: see below.

### Receipt (`--receipt <file>`)

The receipt was cast on the published definition. Then, for each part, every step of `checkReceiptPart` (design §7.5)
runs: the selection and salt produce the receipt's commitment, the commitment is in its sealed block's Merkle root,
the block is recorded in a `ballots.sealed` entry, that entry is in a ledger block, the block is signed by the audit
key, and an anchor covers it. The CLI also checks that this ledger block is one the ledger check verified. A part still
in the pool is `wait`.

*Does not prove:* that the vote was counted as cast. Results are not checked yet. A receipt shows how its holder voted,
so keep it private.

### Results

**Not checked yet.** This is an extension point for M4a (`src/results.ts`). The CLI requests
`/v1/public/elections/{id}/results` and reports "results not published" on 404 (or 409). A published bundle is reported
as `info`, with nothing claimed about it. Once the bundle's shape is settled, check that the revealed tie-break seed
matches `tieBreakSeedCommitment`, that `ustp-tally` over the sealed parts reproduces each result, and that the bundle's
hash is the one ledgered (design §2 invariant 4).

## Cost

The api has no index of an election's ledger entries. So `--election` (and `--entries`) request every entry the
verified blocks cover, eight at a time, which is one request per ledger entry. That is quick for the dev stack. For a
large ledger, an endpoint that lists an election's public entry numbers would cut it to a handful of requests.

## Implemented here rather than imported

Everything cryptographic comes from `ustp-audit` and `ustp-domain`. These pieces are local, because those packages do
not export them in this form:

- `blockChainProblems`: the block-chain half of `verifyBlocks` (numbering, contiguity, links, `blockHash`), without
  the private entry hashes an outsider cannot see. It reports every problem, not just the first.
- `publicEntryProblems`: an inclusion check of one public entry against a *verified* block.
- `anchorDocument`: the anchor object's content, as the worker's `LedgerSealer` writes it.
- The states in which sealed contents must be public (`closed`, `certified`), as `PublicElectionsService` serves them.

## As a library

`src/index.ts` exports the checks as pure functions. They take fetched data and return findings, with no HTTP:
`checkLedger`, `anchorObjectFindings`, `checkEntryScan`, `checkElection`, `checkReceipt`, `resultsFindings`. It also
exports `PublicApi` (fetching, with an injectable `fetch`) and `verify` (fetch, then check). Tests build their fixtures
with the real ustp-audit and ustp-domain functions (`src/testing/fixtures.ts`).
