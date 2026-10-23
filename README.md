# USTPVote2

Voter registration and verifiable organizational elections for the United States Transhumanist Party:
member onboarding, secret or roll-call ballots, proposal and candidate contests (Yes/No/Abstain, choose-up-to-N,
instant-runoff), and an audit trail anyone can check — hash chains, Merkle receipts, WORM anchors and a public,
deterministic tally library.

**Status:** M1 (identity and registration), M2 (election setup and the signed, anchored ledger), M3 (casting and
secrecy) and M4 (tally, certification, offices and terms) are built. Sign-in, accounts, bylaws, applications,
membership administration, profile photos, role changes by one System Admin (with a People list of who holds which
role), admin two-step verification, election setup with Auditor-approved rolls and scheduling, ledger blocks signed by the
worker and anchored, casting secret (encrypted) or
roll-call ballots, sealing them into k-anonymous published blocks, tallying them into signed results, two-person
certification that seats the winners in their offices and destroys the ballot key, and checking a receipt or the
results in the browser all work end to end against the Firebase emulators, in the API (emulator integration tests)
and the web app. The `ustp-verify` CLI checks all of it independently from public data. Published results can also be
downloaded as CSV or loaded into Google Sheets with `IMPORTDATA`, with no Google integration. While drafting bylaws, a
Membership Admin can run an advisory check by Claude (Anthropic) that highlights lines which may contradict the US
Constitution, Transhumanist principles or the USTP Constitution; it is off in real projects until USTP agrees to it, and
the emulators use a deterministic stand-in (design §5.4). The web app is an
installable PWA and has had an accessibility pass. For deployment there are Terraform for dev, staging and prod (validated, not yet
applied), the server image (`apps/server/Dockerfile`) and a release workflow that builds, attests and rolls it out
with a keyless CI identity; CI builds and starts the image on every pull request. The rest of M5 (bringing up dev, the
"you voted" email, load test, reviews) is next. Dev (`ustpvote2-dev`) is up: Terraform applied, Identity Platform
configured, and the api and worker running a released image on Cloud Run with the worker ticking every minute; the web
app is not on Hosting yet. Authenticator-app (TOTP) setup, Cloud Vision photo checks and Cloud KMS have no emulator and
have not been exercised in dev yet.

## Documents

- [System design](docs/DESIGN.md) — architecture, threat model, data model, algorithms, open questions, roadmap
- [Accessibility](docs/ACCESSIBILITY.md) — what was checked and fixed, known gaps, the manual screen-reader pass still due
- [Infrastructure](infra/terraform/README.md) — Terraform layout, IAM per service account, bringing an environment up, releasing
- [Independent verifier](packages/verify/README.md) — `ustp-verify` usage and what each check proves
- [Source specification](docs/spec/USTP-Standalone-Technical-Specification.docx) ([text extraction](docs/spec/technical-specification.md))

## Layout

| Path | What |
|---|---|
| [`packages/tally`](packages/tally) | `ustp-tally` — ballot validation and deterministic counting (proposal, choose-N with support floor, IRV). Zero dependencies. |
| [`packages/audit`](packages/audit) | `ustp-audit` — RFC 8785 canonical JSON, SHA-256, hash chains, RFC 9162 Merkle proofs, ballot commitments, tie-break ordering. Runs in Node and the browser. |
| [`packages/domain`](packages/domain) | `ustp-domain` — UUIDv7, membership and election state machines, roles, two-person rule, Firestore paths, sealed blocks, results bundles, receipt and results checks. |
| [`packages/verify`](packages/verify) | `ustp-verify` — independent verifier CLI over public artifacts only. |
| [`apps/server`](apps/server) | NestJS 12 on Fastify: `main-api.ts` (Cloud Run api) and `main-worker.ts` (Cloud Run worker). |
| [`apps/web`](apps/web) | Vue 3 + Quasar 2 SPA: `/register`, `/ballot`, `/verify`, `/admin`. |
| [`infra/firebase`](infra/firebase) | Firestore/Storage rules (deny all) and indexes. [`firebase.json`](firebase.json) at the root ties them to Hosting and the emulator ports. |
| [`infra/terraform`](infra/terraform) | Terraform for dev, staging and prod: service accounts, KMS, buckets, Firestore, Cloud Run, Scheduler, Binary Authorization. |

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
| `npm run seed:emulators -w apps/server` | Fills the local emulators with test users, elections and ballots (see below) |
| `node packages/verify/dist/cli.js --election <id>` | Verifies the local stack's ledger and an election from public data ([details](packages/verify/README.md)) |
| `npm run dev:web` | Vite dev server; proxies `/v1` to the local api |
| `docker build -f apps/server/Dockerfile -t ustp-server .` | Builds the server image (api by default; `node dist/main-worker.js` for the worker), as CI and the [release workflow](infra/terraform/README.md#release-workflow) do |

The server uses NestJS decorators with emitted metadata, so it is compiled with `tsc` rather than run through a
type-stripping loader.

### Running the whole stack locally

Four terminals, after `npm run build` (needs Java 21):

```bash
npm run emulators -w apps/server
```

```bash
npm run dev:api:emulators -w apps/server
```

```bash
npm run dev:worker:emulators -w apps/server
```

```bash
npm run dev:emulators -w apps/web
```

The worker ticks every 15 seconds in place of Cloud Scheduler: it opens and closes elections on time and seals,
signs and anchors the ledger. On the same timer it runs queued bylaws checks, with the emulator-only stand-in unless the
api and worker both get `BYLAWS_CHECKER=claude` and the worker an `ANTHROPIC_API_KEY` (each check then costs money and
sends the draft to Anthropic; design §5.4).

The emulators start empty. To fill them with test data, run this once the api and worker are up (about a minute):

```bash
npm run seed:emulators -w apps/server
```

It creates, through the api as people would: System Admins `admin1@` and `admin2@example.test`, an Election and
Membership Admin `elections@example.test`, an Auditor `auditor@example.test`, and twelve Active members
`v1@` … `v12@example.test`, all with the password in
[`seed-emulators.mjs`](apps/server/scripts/seed-emulators.mjs). It defines two offices (Chair, Outreach Coordinator),
sets up five elections (two open secret ballots, one of which closes after 15 minutes, an open roll-call vote, one
scheduled for later and a draft; the Chair and Outreach Coordinator contests fill those offices) and casts random
ballots for every voter except `v1@example.test`, so you can vote as v1. Once the 15-minute election closes and is
counted, request certification as `elections@` and approve it as `auditor@` to see the winner take office. Running it
again reuses what is there.

Open http://localhost:5173. Everything runs against the emulator-only project `demo-ustpvote` with App Check and
admin MFA off. Use `npm run dev:api:emulators:mfa -w apps/server` instead to keep the production admin MFA policy on;
note that the Auth emulator cannot do authenticator-app (TOTP) factors, only SMS ones. Accounts for `admin1@example.test` and `admin2@example.test` become System Admins once their email is
verified. The Auth emulator does not send email: it prints verification and sign-in links in the `emulators`
terminal (they are also listed at `http://127.0.0.1:9099/emulator/v1/projects/demo-ustpvote/oobCodes`).
`.claude/launch.json` defines the same servers for Claude Code's preview.

## License

Not chosen yet (design open question 14). `ustp-tally` and `ustp-audit` are intended to be published publicly so that
anyone can verify results independently.
