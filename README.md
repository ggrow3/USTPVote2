# USTPVote2

Voter registration and verifiable organizational elections for the United States Transhumanist Party:
member onboarding, secret or roll-call ballots, proposal and candidate contests (Yes/No/Abstain, choose-up-to-N,
instant-runoff), and an audit trail anyone can check — hash chains, Merkle receipts, WORM anchors and a public,
deterministic tally library.

**Status:** M1 (identity and registration) is built. The core libraries are done and tested. Sign-in, accounts,
bylaws, applications, membership administration, profile photos, two-person role changes, admin two-step verification
and the audit ledger work end to end against the Firebase emulators, in the API (emulator integration tests) and the
web app. Authenticator-app (TOTP) setup and Cloud Vision photo checks have no emulator and still need a real project.
Nothing is deployed; elections (M2) are next.

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
| `npm run test:int -w apps/server` | Starts the Auth, Firestore and Storage emulators (project `demo-ustpvote`) and runs the API integration tests |
| `npm run watch -w apps/server` | Recompiles the server on change (run alongside a `dev:*` command) |
| `npm run dev:api` / `npm run dev:worker` | Runs the compiled api (port 8080) / worker, restarting on rebuild |
| `npm run dev:web` | Vite dev server; proxies `/v1` to the local api |

The server uses NestJS decorators with emitted metadata, so it is compiled with `tsc` rather than run through a
type-stripping loader.

### Running the whole stack locally

Three terminals, after `npm run build` (needs Java 21):

```bash
npm run emulators -w apps/server
```

```bash
npm run dev:api:emulators -w apps/server
```

```bash
npm run dev:emulators -w apps/web
```

Open http://localhost:5173. Everything runs against the emulator-only project `demo-ustpvote` with App Check and
admin MFA off. Use `npm run dev:api:emulators:mfa -w apps/server` instead to keep the production admin MFA policy on;
note that the Auth emulator cannot do authenticator-app (TOTP) factors, only SMS ones. Accounts for `admin1@example.test` and `admin2@example.test` become System Admins once their email is
verified. The Auth emulator does not send email: it prints verification and sign-in links in the `emulators`
terminal (they are also listed at `http://127.0.0.1:9099/emulator/v1/projects/demo-ustpvote/oobCodes`).
`.claude/launch.json` defines the same three servers for Claude Code's preview.

## License

Not chosen yet (design open question 14). `ustp-tally` and `ustp-audit` are intended to be published publicly so that
anyone can verify results independently.
