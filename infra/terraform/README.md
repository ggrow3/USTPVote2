# Infrastructure (Terraform)

Everything USTPVote2 needs in one GCP project per environment (design §15): APIs, the `api`, `worker` and invoker
service accounts with least-privilege IAM (§14), the Cloud KMS keys (§7.3, §8.3), the anchors, photos and videos
buckets (§5.3, §8.4, §10.10), Firestore, both Cloud Run services, the Cloud Scheduler tick and a Cloud Tasks
queue (§13), Binary Authorization (§14), the release workflow's identity, KMS audit logs and a break-glass alert.
Design open question Q13 (Terraform) and Q16 (`us-central1`) are assumed.

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
| [`aws`](aws) | Amazon SES for every environment's email, in USTP's AWS account: applied by hand, never by a workflow ("Email (Amazon SES)") |

Each environment root keeps its state in the GCS bucket `ustpvote2-<env>-tfstate` and needs Terraform 1.9 or newer and the
`hashicorp/google` provider 8.x. Each root's `.terraform.lock.hcl` pins the provider, with hashes for Linux, macOS and
Windows; Dependabot updates the three together. The `aws` root keeps its state in the prod bucket under the prefix
`aws-mail`, needs the `hashicorp/aws` provider 6.x, and is validated in CI alongside them. Copy `terraform.tfvars.example` to `terraform.tfvars` (git-ignored: it
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
| | `secretVersionManager` on `anthropic-api-key` only: add, list and destroy versions, never read one | Keeps the key a System Admin adds under Admin › API keys (§5.6); it cannot read it back |
| | `secretVersionManager` and `secretAccessor` on `app-fec-api-key`, `app-openstates-api-key` and `app-civic-api-key` only | Keeps the public-records keys a System Admin adds under Admin › API keys (§5.6), and reads them to ask those services |
| | `publicKeyViewer` on `ballot-pool` | Encrypts ballots locally to an election's public key; cannot decrypt (§7.3) |
| | Read, write, delete objects in the photos bucket | Profile photos (§5.3) |
| | Create and read objects in the videos bucket; never delete | Uploaded videos for lessons, news, the press kit and the hub, stored a part at a time and played back by byte range (§10.10) |
| | Read objects in the anchors bucket | Auditor verification downloads every anchor (`GET /v1/admin/audit/verify`) |
| | Cloud Vision | Needs no IAM role; the API only has to be enabled |
| `ustp-worker` | Firestore (`datastore.user`) | Clock, sealing, ledger (§13) |
| | `signer` and `publicKeyViewer` on `audit-signing` | Only the worker signs ledger blocks and rolls (§8.3) |
| | Create, get, decrypt with and destroy `ballot-pool` versions (custom role, on that key only) | One version per election, unwrapping at sealing, destruction after certification (§7.3, §13) |
| | Create and read objects in the anchors bucket; never delete | Write-once anchors; overwriting needs delete, which it lacks (§8.4) |
| | Access secrets | Tie-break seeds at tally (§9), the Anthropic API key for the bylaws, consistency and election setup checks, read each time it runs them (§5.4–§5.6, §6.9), the AWS key for election notices by SES (§6.8) |
| | Invoke `room-model` (while `room_model_enabled`) | Answers questions in the members' room with the self-hosted model (§5.10) |
| `ustp-worker-invoker` | Invoke the worker | Identity of the Scheduler tick and of Cloud Tasks; nothing else |
| `ustp-room-model` | Read and write objects in the room models bucket | The members' room's model loads its files from there; the pull job fetches them (§5.10) |
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
| `deletable_account_emails` | | | | `DELETABLE_ACCOUNT_EMAILS` (§4): accounts a System Admin may delete from the People tab, if they are not members; `[]` (default) for none |
| `firebase_web_app_id` | | | | The Firebase web app's ID; registers the reCAPTCHA key with App Check ([App Check](#app-check-and-the-web-build)) |
| `anchors_retention_days` | 3653 | 3653 | 3653 | Q11; 10 years |
| `anchors_retention_locked` | false (fixed) | false (fixed) | **required** | Bucket Lock, irreversible; see [Bucket Lock](#bucket-lock-production) |
| `anchors_public_read` | false | true | true | §8.4 recommendation: outsiders keep copies, browsers can fetch them |
| `image_publishers`, `attestation_signers` | | | | Further identities that may push or attest; `ustp-release` always may |
| `operator_members` | | | | `user:…` / `group:…` with read-only operations roles |
| `developer_data_members` | yes | yes | (absent) | People with Firestore data access |
| `alert_emails` | | | | Recipients of the KMS break-glass alert; empty means no alert policy |
| `task_enqueuers` | | | | `"api"` and/or `"worker"`; the api is added while `room_model_enabled` |
| `bylaws_check_enabled` | false | false | false | The advisory bylaws check with Claude, which sends drafts to Anthropic; see [Bylaws check](#bylaws-check) |
| `consistency_check_enabled` | false | false | false | The platform consistency check with Claude, once per person per election, which sends an election's proposals to Anthropic; see [Consistency check](#consistency-check) |
| `election_check_enabled` | false | false | false | The election setup check with Claude, once per version of an election, which sends its rules, offices and proposal texts with the bylaws to Anthropic, and whose notes every user sees; see [Election setup check](#election-setup-check) |
| `maps_enabled` | true | true | true | The Candidates page's Google map: the Maps JavaScript API and a browser key restricted to it and to the web app's origins; see [Candidates map](#candidates-map) |
| `fec_api_key`, `openstates_api_key` | "" | "" | "" | Free keys for the Your area page's public records: the FEC's candidate lists (empty: the shared `DEMO_KEY`) and Open States' state legislators (empty: left out); see [Your area records](#your-area-records) |
| `civic_enabled` | true | true | true | The ballot's contests from Google's Civic Information API on the Candidates and Your area pages, with a server key Terraform creates and keeps in Secret Manager; see [Your area records](#your-area-records) |
| `room_model_enabled` | false | false | false | The members' room's self-hosted model on one L4 GPU (about $1.05 an hour while warm), and the api queueing questions for the worker; see [Members' room model](#members-room-model) |
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
| `SES_REGION`, `SES_CONFIGURATION_SET`, `SES_MAX_SEND_RATE`, `SES_EVENTS_QUEUE_URL` | in `worker_env` when `mail_transport` is `ses`; the configuration set and queue from the `aws` root's outputs | | ● |
| `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY` | not output: the `aws-ses-*` secrets' latest versions, when `mail_transport` is `ses` ("Email (Amazon SES)") | | ● |
| `AUDIT_SIGNING_KEY_VERSION` | `audit_signing_key_version` (`…/cryptoKeys/audit-signing/cryptoKeyVersions/1`) | | ● |
| `BALLOT_POOL_KEY` | `ballot_pool_key` (`…/cryptoKeys/ballot-pool`) | ● | ● |
| `ANCHORS_BUCKET` | `anchors_bucket` (`<project>-anchors`) | ● | ● |
| `PHOTOS_BUCKET` | `photos_bucket` (`<project>-profile-photos`) | ● | |
| `VIDEOS_BUCKET` | `videos_bucket` (`<project>-videos`) | ● | |
| `BOOTSTRAP_SYSTEM_ADMIN_EMAILS` | from the variable, not output | ● | |
| `DELETABLE_ACCOUNT_EMAILS` | from the variable, not output; unset when empty | ● | |
| `GOOGLE_MAPS_BROWSER_KEY` | not output: the `maps-browser` API key's value, when `maps_enabled`; the api gives it to browsers for the Candidates map (design §5.8) | ● | |
| `FEC_API_KEY`, `OPENSTATES_API_KEY` | not output: `fec_api_key` and `openstates_api_key`, when set; the api's keys for the Your area page's public records (design §5.12) | ● | |
| `GOOGLE_CIVIC_API_KEY` | not output: the `google-civic-api-key` secret's latest version (the `civic-server` API key), when `civic_enabled`; the api's key for the ballot's contests (design §5.12) | ● | |
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

- **Password policy** (§4): minimum length 12, up to 4096, no composition rules, enforced, existing passwords not
  forced to change. It must not ask for more than the web app's `MIN_PASSWORD_LENGTH`, or sign-ups the form accepts
  fail; when lowering the minimum, change it here before releasing the web app. The provider cannot set it; with an
  Owner's credentials:

  ```bash
  curl -X PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/ustpvote2-dev/config?updateMask=passwordPolicyConfig" -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: ustpvote2-dev" -H "Content-Type: application/json" -d '{"passwordPolicyConfig":{"passwordPolicyEnforcementState":"ENFORCE","forceUpgradeOnSignin":false,"passwordPolicyVersions":[{"customStrengthOptions":{"minPasswordLength":12,"maxPasswordLength":4096}}]}}'
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
- **Email sender** and templates once the sender domain is decided (Q15). Sending them through Amazon SES from the
  environment's own domain is "Email (Amazon SES)" › "SES sign-in mail".

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
2. A System Admin adds it in the app, under **Admin › API keys** (design §5.6). The api tries it with Anthropic, keeps it
   as the secret's only live version and ledgers who added it; nobody can read it back through the app. (Adding it as a
   version with `gcloud secrets versions add anthropic-api-key --project <project> --data-file=-` works too; the panel
   then shows it as added outside the app.)
3. Set `bylaws_check_enabled = true` in the environment's `terraform.tfvars` and apply: both services get
   `BYLAWS_CHECKER=claude`, and the `worker-bylaws-checks` Scheduler job starts calling `POST /tasks/bylaws-checks` every
   minute. Steps 2 and 3 can come in either order: until there is a key, asking for a check answers that none has been
   added.

The worker reads the key each time it runs checks, so replacing it under Admin › API keys takes effect from the next run,
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

### Candidates map

The Candidates page (design §5.8) shows members' candidacies for public office on a Google map, with each district's
outline from the Census Bureau's TIGERweb boundaries. TIGERweb needs no key and no setup: the api asks it for the
districts of a kind in a state and for an outline, and keeps them a day. The map needs the Maps JavaScript API and a
browser key, which `maps.tf` creates when `maps_enabled` (the default): an API key `maps-browser` restricted to
`maps-backend.googleapis.com` and to the web app's origins (`https://<project>.web.app/*`, `…firebaseapp.com/*`, the
`web_origin` if set, and `http://localhost:*/*` outside prod). Terraform passes it to the api as
`GOOGLE_MAPS_BROWSER_KEY`, and `GET /v1/public/maps` gives it to every visitor's browser: it is public by nature, so
the restrictions are what protect it. Google bills map loads beyond its monthly free usage, on the project's billing
account. A custom domain added later needs its origin in `web_origin` (and an apply) before the map works there.

With `maps_enabled = false` the api has no key and the pages list the candidacies without a map. Locally the api
runs without a key unless `GOOGLE_MAPS_BROWSER_KEY` is set, and the integration tests use made-up districts
(`DISTRICTS=local`) instead of TIGERweb.

### Your area records

The Your area page (design §5.12) lists, for a signed-in member, who holds each office where they live and who runs for
it. Three public records feed it, each kept a day by the api: the `unitedstates/congress-legislators` data (members of
Congress; no key), the FEC's candidate lists (an api.data.gov key) and Open States (state legislators; its own key).
Both keys are free, and only a person can sign up for them (with an email address):

1. FEC: request a key at https://api.data.gov/signup/. Without one the api uses the FEC's shared `DEMO_KEY`, which
   allows only a few requests an hour from one address, so lists go missing on a busy day.
2. Open States: create an account at https://open.pluralpolicy.com/accounts/signup/ and copy the API key from its
   profile page. Without one the page leaves state legislators out and says so.

A System Admin can add them in the app, under **Admin › API keys** (design §5.6): the api tries each with its
service, keeps it as the only live version of `app-fec-api-key` or `app-openstates-api-key` (`api_keys.tf`, which
Terraform creates empty) and uses it within a minute, with no apply or release. Or put them in the environment's real
`terraform.tfvars` as `fec_api_key` and `openstates_api_key` and apply; Terraform passes them to the api as
`FEC_API_KEY` and `OPENSTATES_API_KEY`. A key added in the app comes first; removing it there goes back to the
deployment's. They are not secrets (they only meter use of public data), but they are kept out of the `api_env` output.

Two more sources need nothing from a person:

- **The ballot** (`civic_enabled`, on by default; `civic.tf`): Google's Civic Information API lists the contests and
  candidates on the ballot for the area's ZIP code, state and local ones too, but only while an election is loaded and
  never after its day. Terraform enables the API, creates the `civic-server` key (restricted to it) and keeps it in the
  `google-civic-api-key` secret, which only the api's service account can read; the api gets it as
  `GOOGLE_CIVIC_API_KEY`. A System Admin can put another key in its place under Admin › API keys (`app-civic-api-key`),
from a Google Cloud project of USTP's own, say. Google allows contests to be kept at most a day (less when its answer says so), and asks
  for no attribution beyond its own wording, which the pages use.
- **Biographies and experience**: Wikidata (CC0) and Wikipedia (CC BY-SA 4.0, credited on the page) need no key; the
  api asks them by the FEC candidate ID or Congress Bioguide ID, never by name.

Statewide, county and city offices, and state and local candidates outside an election, have no free record:
Communications Admins enter them under Admin › Communications. With the emulators (`DISTRICTS=local`) the api uses
made-up people, ballot and biographies instead of these records.

### Members' room model

The members' room (design §5.10) answers `/ask` with a self-hosted model, so nothing said in the room goes to an AI
company. With `room_model_enabled = true`, `room_model.tf` creates:

- **`room-model`**, a private Cloud Run service with one NVIDIA L4 GPU running Ollama (`ollama/ollama`, tag
  `room_model_ollama_version`, pulled through the project's `dockerhub` Artifact Registry repository), with Gemma 4 26B
  A4B for answers (`room_chat_model`, the 16 GB quantization-aware build) and EmbeddingGemma for search
  (`room_embed_model`, 768 dimensions, as the vector indexes expect). Only the worker's account holds `run.invoker`.
  It scales to zero after idling; while warm it costs about $1.05 an hour (GPU $0.67, plus 4 vCPU and 16 GiB), and the
  first question after a quiet spell waits a minute or two while it starts and loads the models. A new project gets 3
  L4s in a region on its first GPU deployment without a quota request; this service uses one.
- **`<project>-room-models`**, a bucket for the model files (about 17 GB), mounted by the service (writable, since
  Ollama makes its folders when it starts, even before the pull job has run).
- **`room-model-pull`**, a Cloud Run job that fetches the models into the bucket (8 vCPU and 32 GiB: it downloads them
  into its own memory, since Ollama's parallel, out-of-order writes stall on a Cloud Storage mount, then copies them to
  the bucket; about 5 minutes and a few cents a run). Run it once after the first apply, and again after changing either
  model:

  ```
  gcloud run jobs execute room-model-pull --region us-central1 --project <project> --wait
  ```

- The api's env (`ROOM_MODEL=ollama`, `TASKS_QUEUE`, `WORKER_URL`, `TASKS_INVOKER`) and the right to queue Cloud Tasks
  on the worker queue as the invoker account: each question becomes a task that calls the worker's
  `/tasks/room-assistant`, since an answer can take longer than a request through Hosting may wait. The worker gets
  `ROOM_MODEL_URL` and the model tags.

The image is a third party's, pinned to a release rather than attested by the release pipeline, so the service does not
ask Binary Authorization (design §14); it holds no secrets, and its account can only read and fetch its models.
EmbeddingGemma's licence is the Gemma Terms of Use; Gemma 4 is Apache 2.0.

Once it exists, a System Admin switches the server on and off in the app, under **Admin › Members' room**, with no
apply: off, nothing reaches it, so it scales to zero and bills nothing; on, the worker starts it at once (a `room-warm`
Cloud Task) so the next question need not wait.

With `room_model_enabled = false` (the default) `ROOM_MODEL` is `off`: the room's chat, decisions and action items work,
and `/ask` answers 503. Not yet tried against a real project: the GPU service, the bucket mount and the pull job, nor
that Docker Hub has `ollama/ollama` at the pinned tag (the release the developer machine ran in October 2026).
Locally the emulators use a stand-in (`ROOM_MODEL=local`); to try the real models, run Ollama on your machine, pull both
models, and start the api with `ROOM_MODEL=ollama ROOM_MODEL_URL=http://localhost:11434`.

### Email (Amazon SES)

The worker emails everyone on an election's roll when voting opens, a day before it closes reminds those who have not
voted, and sends Election Admins' test emails and added members' welcome emails (design §6.8, §5.13), through **Amazon
SES**, and reads what became of each message from SES's delivery reports. Until `mail_transport = "ses"` nothing is
sent. The AWS side is the separate root [`aws`](aws), in one AWS account for every environment; each environment gets
its own sender domain (prod `transhumanist-party.org`, the others `dev.` and `staging.` under it), configuration set,
SNS topic, SQS queue with a dead-letter queue, and two IAM users. Nothing secret is in its state: access keys are made
by hand below. This Google Terraform creates only the two empty secrets the worker's key goes into
(`aws-ses-access-key-id`, `aws-ses-secret-access-key`). USTP has no AWS account or verified domain for this yet.

The steps below are in order, and each has a heading of its own: the app's email setup check (Admin › Email) names the
one to go back to when something is not right.

#### SES account and Terraform

In an AWS account of USTP's, with an AWS login that may manage SES, SNS, SQS and IAM (and a gcloud login that may read
the prod state bucket), apply the root:

```bash
cd infra/terraform/aws
cp terraform.tfvars.example terraform.tfvars   # list fewer environments to set up only some
terraform init
terraform apply
```

It turns on SES's account-level suppression list for bounces (complaints are kept by the app, which only governs its
own mail: an account-level complaint would also stop a member's sign-in links), and creates for each environment the
domain identity with Easy DKIM (RSA 2048) and the MAIL FROM domain `mail.<domain>`, the configuration set
`ustp-mail-<env>` (reputation metrics on; opens, clicks and engagement metrics off) as the domain's default set, its
event destination (send, reject, bounce, complaint, delivery, delivery delay, rendering failure) to the topic
`ustp-mail-events-<env>`, the queue of the same name (14 days, redrive to `-dlq` after five receives), and the IAM users
`ustpvote-worker-<env>` and `ustpvote-smtp-<env>`.

#### SES DNS records

`terraform output dns_records` lists, for each environment, the records to publish wherever the party's domain is
served: three DKIM `CNAME`s, the MAIL FROM domain's `MX` and SPF `TXT`, and an advised DMARC `TXT` (`p=none`; leave it
out where the domain has one, and tighten it once reports look right; `dmarc_report_address` adds `rua`). SES checks
them on its own; the identity says verified, and DKIM and MAIL FROM say success, within hours.

#### SES production access

A new account may only send to verified addresses, 200 a day. Request production access (SES console → Account
dashboard → Request production access): transactional mail; election notices to party members who are registered
voters in the party's elections, one to three per member per election; sign-in and address-confirmation emails;
bounces and complaints handled automatically. The sending quota (often 50,000 a day, 14 a second) must exceed the
largest roll, and `ses_max_send_rate` (10 a second) stay under the rate.

#### SES worker key

Give the environment's worker an access key: the script creates one for `ustpvote-worker-<env>` and adds it on
standard input as the newest version of both secrets, so it is never printed or written down.

```bash
node infra/terraform/aws/scripts/worker-key.mjs --env dev --project ustpvote2-dev
```

The worker's key may only send from the environment's address through its configuration set, read and delete its
queue's reports, read the account, identity, configuration set and both queues for the setup check, and take an
address off the suppression list when its owner asks.

#### SES switch on

In the environment's `terraform.tfvars`: `mail_transport = "ses"`, `ses_events_queue_url` (the `aws` root's
`queue_urls` output), `ses_region` if not `us-east-1`, `web_origin` if the web app is not at
`https://<project>.web.app`, and optionally `notice_contact` (where members ask about an election: an address or an
https page; the emails say replies are not read). `mail_from` and `ses_configuration_set` default to the environment's
(`noreply@<its domain>`, `ustp-mail-<env>`). Apply. The worker refuses to start without the key or the web origin, and
Terraform refuses `ses` without the configuration set or the queue.

#### SES in the app

A System Admin opens Admin › Email: each email on or off, the reminder's lead time (a day by default), the contact
for questions (it overrides `notice_contact`; with neither, nothing is mailed) and each email's subject and opening.
Changes are ledgered as `notice.settings_changed`. Then send yourself one: "Send test email" on an election's "Email to
voters" card says whether your mail server took it. The card's counts (delivered, no report yet, bounced, marked as
spam, skipped) come from SES's delivery reports; an address that bounced for good or was marked as spam is not mailed
again.

The same tab's **email setup check** runs every hour by itself, or now with "Check now": it reads the account, the
sender domain, the configuration set, both queues and the DNS records, works out the bounce and complaint rates, and
sends three messages to SES's mailbox simulator to see their reports come back. Each check that is not right names the
step above that fixes it. With `alert_emails` set, a check that starts failing also emails those addresses (alert
policy `mail`, through Google, not SES).

#### SES sign-in mail

Identity Platform's own email (sign-in links, address confirmations, password resets) can go through SES's SMTP
interface too, from the environment's address, so it is DKIM-signed by the party's domain and its delivery reports
reach the worker like the app's: each member sees theirs on their Account page. Identity Platform cannot name a
configuration set, so the sender domain's default one (set by the `aws` root) publishes its reports. Switch it over in
this order, one environment at a time, dev first:

1. The DNS records are published, and the setup check shows the domain verified, DKIM and MAIL FROM successful.
2. Production access is granted: while the account is in the sandbox, sign-in links would reach almost nobody, and the
   check fails.
3. The worker sends through SES, the check's probe passes, and your own test email shows delivered.
4. Switch Identity Platform over. A new access key for the environment's SMTP user goes straight into the script on
   standard input, which derives the SES SMTP password from it and sets Identity Platform's custom SMTP; neither is
   printed or stored anywhere else:

   ```bash
   aws iam create-access-key --user-name ustpvote-smtp-dev --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text \
     | node infra/terraform/aws/scripts/identity-platform-smtp.mjs --project ustpvote2-dev --from noreply@dev.transhumanist-party.org
   ```

5. Send yourself a sign-in link, a password reset and an address confirmation; each shows on your Account page as
   delivered, and the check's "Sign-in email through SES" turns ok.
6. Staging after a clean week, then prod.

To switch back to Google's sender at once: `node infra/terraform/aws/scripts/identity-platform-smtp.mjs --project
<project> --off`. The email action handler (`callbackUri`, "Identity Platform") is a separate setting and is left as it
is. The worker reads Identity Platform's configuration for the check with the custom role `ustpAuthConfigViewer`
(`firebaseauth.configs.get` only).

#### SES key rotation

Run the worker-key script again (an IAM user holds two keys at most), roll the worker so it reads the new versions,
then delete the old key: `aws iam list-access-keys --user-name ustpvote-worker-<env>`, `aws iam delete-access-key`. To
stop sending, set `mail_transport = "off"` and apply: notices already started wait, and resume if it is switched back
on while voting is still open.

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
