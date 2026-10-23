# Infrastructure (Terraform)

Everything USTPVote2 needs in one GCP project per environment (design §15): APIs, the `api`, `worker` and invoker
service accounts with least-privilege IAM (§14), the Cloud KMS keys (§7.3, §8.3), the anchors and photos buckets (§5.3,
§8.4), Firestore, both Cloud Run services, the Cloud Scheduler tick and a Cloud Tasks queue (§13), Binary Authorization
(§14), the release workflow's identity, KMS audit logs and a break-glass alert. Design open question Q13 (Terraform)
and Q16 (`us-central1`) are assumed.

Not managed here, and described [below](#manual-steps): Identity Platform (providers, MFA, password policy), adding
Firebase to the project, the App Check web registration, Firestore rules and indexes, and Firebase Hosting deploys.
Nothing has been applied to a real project yet.

## Layout

| Path | What |
|---|---|
| [`modules/ustpvote`](modules/ustpvote) | One environment. `main.tf` (APIs), `iam.tf`, `kms.tf`, `storage.tf`, `firestore.tf`, `run.tf`, `scheduling.tf`, `binauthz.tf`, `release.tf`, `logging.tf`, `outputs.tf` |
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
| | `publicKeyViewer` on `ballot-pool` | Encrypts ballots locally to an election's public key; cannot decrypt (§7.3) |
| | Read, write, delete objects in the photos bucket | Profile photos (§5.3) |
| | Read objects in the anchors bucket | Auditor verification downloads every anchor (`GET /v1/admin/audit/verify`) |
| | Cloud Vision | Needs no IAM role; the API only has to be enabled |
| `ustp-worker` | Firestore (`datastore.user`) | Clock, sealing, ledger (§13) |
| | `signer` and `publicKeyViewer` on `audit-signing` | Only the worker signs ledger blocks and rolls (§8.3) |
| | Create, get, decrypt with and destroy `ballot-pool` versions (custom role, on that key only) | One version per election, unwrapping at sealing, destruction after certification (§7.3, §13) |
| | Create and read objects in the anchors bucket; never delete | Write-once anchors; overwriting needs delete, which it lacks (§8.4) |
| | Access secrets | Tie-break seeds at tally (§9), later the email provider's credentials |
| `ustp-worker-invoker` | Invoke the worker | Identity of the Scheduler tick and of Cloud Tasks; nothing else |
| `ustp-release` | Push to the `ustpvote` Artifact Registry repository | The release workflow builds the server image |
| | Sign attestations for `ustpvote-reviewed` (attestor key, note, occurrences) | Binary Authorization lets only attested images run |
| | `run.developer` on `api` and `worker`; act as `ustp-api` and `ustp-worker` | Rolls the services onto a new image. It cannot change IAM, invokers or keys, nor read Firestore |
| | Only reachable from GitHub Actions: `release.yml` on `main`, in the GitHub environment named after this environment, in this repository (by ID) | Workload Identity Federation; there is no key |
| everyone | Invoke the api; read anchors if `anchors_public_read` | Hosting proxies unauthenticated; the api checks ID and App Check tokens itself |
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
| `bootstrap_system_admin_emails` | | | | `BOOTSTRAP_SYSTEM_ADMIN_EMAILS` (§4): at least two; `[]` once real admins exist |
| `firebase_web_app_id` | | | | The Firebase web app's ID; registers the reCAPTCHA key with App Check ([App Check](#app-check-and-the-web-build)) |
| `anchors_retention_days` | 3653 | 3653 | 3653 | Q11; 10 years |
| `anchors_retention_locked` | false (fixed) | false (fixed) | **required** | Bucket Lock, irreversible; see [Bucket Lock](#bucket-lock-production) |
| `anchors_public_read` | false | true | true | §8.4 recommendation: outsiders keep copies, browsers can fetch them |
| `image_publishers`, `attestation_signers` | | | | Further identities that may push or attest; `ustp-release` always may |
| `operator_members` | | | | `user:…` / `group:…` with read-only operations roles |
| `developer_data_members` | yes | yes | (absent) | People with Firestore data access |
| `alert_emails` | | | | Recipients of the KMS break-glass alert; empty means no alert policy |
| `task_enqueuers` | | | | `"api"` and/or `"worker"`, once code enqueues Cloud Tasks |
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
| `AUDIT_SIGNING_KEY_VERSION` | `audit_signing_key_version` (`…/cryptoKeys/audit-signing/cryptoKeyVersions/1`) | | ● |
| `BALLOT_POOL_KEY` | `ballot_pool_key` (`…/cryptoKeys/ballot-pool`) | ● | ● |
| `ANCHORS_BUCKET` | `anchors_bucket` (`<project>-anchors`) | ● | ● |
| `PHOTOS_BUCKET` | `photos_bucket` (`<project>-profile-photos`) | ● | |
| `BOOTSTRAP_SYSTEM_ADMIN_EMAILS` | from the variable, not output | ● | |
| `PORT` | set by Cloud Run (8080) | ● | ● |

Never set: `APP_CHECK_ENFORCED`, `ADMIN_MFA_REQUIRED`, `PHOTO_CHECKER`, `SECRET_STORE`, `AUDIT_SIGNER`, `BALLOT_POOL`
or an emulator host. Every safety switch then keeps its production default (§4).

| Consumer | Output |
|---|---|
| Firebase Hosting (`firebase.json` rewrite `run.serviceId` / `run.region`) | `api_service` (`api`, `us-central1`) |
| Web build (`apps/web/.env.example`) | `VITE_FIREBASE_PROJECT_ID` = the project; the other values come from the Firebase web app and reCAPTCHA key (below) |
| Release workflow (GitHub environment variables) | `github_environment_variables` (also `image_repository`, `attestor`, `attestor_key_version`, `release_service_account`) |
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

   It builds the image from `main`, pushes it to `image_repository` as `…/server`, attests it, and prints the digest in
   the run's summary.

5. **Second apply, with the image.** Creates `api` (public), `worker` (internal, invoker-only) and the `worker-tick`
   job. Put `server_image` in `terraform.tfvars` rather than passing it once: without it, a later apply would try to
   delete the services.

   ```bash
   terraform apply -var="server_image=us-central1-docker.pkg.dev/ustpvote2-dev/ustpvote/server@sha256:<digest>"
   ```

6. **Firestore rules and indexes, then Hosting**, from the repository root once the web app is built for this project
   (see [Firebase Hosting](#firebase-hosting)):

   ```bash
   npx firebase deploy --project ustpvote2-dev --only firestore,hosting
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

It builds the server image from that commit (`apps/server/Dockerfile`), pushes it, attests the digest, rolls the
`worker` and then the `api` onto it with `gcloud run services update`, and checks that the api answers. Terraform
ignores the services' image, so a later apply neither reverts a release nor needs to know about it; infrastructure
changes still go through `terraform apply` by someone with Owner rights. To roll back, revert the change on `main` and
release again, or move both services to an earlier attested digest with
`gcloud run services update <service> --image=…@sha256:<digest>`.

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

   `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_IMAGE`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_RELEASE_SERVICE_ACCOUNT` and
   `GCP_ATTESTOR_KEY_VERSION`. None is secret.

CI builds the same image on every pull request and starts both entrypoints (`apps/server/scripts/smoke-image.sh`), so
a broken Dockerfile shows up before a release.

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

- **Bot resistance and email-enumeration protection** (§4): reCAPTCHA Enterprise enforced for email/password sign-up,
  sign-in and email links (Identity Platform manages its own reCAPTCHA key; the web app loads its settings), and the
  same answer for a wrong password and an unknown address. Also API-only:

  ```bash
  curl -X PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/ustpvote2-dev/config?updateMask=recaptchaConfig.emailPasswordEnforcementState,emailPrivacyConfig.enableImprovedEmailPrivacy" -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: ustpvote2-dev" -H "Content-Type: application/json" -d '{"recaptchaConfig":{"emailPasswordEnforcementState":"ENFORCE"},"emailPrivacyConfig":{"enableImprovedEmailPrivacy":true}}'
  ```

  Set `"AUDIT"` instead of `"ENFORCE"` to only log bot scores while checking that sign-up still works.
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

`firebase.json` at the repository root serves `apps/web/dist` and rewrites `/v1/**` to the Cloud Run service `api` in
`us-central1`; it sits at the root because the Firebase CLI only publishes folders inside the one holding
`firebase.json`. Build the web app for the environment first: write `apps/web/.env.<env>.local` (git-ignored) with the
web app's config and the `recaptcha_site_key` output (above), then `npm run build -w apps/web -- --mode <env>`. If
`region` ever changes, change the rewrite with it. Deploy `firestore` and `hosting` only: the deny-all Storage rules apply
only to buckets linked to Firebase Storage, and the anchors and photos buckets are plain Cloud Storage buckets governed
by IAM alone.

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

## Things to know

- **Nothing here is easily undone.** KMS key rings and keys can never be deleted, so they and the anchors bucket have
  `prevent_destroy`; Firestore is only forgotten on destroy; Cloud Run services and Firestore have deletion protection.
  `terraform destroy` therefore stops at the keys by design.
- **Custom roles** (`ustpSecretCreator`, `ustpBallotPoolWorker`) keep their IDs reserved for weeks after deletion;
  undelete them rather than recreate them. So does the `github` workload identity pool (30 days).
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
