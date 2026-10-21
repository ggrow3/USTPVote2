# USTPVote2

Voter registration and verifiable organizational elections for the United States Transhumanist Party:
member onboarding, secret or roll-call ballots, proposal and candidate contests (Yes/No/Abstain, choose-up-to-N,
instant-runoff), and an audit trail anyone can check — hash chains, Merkle receipts, WORM anchors and a public,
deterministic tally library.

**Status:** M1 in progress. The core libraries are done and tested. The API's identity and registration backend
(accounts, bylaws, applications, membership administration, two-person role changes, audit ledger) is implemented
and covered by emulator integration tests; photos and the web UI for these flows are next. Nothing is deployed.

## Documents

- [System design](docs/DESIGN.md) — architecture, threat model, data model, algorithms, open questions, roadmap
- [Source specification](docs/spec/USTP-Standalone-Technical-Specification.docx) ([text extraction](docs/spec/technical-specification.md))

## Layout

| Path | What |
|---|---|
| [`packages/tally`](packages/tally) | `ustp-tally` — ballot validation and deterministic counting (proposal, choose-N with support floor, IRV). Zero dependencies. |
| [`packages/audit`](packages/audit) | `ustp-audit` — RFC 8785 canonical JSON, SHA-256, hash chains, RFC 9162 Merkle proofs, ballot commitments, tie-break ordering. Runs in Node and the browser. |
| [`packages/domain`](packages/domain) | `ustp-domain` — UUIDv7, membership and election state machines, roles, two-person rule, Firestore paths. |
| [`apps/server`](apps/server) | NestJS 12 on Fastify: `main-api.ts` (Cloud Run api) and `main-worker.ts` (Cloud Run worker). |
| [`apps/web`](apps/web) | Vue 3 + Quasar 2 SPA: `/register`, `/ballot`, `/verify`, `/admin`. |
| [`infra/firebase`](infra/firebase) | Firestore/Storage rules (deny all), indexes, Hosting config, emulator ports. |

## Development

Requires Node.js 24 or newer (production target: Node 26 LTS, see `.nvmrc`) and npm 11. The server's integration
tests also need Java 21 for the Firebase emulators.

```bash
npm ci --ignore-scripts
npm run build
npm test
```

`.npmrc` sets `ignore-scripts=true`, so dependency install scripts never run (spec §7). `npm run …` is unaffected.

| Command | Does |
|---|---|
| `npm run build` | Builds the packages, then the server and web app, in dependency order |
| `npm run typecheck` | Type-checks every workspace, tests included |
| `npm test` | Runs every workspace's Vitest suite (unit tests) |
| `npm run test:int -w apps/server` | Starts the Auth and Firestore emulators (project `demo-ustpvote`) and runs the API integration tests |
| `npm run watch -w apps/server` | Recompiles the server on change (run alongside a `dev:*` command) |
| `npm run dev:api` / `npm run dev:worker` | Runs the compiled api (port 8080) / worker, restarting on rebuild |
| `npm run dev:web` | Vite dev server; proxies `/v1` to the local api |

The server uses NestJS decorators with emitted metadata, so it is compiled with `tsc` rather than run through a
type-stripping loader.

## License

Not chosen yet (design open question 14). `ustp-tally` and `ustp-audit` are intended to be published publicly so that
anyone can verify results independently.
