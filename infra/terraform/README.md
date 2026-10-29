# Infrastructure (Terraform)

Everything USTPVote2 needs in one GCP project per environment (design §15): APIs, the `api`, `worker` and invoker
service accounts with least-privilege IAM (§14), the Cloud KMS keys (§7.3, §8.3), the anchors and photos buckets (§5.3,
§8.4), Firestore, both Cloud Run services, the Cloud Scheduler tick and a Cloud Tasks queue (§13), Binary Authorization
(§14), the release workflow's identity, KMS audit logs and a break-glass alert. Design open question Q13 (Terraform)
and Q16 (`us-central1`) are assumed.

Not managed here, and described [below](#manual-steps): Identity Platform (providers, MFA, password policy), adding
Firebase to the project and the App Check web registration. Firestore rules and indexes and the web app on Firebase
Hosting are deployed by the [release workflow](#release-workflow), with the server, from the same commit.

## Layout

| Path | What |
|---|---|
| [`modules/ustpvote`](modules/ustpvote) | One environment. `main.tf` (APIs), `iam.tf`, `kms.tf`, `storage.tf`, `firestore.tf`, `run.tf`, `mcp.tf`, `scheduling.tf`, `binauthz.tf`, `release.tf`, `logging.tf`, `outputs.tf` |
| [`envs/dev`](envs/dev) | `ustpvote2-dev`: anchors retention unlocked, Binary Authorization in dry run |
| [`envs/staging`](envs/staging) | `ustpvote2-staging`: production settings except the retention lock |
| [`envs/prod`](envs/prod) | `ustpvote2-prod`: Binary Authorization enforced, no human data access, retention lock stated explicitly |

Each root keeps its state in the GCS bucket `ustpvote2-<env>-tfstate` and needs Terraform 1.9 or newer and the
`hashicorp/google` provider 8.x. Each root's `.terraform.lock.hcl` pins the provider, with hashes for Linux, macOS and
Windows; Dependabot updates the three together. Copy `terraform.tfvars.example` to `terraform.tfvars` (git-ignored: it
holds people's addresses). CI runs these on every pull request, without a backend or credentials:

```bash
terraform fmt -check -recursive
terraform init -backend=false -lockfile=readonly
terraform validate
```

Nothing has been planned or applied against a real project, so IAM conditions, the identity provider's condition and
API-side limits are only checked by Google on the first apply.

## What each identity may do

| Identity | May | Why |
|---|---|---|
| `ustp-api` | Firestore (`datastore.user`) | All client-facing reads and writes (§11) |
| | Read Identity Platform users (`firebaseauth.viewer`) | `verifyIdToken(…, checkRevoked)` on admin routes and casting (§4) |
| | Create secrets; add versions to `tiebreak-seed-*` secrets only (IAM condition) | Tie-break seed per scheduling attempt (§6.1); it never reads a seed back |
| | `secretVersionManager` on `anthropic-api-key` only: add, list and destroy versions, never read one | Keeps the key a System Admin adds under Admin › Claude (§5.6); it cannot read it back |
| | `publicKeyViewer` on `ballot-pool` | Encrypts ballots locally to an election's public key; cannot decrypt (§7.3) |
| | Read, write, delete objects in the photos bucket | Profile photos (§5.3) |
| | Read objects in the anchors bucket | Auditor verification downloads every anchor (`GET /v1/admin/audit/verify`) |
| | Cloud Vision | Needs no IAM role; the API only has to be enabled |
| `ustp-worker` | Firestore (`datastore.user`) | Clock, sealing, ledger (§13) |
| | `signer` and `publicKeyViewer` on `audit-signing` | Only the worker signs ledger blocks and rolls (§8.3) |
| | Create, get, decrypt with and destroy `ballot-pool` versions (custom role, on that key only) | One version per election, unwrapping at sealing, destruction after certification (§7.3, §13) |
| | Create and read objects in the anchors bucket; never delete | Write-once anchors; overwriting needs delete, which it lacks (§8.4) |
| | Access secrets | Tie-break seeds at tally (§9), the Anthropic API key for the bylaws, consistency and election setup checks, read each time it runs them (§5.4–§5.6, §6.9), the AWS key for election notices by SES (§6.8) |
| `ustp-worker-invoker` | Invoke the worker | Identity of the Scheduler tick and of Cloud Tasks; nothing else |
| `ustp-mcp` | Nothing | The reporting MCP server (`mcp.tf`, design §3.4) reads only the public api, through the site, as any visitor does |
| `ustp-release` | Push to the `ustpvote` Artifact Registry repository | The release workflow builds the server image |
| | Sign attestations for `ustpvote-reviewed` (attestor key, note, occurrences) | Binary Authorization lets only attested images run |
| | `run.developer` on `api`, `worker` and `mcp`; act as `ustp-api`, `ustp-worker` and `ustp-mcp` | Rolls the services onto a new image. It cannot change IAM, invokers or keys, nor read Firestore |
| | Cloud Datastore Index Admin, Firebase Rules Admin (project) | Deploys the Firestore indexes and rules before each roll-out and waits for the indexes. Definitions only: neither reads nor writes a document |
| | Firebase Hosting Admin (project) | Deploys the web app after each roll-out; also lets the Firebase CLI find the default site, and the release read the Firebase web app's public config for the build (`firebase.projects.get`, `firebase.clients.get`) |
| | Service Usage Consumer (project) | The Firebase CLI checks that the Firestore API is enabled, billed to the project. It cannot enable or disable an API |
| | Only reachable from GitHub Actions: `release.yml` on `main`, in the GitHub environment named after this environment, in this repository (by ID) | Workload Identity Federation; there is no key |
| everyone | Invoke the api and the reporting MCP server; read anchors if `anchors_public_read` | Hosting proxies unauthenticated; the api checks ID and App Check tokens itself, and the MCP server serves only public data |
| `operator_members` | View services, logs (including KMS Data Access logs), metrics, schedules, key metadata, IAM | Operations without Firestore data or key use (§14) |
| `developer_data_members` | Firestore data access | Debugging; refused in prod by a validation |
| `image_publishers` | Push to the `ustpvote` Artifact Registry repository | Anyone besides `ustp-release`, usually nobody |
| `attestation_signers` | Sign attestations for `ustpvote-reviewed` | Anyone besides `ustp-release`, usually nobody |

The worker has internal-only ingress and only the invoker account may call it, so its `/tasks` routes need no sign-in of
their own. Basic roles (Viewer, Editor, Owner) all include Firestore data access, so in production no person should hold
one standing; whoever runs Terraform holds Owner-level rights by necessity (the "project owner / deployer" row of §2).
For break-glass access, grant a role temporarily: KMS Data Access logs are on, and the alert below fires on any use of
`audit-signing` or `ballot-pool` by someone other than the worker, on destroying or restoring a pool key version, and on
any IAM change to the key ring or its keys. Firestore Data Access logs stay off (§14).

## Variables

Set in each root's `terraform.tfvars` (or with `-var`):

| Variable | dev | staging | prod | Meaning |
|---|---|---|---|---|
| `server_image` | | | | Image by digest the services are created with; null (default) skips the Cloud Run services and the tick. Keep it set: later releases come from the release workflow, and Terraform ignores the image once a service exists |
| `bootstrap_system_admin_emails` | | | | `BOOTSTRAP_SYSTEM_ADMIN_EMAILS` (§4): one is enough; `[]` once real admins exist |
| `firebase_web_app_id` | | | | The Firebase web app's ID; registers the reCAPTCHA key with App Check ([App Check](#app-check-and-the-web-build)) |
| `anchors_retention_days` | 3653 | 3653 | 3653 | Q11; 10 years |
| `anchors_retention_locked` | false (fixed) | false (fixed) | **required** | Bucket Lock, irreversible; see [Bucket Lock](#bucket-lock-production) |
| `anchors_public_read` | false | true | true | §8.4 recommendation: outsiders keep copies, browsers can fetch them |
| `image_publishers`, `attestation_signers` | | | | Further identities that may push or attest; `ustp-release` always may |
| `operator_members` | | | | `user:…` / `group:…` with read-only operations roles |
| `developer_data_members` | yes | yes | (absent) | People with Firestore data access |
| `alert_emails` | | | | Recipients of the KMS break-glass alert; empty means no alert policy |
| `task_enqueuers` | | | | `"api"` and/or `"worker"`, once code enqueues Cloud Tasks |
| `bylaws_check_enabled` | false | false | false | The advisory bylaws check with Claude, which sends drafts to Anthropic; see [Bylaws check](#bylaws-check) |
| `consistency_check_enabled` | false | false | false | The platform consistency check with Claude, once per person per election, which sends an election's proposals to Anthropic; see [Consistency check](#consistency-check) |
| `election_check_enabled` | false | false | false | The election setup check with Claude, once per version of an election, which sends its rules, offices and proposal texts with the bylaws to Anthropic, and whose notes every user sees; see [Election setup check](#election-setup-check) |
| `project_id`, `region` | | | | Default to the environment's project and `us-central1` |

Fixed per root: Binary Authorization is a dry run in dev and enforced elsewhere. The module has further knobs with
sensible defaults (`kms_protection_level`, `audit_signing_key_version` for rotation,
`ballot_pool_destroy_scheduled_duration` = 24 h, `binauthz_extra_attestors`, sizing, `deletion_protection`,
`github_repository` and `github_repository_id` for a fork or a moved repository); see
[`modules/ustpvote/variables.tf`](modules/ustpvote/variables.tf).

## Outputs and the server's environment

Terraform sets the services' environment itself; the outputs are for the release pipeline, Hosting, the web build and
for running the server locally against a real project. Variable names are those `apps/server/src/config.ts` reads.

| Environment variable | Output | api | worker |
|---|---|:-:|:-:|
| `GOOGLE_CLOUD_PROJECT` | in `api_env` / `worker_env` | ● | ● |
| `DEPLOYMENT_ENVIRONMENT` | the `environment` variable (`dev`, `staging`, `prod`) | ● | ● |
| `TESTING_MODE` | `true` only when the `testing_mode` variable is (dev sets it; prod refuses it); the worker sends a rehearsal's election notice to the outbox only then (design §6.8) | ● | ● |
| `WEB_ORIGIN` | in `worker_env`: the `web_origin` variable, else `https://<project>.web.app`; election notices link to it | | ● |
| `MAIL_TRANSPORT`, `NOTICE_CONTACT` | in `api_env` / `worker_env`: `ses` or `off` from `mail_transport`, and `notice_contact` when set, the default for the app's own setting (the api shows them in the election editor; only the worker sends) | ● | ● |
| `MAIL_FROM`, `MAIL_REPLY_TO` | in `worker_env`: the `mail_from` variable, and `mail_reply_to` when set (it is not, as agreed) | | ● |
| `SES_REGION`, `SES_CONFIGURATION_SET`, `SES_MAX_SEND_RATE`, `SES_EVENTS_QUEUE_URL` | in `worker_env` when `mail_transport` is `ses` (the queue when `ses_events_queue_url` is set) | | ● |
| `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY` | not output: the `aws-ses-*` secrets' latest versions, when `mail_transport` is `ses` ("Election notices") | | ● |
| `AUDIT_SIGNING_KEY_VERSION` | `audit_signing_key_version` (`…/cryptoKeys/audit-signing/cryptoKeyVersions/1`) | | ● |
| `BALLOT_POOL_KEY` | `ballot_pool_key` (`…/cryptoKeys/ballot-pool`) | ● | ● |
| `ANCHORS_BUCKET` | `anchors_bucket` (`<project>-anchors`) | ● | ● |
| `PHOTOS_BUCKET` | `photos_bucket` (`<project>-profile-photos`) | ● | |
| `BOOTSTRAP_SYSTEM_ADMIN_EMAILS` | from the variable, not output | ● | |
| `BYLAWS_CHECKER` | in `api_env` / `worker_env`: `claude` when `bylaws_check_enabled`, else `off` | ● | ● |
| `CONSISTENCY_CHECKER` | in `api_env` / `worker_env`: `claude` when `consistency_check_enabled`, else `off` | ● | ● |
| `ELECTION_CHECKER` | in `api_env` / `worker_env`: `claude` when `election_check_enabled`, else `off` | ● | ● |
| `BYLAWS_CHECK_MODEL`, `CONSISTENCY_CHECK_MODEL`, `ELECTION_CHECK_MODEL` | not set; the server defaults to `claude-opus-5-5` | | (●) |
| `PORT` | set by Cloud Run (8080) | ● | ● |
| `BUILD_COMMIT` | not Terraform's: the release workflow bakes the commit into the image; the api reports it so open pages can offer a reload (design §15) | ● | ● |

Never set: `APP_CHECK_ENFORCED`, `ADMIN_MFA_REQUIRED`, `PHOTO_CHECKER`, `SECRET_STORE`, `AUDIT_SIGNER`, `BALLOT_POOL`
or an emulator host. Every safety switch then keeps its production default (§4). Testing mode (design §10.4) is
refused twice in prod: the `testing_mode` variable's validation, and the api and worker, which will not start with
`TESTING_MODE` unless `DEPLOYMENT_ENVIRONMENT` is `dev` or `staging`.

| Consumer | Output |
|---|---|
| Firebase Hosting (`firebase.json` rewrite `run.serviceId` / `run.region`) | `api_service` (`api`, `us-central1`) |
| Web build | In the release workflow, `FIREBASE_WEB_APP_ID` and `RECAPTCHA_SITE_KEY` in `github_environment_variables`; the release reads the rest of the web app's public config from Firebase. By hand (`apps/web/.env.example`): `VITE_FIREBASE_PROJECT_ID` = the project, the other values from the Firebase web app and reCAPTCHA key (below) |
| Release workflow (GitHub environment variables) | `github_environment_variables` (also `image_repository`, `attestor`, `attestor_key_version`, `release_service_account`, `recaptcha_site_key`) |
| Mirrors and verifiers | `anchors_public_url` |
| Checks | `api_url`, `worker_url`, `service_accounts`, `tasks_queue` |

## Bringing an environment up

Examples use dev; replace `dev` throughout for the others. Run Terraform with an account that is Owner of the project
(`gcloud auth application-default login`).

1. **Project.** Create `ustpvote2-dev` with billing, then add Firebase to it, create the state bucket and enable the
   two APIs Terraform needs before it can enable the rest:

   ```bash
   npx firebase projects:addfirebase ustpvote2-dev
   gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com --project=ustpvote2-dev
   gcloud storage buckets create gs://ustpvote2-dev-tfstate --project=ustpvote2-dev --location=us-central1 --uniform-bucket-level-access --public-access-prevention
   gcloud storage buckets update gs://ustpvote2-dev-tfstate --versioning
   ```

2. **First apply, without an image.** Creates everything except the Cloud Run services and the tick: APIs, accounts,
   keys, buckets, Firestore, the image repository, the Tasks queue, Binary Authorization, the release workflow's
   identity, audit logs.

   ```bash
   cd infra/terraform/envs/dev
   terraform init
   terraform apply
   ```

   Freshly enabled APIs and new service accounts take minutes to propagate, so the first apply usually stops on errors
   such as "IAM API has not been used in project … before" or "Service account … does not exist": plan and apply
   again. A resource created by a failed apply is marked tainted; if `terraform plan` then wants to replace it, check it
   matches the configuration and `terraform untaint` it instead (custom role IDs stay reserved for weeks after
   deletion, and Cloud Run services have deletion protection). If Firestore already exists (created in the console),
   import it first:
   `terraform import module.ustpvote.google_firestore_database.default "projects/ustpvote2-dev/databases/(default)"`.

3. **Sign-in and App Check.** Register the Firebase web app, set `firebase_web_app_id` and apply again; set the
   password policy and the sign-in providers by hand: see [Identity Platform](#identity-platform) and
   [App Check and the web build](#app-check-and-the-web-build).

4. **GitHub environment and first image.** Set up the GitHub environment `dev` as in
   [Release workflow](#release-workflow), then run the workflow with roll-out off: the services do not exist yet.

   ```bash
   gh workflow run release.yml --ref main -f environment=dev -f roll_out=false
   ```

   It builds the image from `main`, pushes it to `image_repository` as `…/server`, attests it, deploys the Firestore
   rules and indexes and waits until every index is ready, and prints the digest in the run's summary.

5. **Second apply, with the image.** Creates `api` (public), `worker` (internal, invoker-only) and the `worker-tick`
   job. Put `server_image` in `terraform.tfvars` rather than passing it once: without it, a later apply would try to
   delete the services.

   ```bash
   terraform apply -var="server_image=us-central1-docker.pkg.dev/ustpvote2-dev/ustpvote/server@sha256:<digest>"
   ```

6. **First full release.** Run the workflow again with roll-out on (the default). It rolls the services onto this
   commit's image and then deploys the web app to Hosting, which refuses its rewrites until `api` and `mcp` exist:

   ```bash
   gh workflow run release.yml --ref main -f environment=dev
   ```

7. **Check.** `curl "$(terraform output -raw api_url)/v1/health"` answers, and so does
   `https://ustpvote2-dev.web.app/v1/health` through Hosting (not `/healthz`: Cloud Run's front end reserves some paths
   ending in "z", so that one only works for probes inside the container); Cloud Scheduler shows
   `worker-tick` succeeding every minute; the worker's log shows ticks and, once a ledger entry exists, a signed block
   and an anchor under `v1/` in the anchors bucket.

8. **First admins.** The people listed in `bootstrap_system_admin_emails` sign in and verify their email. Once real
   admins exist, set the list to `[]` and apply.

9. **Production only:** lock the anchors retention once USTP has settled Q11 ([Bucket Lock](#bucket-lock-production)).

### Releasing

Run the release workflow for the environment, from `main`:

```bash
gh workflow run release.yml --ref main -f environment=staging
```

One run releases everything from that commit, in this order:

1. **Build.** The web app for this environment (its public config read from the Firebase web app, App Check's site key
   from `RECAPTCHA_SITE_KEY`, the commit as `VITE_BUILD_COMMIT`), and the server image (`apps/server/Dockerfile`, the
   commit as `BUILD_COMMIT`), which it pushes and attests. Nothing live has changed yet; it also stops before this if
   `api`, `worker` or `mcp` is missing.
2. **Firestore rules and indexes** (`npx firebase deploy --only firestore`), then it waits until every composite and
   single-field index is `READY` ([`infra/firebase/wait-for-indexes.sh`](../firebase/wait-for-indexes.sh), at most 30
   minutes; an index needing repair stops it). A query whose index is still building fails with `FAILED_PRECONDITION`,
   so the new server must not run before its indexes are built. Indexes no longer in `firestore.indexes.json` stay: the
   older server may still use them; delete them by hand later.
3. **Services.** It rolls the `worker`, the `api` and then the reporting MCP server `mcp` onto the image with
   `gcloud run services update`, and checks that the api answers with this commit and that `mcp` answers.
4. **Hosting** (`npx firebase deploy --only hosting`), last, so a page never runs against an api older than itself;
   then it checks that the site's `/version.json` and `/v1/health` report this commit. Pages left open notice the new
   version and offer a reload (design §15, "Version handshake").

If a step fails, the steps after it do not run and the summary says where it stopped; fix the cause and release again
(every step can be repeated). Terraform ignores the services' image, so a later apply neither reverts a release nor
needs to know about it; infrastructure changes still go through `terraform apply` by someone with Owner rights. To roll
back, revert the change on `main` and release again. Moving only the services to an earlier attested digest
(`gcloud run services update <service> --image=…@sha256:<digest>`) is quicker but leaves Hosting on the newer web app;
open pages then see the older api and wait rather than offer a reload.

Each environment builds its own image from the same commit, so staging and production run the same code but not
byte-identical images (builds are not reproducible). Promoting one digest from staging to production, by copying it
into the production repository and attesting it there, is not automated yet.

## Release workflow

[`.github/workflows/release.yml`](../../.github/workflows/release.yml) runs in GitHub Actions and reaches Google Cloud
as `ustp-release` through Workload Identity Federation: GitHub's OIDC token for the job is exchanged for short-lived
credentials, and no service account key exists. The identity provider (`release.tf`) accepts a token only from
`release.yml` as it is on `main`, from a job running in the GitHub environment named after the Terraform environment
(`dev`, `staging`, `prod`), in this repository matched by its numeric ID.

Per environment, once Terraform has been applied (step 2 above):

1. **Create the GitHub environment** with the same name (repository Settings → Environments, or
   `gh api -X PUT repos/ggrow3/USTPVote2/environments/dev`). Limit its deployment branches to `main`. For staging and
   production, add required reviewers, so that a second person approves each release (§2 "reviewed deploys").
   GitHub offers environments in private repositories only on paid plans, and required reviewers in private
   repositories only on GitHub Enterprise; on a public repository both are free (design Q14).
2. **Set its variables** from the Terraform output:

   ```bash
   terraform output -json github_environment_variables | jq -r 'to_entries[] | "\(.key) \(.value)"' | while read -r name value; do gh variable set "$name" --env dev --body "$value"; done
   ```

   `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_IMAGE`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_RELEASE_SERVICE_ACCOUNT`,
   `GCP_ATTESTOR_KEY_VERSION`, `RECAPTCHA_SITE_KEY` and, once `firebase_web_app_id` is set, `FIREBASE_WEB_APP_ID`.
   None is secret. Run it again whenever the output changes; a release with roll-out on stops before changing anything
   while either of the last two is missing.

CI builds the same image on every pull request and starts all three entrypoints (`apps/server/scripts/smoke-image.sh`),
so a broken Dockerfile shows up before a release.

## Manual steps

### Identity Platform

Terraform (`identity.tf`) enables Identity Platform (it upgrades Firebase Authentication, which cannot be undone) and
sets email sign-in with a password or an email link, phone and anonymous sign-in off, authenticator-app (TOTP) second
factors with `adjacentIntervals: 5` and no SMS (design §4), and the authorized domains: `ustpvote2-<env>.web.app`,
`ustpvote2-<env>.firebaseapp.com`, and `localhost` outside production. Per project, by hand:

- **Password policy** (§4, NIST SP 800-63B-4): minimum length 15, up to 4096, no composition rules, enforced. The
  provider cannot set it; with an Owner's credentials:

  ```bash
  curl -X PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/ustpvote2-dev/config?updateMask=passwordPolicyConfig" -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: ustpvote2-dev" -H "Content-Type: application/json" -d '{"passwordPolicyConfig":{"passwordPolicyEnforcementState":"ENFORCE","forceUpgradeOnSignin":false,"passwordPolicyVersions":[{"customStrengthOptions":{"minPasswordLength":15,"maxPasswordLength":4096}}]}}'
  ```

- **Email-enumeration protection** (§4): the same answer for a wrong password and an unknown address. API-only:

  ```bash
  curl -X PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/ustpvote2-dev/config?updateMask=emailPrivacyConfig.enableImprovedEmailPrivacy" -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: ustpvote2-dev" -H "Content-Type: application/json" -d '{"emailPrivacyConfig":{"enableImprovedEmailPrivacy":true}}'
  ```

- **Bot resistance for email/password** (§4): reCAPTCHA Enterprise on sign-up, sign-in and email links. Identity
  Platform creates and manages its own reCAPTCHA keys ("Key for Identity Platform reCAPTCHA integration"; never edit
  or delete them), but only once **Identity Platform's service agent exists and holds its role**. Without it no key is
  created, `GET /v2/recaptchaConfig` answers 500 for every visitor, and with enforcement on, email/password sign-in
  fails. In order:

  ```bash
  # 1. The service agent and its role (Google's documented prerequisite; new projects have neither)
  curl -X POST "https://serviceusage.googleapis.com/v1beta1/projects/ustpvote2-dev/services/identitytoolkit.googleapis.com:generateServiceIdentity" -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: ustpvote2-dev" -H "Content-Type: application/json" -d '{}'
  gcloud projects add-iam-policy-binding ustpvote2-dev --member="serviceAccount:service-<project number>@gcp-sa-identitytoolkit.iam.gserviceaccount.com" --role=roles/identitytoolkit.serviceAgent --condition=None
  # 2. Audit first: keys are created and scores logged, nothing is blocked
  curl -X PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/ustpvote2-dev/config?updateMask=recaptchaConfig.emailPasswordEnforcementState,recaptchaConfig.managedRules" -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: ustpvote2-dev" -H "Content-Type: application/json" -d '{"recaptchaConfig":{"emailPasswordEnforcementState":"AUDIT","managedRules":[{"endScore":0.3,"action":"BLOCK"}]}}'
  ```

  3. Check `https://identitytoolkit.googleapis.com/v2/recaptchaConfig?clientType=CLIENT_TYPE_WEB&version=RECAPTCHA_ENTERPRISE&key=<web API key>`
     answers 200 with a `recaptchaKey` (provisioning can take minutes).
  4. Only then repeat step 2 with `"ENFORCE"` (scores at or below `endScore` are blocked). To back out at any point,
     set `"OFF"`.

  The Firebase console's Fraud Defense panel only covers SMS; email/password reCAPTCHA has no console switch.
- **Google, Microsoft and Apple sign-in** (§4): each needs an OAuth client registered with that company. Google's is
  one click in the Firebase console (Authentication → Sign-in method → Google), which creates the client. The admin
  sign-in switches turn a provider off in the api without touching this configuration.
- **Email sender** and templates once the sender domain is decided (Q15).

### App Check and the web build

- Register a web app in the Firebase project once (console, `firebase apps:create web`, or the Firebase Management
  API's `webApps.create`), and set its app ID as `firebase_web_app_id` in `terraform.tfvars`. Its config
  (`webApps/<id>/config`) gives `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` and
  `VITE_FIREBASE_APP_ID`.
- Terraform creates a reCAPTCHA Enterprise key for the Hosting domains and, once `firebase_web_app_id` is set, registers
  it as the web app's App Check provider. Its site key is the output `recaptcha_site_key`
  (`VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`).
- The api enforces App Check itself on every route; console enforcement only affects Firebase products clients call
  directly, and there are none.

### Firebase Hosting

`firebase.json` at the repository root serves `apps/web/dist` and rewrites `/v1/**` to the Cloud Run service `api` and
`/mcp` to the reporting MCP server `mcp`, both in `us-central1`. Hosting refuses a rewrite to a service that does not
exist, so deploy it after the apply that creates `mcp`. The file sits at the root because the Firebase CLI only publishes folders inside the one holding
`firebase.json`. If `region` ever changes, change the rewrite with it. The [release workflow](#releasing) builds and
deploys the web app and the Firestore rules and indexes, `firestore` and `hosting` only: the deny-all Storage rules
apply only to buckets linked to Firebase Storage, and the anchors and photos buckets are plain Cloud Storage buckets
governed by IAM alone.

By hand, only when the workflow cannot run: write `apps/web/.env.<env>.local` (git-ignored) with the web app's config
and the `recaptcha_site_key` output (above), `npm run build -w apps/web -- --mode <env>`, then
`npx firebase deploy --project ustpvote2-<env> --only hosting`, in the same order as a release (Firestore and the
services first). Such a build has no commit, so its pages never offer a reload.

### Bucket Lock (production)

The anchors bucket always has a retention policy; in production it is also **locked** (design §8.4, §15). Locking is
irreversible: the period can then only be increased, no anchor can be deleted before it is that old, and the bucket
cannot be deleted while it holds any object. In dev and staging the policy stays unlocked, and a project owner could
remove it.

1. USTP confirms the retention period (Q11; default 10 years = 3653 days).
2. Run production unlocked (`anchors_retention_locked = false` in `envs/prod/terraform.tfvars`) until the worker is
   writing anchors under `v1/blocks/` and `v1/keys/`.
3. Set `anchors_retention_days` to the confirmed period and `anchors_retention_locked = true`. `terraform plan` must
   show only the anchors bucket's `retention_policy.is_locked` changing from `false` to `true`.
4. Apply, then check that `gcloud storage buckets describe gs://ustpvote2-prod-anchors` reports the policy as locked.

The production root has no default for `anchors_retention_locked`, so the decision is always written down.

### Bylaws check

The advisory bylaws check (design §5.2) is off until switched on per environment. When on, the worker sends bylaws
drafts to Anthropic's API, which costs money per check and takes the text outside Google Cloud (design §15), so USTP
should agree to it first. Terraform creates the empty `anthropic-api-key` secret; the key itself never passes through
Terraform or its state.

1. Create an API key for USTP's Anthropic organization (Console → API keys), ideally in a workspace of its own with a
   monthly spend limit.
2. A System Admin adds it in the app, under **Admin › Claude** (design §5.6). The api tries it with Anthropic, keeps it
   as the secret's only live version and ledgers who added it; nobody can read it back through the app. (Adding it as a
   version with `gcloud secrets versions add anthropic-api-key --project <project> --data-file=-` works too; the panel
   then shows it as added outside the app.)
3. Set `bylaws_check_enabled = true` in the environment's `terraform.tfvars` and apply: both services get
   `BYLAWS_CHECKER=claude`, and the `worker-bylaws-checks` Scheduler job starts calling `POST /tasks/bylaws-checks` every
   minute. Steps 2 and 3 can come in either order: until there is a key, asking for a check answers that none has been
   added.

The worker reads the key each time it runs checks, so replacing it under Admin › Claude takes effect from the next run,
with no release or restart; the older versions are destroyed. Removing it there stops every Claude check. To switch the
check off, set the variable back to `false` and apply; the secret and past checks stay.

### Consistency check

The platform consistency check (design §5.5) is switched on separately from the bylaws check, because voters can ask
for it: anyone on an election's roll, and each Election Admin and Auditor, may run it once per election. When on, the
worker sends the election's proposals, the party's constitution and Bill of Rights (read from transhumanist-party.org)
and the bylaws in force to Anthropic's API; each check costs money (design §15), and the server takes at most 100 a day.
USTP should agree to it first (design Q18). It uses the same Anthropic API key as the bylaws check.

1. If no key has been added yet, a System Admin adds one as in [Bylaws check](#bylaws-check), steps 1 and 2. Until
   then the button stays hidden.
2. Set `consistency_check_enabled = true` in the environment's `terraform.tfvars` and apply: both services get
   `CONSISTENCY_CHECKER=claude`, and the `worker-consistency-checks` Scheduler job starts calling
   `POST /tasks/consistency-checks` every minute.
3. Deploy the Firestore indexes (`npx firebase deploy --project <project> --only firestore`): the worker's query for
   queued checks needs the `consistency_checks` index.

Switching it off (`false`, apply) stops new checks and hides the button; people can still read the checks they ran.

### Election setup check

The election setup check (design §6.9) is switched on separately too, because what it sends differs and its notes are
shown to every user: an Election Admin or Auditor asks for it in the election editor, once per version of an election,
and once the election is scheduled everyone sees its notes beside the contests on the ballot and results pages. When
on, the worker sends the election's rules, the offices its contests fill and its proposal texts, with the current
bylaws, to Anthropic's API; never candidates' names or statements, the roll, ballots or who asked. Each check costs
money (design §15), at most 20 a day per person. USTP should agree to it first (design Q18). It uses the same Anthropic
API key as the bylaws check.

1. If no key has been added yet, a System Admin adds one as in [Bylaws check](#bylaws-check), steps 1 and 2. Until
   then the editor's card stays hidden.
2. Set `election_check_enabled = true` in the environment's `terraform.tfvars` and apply: both services get
   `ELECTION_CHECKER=claude`, and the `worker-election-checks` Scheduler job starts calling
   `POST /tasks/election-checks` every minute.
3. Deploy the Firestore indexes (`npx firebase deploy --project <project> --only firestore`): the queries for an
   election's checks, a person's daily limit and the worker's queued checks need the `election_checks` indexes.

Switching it off (`false`, apply) stops new checks and hides the editor's button; the notes of checks already run are
still shown beside the contests.

### Election notices

The worker emails everyone on an election's roll when voting opens, and a day before it closes reminds those who have
not voted (design §6.8), through **Amazon SES**. Until `mail_transport = "ses"` nothing is sent. The AWS side is set up
by hand; this Terraform creates only the two empty secrets (`aws-ses-access-key-id`, `aws-ses-secret-access-key`), and
the key never passes through Terraform or its state. USTP has no AWS account or verified domain for this yet. In the
commands, `us-east-1` is `ses_region`, `<account>` the AWS account ID, `<env>` the environment.

1. **AWS account and SES identity.** In an AWS account of USTP's, open SES in `us-east-1` and verify the domain
   `transhumanist-party.org` (Identities → Create identity → Domain, Easy DKIM, RSA 2048): publish the three DKIM `CNAME`
   records it lists in the domain's DNS. For SPF alignment set a custom MAIL FROM domain (`mail.transhumanist-party.org`:
   the `MX` and `TXT` records SES lists). If the domain has no DMARC record yet, add one (`_dmarc` `TXT`
   `v=DMARC1; p=none; rua=mailto:<a mailbox USTP reads>`), and tighten it later.
2. **Leave the sandbox.** A new account may only send to verified addresses, 200 a day. Request production access
   (Account dashboard → Request production access): transactional mail, election notices to party members who are
   registered voters in the party's elections, one or two a member per election, bounces handled automatically. The
   sending quota (often 50,000 a day, 14 a second) must exceed the largest roll; `ses_max_send_rate` (10 a second) must
   stay under the rate.
3. **Bounce queue.** Bounces reach the worker through SNS and SQS, so nothing outside calls the api:
   ```
   aws sns create-topic --name ustp-notice-events-<env>
   aws sqs create-queue --queue-name ustp-notice-events-<env> --attributes MessageRetentionPeriod=1209600
   ```
   Give the queue an access policy that lets only that topic send to it (`sqs:SendMessage`, condition `aws:SourceArn` =
   the topic's ARN), then subscribe the queue to the topic with raw message delivery:
   `aws sns subscribe --topic-arn <topic arn> --protocol sqs --notification-endpoint <queue arn> --attributes RawMessageDelivery=true`.
   Create the configuration set and send its bounces (and complaints, which the worker ignores) to the topic:
   ```
   aws sesv2 create-configuration-set --configuration-set-name ustp-notices
   aws sesv2 create-configuration-set-event-destination --configuration-set-name ustp-notices \
     --event-destination-name to-sqs \
     --event-destination 'Enabled=true,MatchingEventTypes=BOUNCE,COMPLAINT,SnsDestination={TopicArn=<topic arn>}'
   ```
   One configuration set per AWS account is enough; give each environment its own topic and queue, or the environments'
   workers would take each other's reports.
4. **An access key that can do only this.** Create an IAM user `ustpvote-worker-<env>` with no console access and this
   inline policy, then an access key for it:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "ses:SendEmail",
         "Resource": [
           "arn:aws:ses:us-east-1:<account>:identity/transhumanist-party.org",
           "arn:aws:ses:us-east-1:<account>:configuration-set/ustp-notices"
         ],
         "Condition": { "StringEquals": { "ses:FromAddress": "noreply@transhumanist-party.org" } }
       },
       {
         "Effect": "Allow",
         "Action": ["sqs:ReceiveMessage", "sqs:DeleteMessage"],
         "Resource": "arn:aws:sqs:us-east-1:<account>:ustp-notice-events-<env>"
       }
     ]
   }
   ```
5. **The key into Secret Manager**, typed or pasted on standard input so it stays out of shell history:
   `gcloud secrets versions add aws-ses-access-key-id --project <project> --data-file=-`, and the same for
   `aws-ses-secret-access-key`. Cloud Run will not start the worker with `mail_transport = "ses"` until both have a
   version.
6. **Switch it on** in the environment's `terraform.tfvars`: `mail_transport = "ses"`, `ses_events_queue_url` (the
   queue's URL), `ses_region` if not `us-east-1`, `web_origin` if the web app is not at `https://<project>.web.app`,
   and optionally `notice_contact` (where members ask about an election: an address or an https page; the emails say
   replies are not read). Apply. The From address is `mail_from` (default `USTP Elections
   <noreply@transhumanist-party.org>`), with no Reply-To. The worker refuses to start without the key or the web
   origin.
7. **In the app**, a System Admin opens Admin › Election emails: each email on or off, the reminder's lead time (a
   day by default), the contact for questions (it overrides `notice_contact`; with neither, nothing is mailed) and each
   email's subject and opening. Changes are ledgered as `notice.settings_changed`.

Then send yourself one: in testing mode, a rehearsal records its notices in the outbox only; to see a real one, put an
account of your own on a small election's roll. The election editor's "Email to voters" card shows how many went,
failed, bounced or were skipped.

To rotate the key, create a new one for the IAM user, add it as new versions of both secrets, roll the worker, then
delete the old key in IAM. To stop sending, set `mail_transport = "off"` and apply: notices already started wait, and
resume if it is switched back on while voting is still open.

## Things to know

- **Nothing here is easily undone.** KMS key rings and keys can never be deleted, so they and the anchors bucket have
  `prevent_destroy`; Firestore is only forgotten on destroy; Cloud Run services and Firestore have deletion protection.
  `terraform destroy` therefore stops at the keys by design.
- **Custom roles** (`ustpSecretCreator`, `ustpSecretDeleter`, `ustpBallotPoolWorker`) keep their IDs reserved for weeks
  after deletion; undelete them rather than recreate them. So does the `github` workload identity pool (30 days).
- **Firestore's location** is fixed at creation (default: the region; `firestore_location = "nam5"` for the
  multi-region).
- **Key rotation:** create a new `audit-signing` version, raise `audit_signing_key_version` and apply; the worker
  publishes each new public key (§8.3) and old versions stay enabled for verification.
- **Ballot-pool versions** destroyed by the worker stay restorable for `ballot_pool_destroy_scheduled_duration` (24 h),
  then are gone; the alert reports every destruction.
- **Cloud Tasks:** the `worker` queue exists, but no code enqueues yet. When it does, add the enqueuing service to
  `task_enqueuers` (it gets `cloudtasks.enqueuer` on the queue and may act as the invoker account).
- **Organization policies,** if the projects ever join an organization: Domain Restricted Sharing blocks the `allUsers`
  bindings (public api, public anchors); `constraints/run.allowedBinaryAuthorizationPolicies` stops anyone deploying a
  service without Binary Authorization; an `allServices` audit config there would turn Firestore Data Access logs on.
- **Images in another project** need the Cloud Run service agent of this project allowed to read that repository.
