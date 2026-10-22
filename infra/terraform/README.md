# Infrastructure (Terraform)

Everything USTPVote2 needs in one GCP project per environment (design §15): APIs, the `api`, `worker` and invoker
service accounts with least-privilege IAM (§14), the Cloud KMS keys (§7.3, §8.3), the anchors and photos buckets (§5.3,
§8.4), Firestore, both Cloud Run services, the Cloud Scheduler tick and a Cloud Tasks queue (§13), Binary Authorization
(§14), KMS audit logs and a break-glass alert. Design open question Q13 (Terraform) and Q16 (`us-central1`) are assumed.

Not managed here, and described [below](#manual-steps): Identity Platform (providers, MFA, password policy), adding
Firebase to the project, the App Check web registration, Firestore rules and indexes, and Firebase Hosting deploys.
Nothing has been applied to a real project yet.

## Layout

| Path | What |
|---|---|
| [`modules/ustpvote`](modules/ustpvote) | One environment. `main.tf` (APIs), `iam.tf`, `kms.tf`, `storage.tf`, `firestore.tf`, `run.tf`, `scheduling.tf`, `binauthz.tf`, `logging.tf`, `outputs.tf` |
| [`envs/dev`](envs/dev) | `ustp-voting-dev`: anchors retention unlocked, Binary Authorization in dry run |
| [`envs/staging`](envs/staging) | `ustp-voting-staging`: production settings except the retention lock |
| [`envs/prod`](envs/prod) | `ustp-voting-prod`: Binary Authorization enforced, no human data access, retention lock stated explicitly |

Each root keeps its state in the GCS bucket `ustp-voting-<env>-tfstate` and needs Terraform 1.9 or newer and the
`hashicorp/google` provider 8.x. Copy `terraform.tfvars.example` to `terraform.tfvars` (git-ignored: it holds people's
addresses). Commit the `.terraform.lock.hcl` that `terraform init` writes in each root. Before applying a change, run:

```bash
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
```

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
| everyone | Invoke the api; read anchors if `anchors_public_read` | Hosting proxies unauthenticated; the api checks ID and App Check tokens itself |
| `operator_members` | View services, logs (including KMS Data Access logs), metrics, schedules, key metadata, IAM | Operations without Firestore data or key use (§14) |
| `developer_data_members` | Firestore data access | Debugging; refused in prod by a validation |
| `image_publishers` | Push to the `ustpvote` Artifact Registry repository | Build pipeline |
| `attestation_signers` | Sign attestations for `ustpvote-reviewed` | Release pipeline after review |

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
| `server_image` | | | | Server image by digest; null (default) skips the Cloud Run services and the tick |
| `bootstrap_system_admin_emails` | | | | `BOOTSTRAP_SYSTEM_ADMIN_EMAILS` (§4): at least two; `[]` once real admins exist |
| `anchors_retention_days` | 3653 | 3653 | 3653 | Q11; 10 years |
| `anchors_retention_locked` | false (fixed) | false (fixed) | **required** | Bucket Lock, irreversible; see [Bucket Lock](#bucket-lock-production) |
| `anchors_public_read` | false | true | true | §8.4 recommendation: outsiders keep copies, browsers can fetch them |
| `image_publishers`, `attestation_signers` | | | | Pipeline identities, e.g. `serviceAccount:release@…` |
| `operator_members` | | | | `user:…` / `group:…` with read-only operations roles |
| `developer_data_members` | yes | yes | (absent) | People with Firestore data access |
| `alert_emails` | | | | Recipients of the KMS break-glass alert; empty means no alert policy |
| `task_enqueuers` | | | | `"api"` and/or `"worker"`, once code enqueues Cloud Tasks |
| `project_id`, `region` | | | | Default to the environment's project and `us-central1` |

Fixed per root: Binary Authorization is a dry run in dev and enforced elsewhere. The module has further knobs with
sensible defaults (`kms_protection_level`, `audit_signing_key_version` for rotation,
`ballot_pool_destroy_scheduled_duration` = 24 h, `binauthz_extra_attestors`, sizing, `deletion_protection`); see
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
| Firebase Hosting (`infra/firebase/firebase.json` rewrite `run.serviceId` / `run.region`) | `api_service` (`api`, `us-central1`) |
| Web build (`apps/web/.env.example`) | `VITE_FIREBASE_PROJECT_ID` = the project; the other values come from the Firebase web app and reCAPTCHA key (below) |
| Release pipeline | `image_repository`, `attestor`, `attestor_key_version` |
| Mirrors and verifiers | `anchors_public_url` |
| Checks | `api_url`, `worker_url`, `service_accounts`, `tasks_queue` |

## Bringing an environment up

Examples use dev; replace `dev` throughout for the others. Run Terraform with an account that is Owner of the project
(`gcloud auth application-default login`).

1. **Project.** Create `ustp-voting-dev` with billing, then add Firebase to it, create the state bucket and enable the
   two APIs Terraform needs before it can enable the rest:

   ```bash
   npx firebase projects:addfirebase ustp-voting-dev
   gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com --project=ustp-voting-dev
   gcloud storage buckets create gs://ustp-voting-dev-tfstate --project=ustp-voting-dev --location=us-central1 --uniform-bucket-level-access --public-access-prevention
   gcloud storage buckets update gs://ustp-voting-dev-tfstate --versioning
   ```

2. **First apply, without an image.** Creates everything except the Cloud Run services and the tick: APIs, accounts,
   keys, buckets, Firestore, the image repository, the Tasks queue, Binary Authorization, audit logs.

   ```bash
   cd infra/terraform/envs/dev
   terraform init
   terraform apply
   ```

   If it fails creating the attestor because the new `attestor-signing` key version is still being generated, apply
   again. If Firestore already exists (created in the console), import it first:
   `terraform import module.ustpvote.google_firestore_database.default "projects/ustp-voting-dev/databases/(default)"`.

3. **Identity Platform and App Check**, by hand: see [Identity Platform](#identity-platform) and
   [App Check and the web build](#app-check-and-the-web-build).

4. **Image.** Build the server image, push it to `image_repository` as `…/server`, note its digest, and attest it (needed
   wherever Binary Authorization is enforced; harmless in dev):

   ```bash
   gcloud beta container binauthz attestations sign-and-create --project=ustp-voting-dev --artifact-url="us-central1-docker.pkg.dev/ustp-voting-dev/ustpvote/server@sha256:<digest>" --attestor=ustpvote-reviewed --attestor-project=ustp-voting-dev --keyversion="<attestor_key_version>"
   ```

   The repository has no Dockerfile yet. The image must start the services with `node dist/main-api.js` and
   `node dist/main-worker.js` from its working directory (design §15; Terraform sets that command) and listen on
   `$PORT`.

5. **Second apply, with the image.** Creates `api` (public), `worker` (internal, invoker-only) and the `worker-tick`
   job.

   ```bash
   terraform apply -var="server_image=us-central1-docker.pkg.dev/ustp-voting-dev/ustpvote/server@sha256:<digest>"
   ```

6. **Firestore rules and indexes, then Hosting**, from the repository root once the web app is built for this project
   (see [Firebase Hosting](#firebase-hosting)):

   ```bash
   npx firebase deploy --config infra/firebase/firebase.json --project ustp-voting-dev --only firestore,hosting
   ```

7. **Check.** `https://ustp-voting-dev.web.app/v1/healthz` answers through Hosting; Cloud Scheduler shows
   `worker-tick` succeeding every minute; the worker's log shows ticks and, once a ledger entry exists, a signed block
   and an anchor under `v1/` in the anchors bucket.

8. **First admins.** The people listed in `bootstrap_system_admin_emails` sign in and verify their email. Once real
   admins exist, set the list to `[]` and apply.

9. **Production only:** lock the anchors retention once USTP has settled Q11 ([Bucket Lock](#bucket-lock-production)).

### Releasing

Build, push and attest a new image as in step 4, then `terraform apply -var="server_image=…@sha256:<digest>"`. Both
services move to the same digest in one apply. Deploy through Terraform rather than `gcloud run deploy`, which would
drift from the configuration. To promote one build from staging to production, copy the image by digest into the
production repository (the digest does not change) and attest it there with the production attestor.

## Manual steps

### Identity Platform

Per project, in the console (Identity Platform) or with the Admin SDK:

- **Enable** Identity Platform (it upgrades Firebase Authentication).
- **Providers** (design §4): Google, Microsoft, Apple, and Email/Password with email link (passwordless) sign-in on.
  Leave phone and anonymous off (the api refuses those tokens anyway). The admin sign-in switches turn a provider off
  in the api without touching this configuration.
- **Authorized domains:** `ustp-voting-<env>.web.app`, `ustp-voting-<env>.firebaseapp.com` and any custom domain.
- **Password policy** (§4, NIST SP 800-63B-4): minimum length 15, at least 64 allowed, no composition rules, enforced.
- **MFA:** enable TOTP (authenticator apps) with `adjacentIntervals: 5`, using the Admin SDK call in design §4. Do not
  enable SMS.
- **Email sender** and templates once the sender domain is decided (Q15).

### App Check and the web build

- Register a web app in the Firebase project (console, or `firebase apps:create web`); its config gives `VITE_FIREBASE_API_KEY`,
  `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID`.
- Create a reCAPTCHA Enterprise key for the Hosting domains and register it as the web app's App Check provider; its
  site key is `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`.
- The api enforces App Check itself on every route; console enforcement only affects Firebase products clients call
  directly, and there are none.

### Firebase Hosting

`infra/firebase/firebase.json` serves `apps/web/dist` and rewrites `/v1/**` to the Cloud Run service `api` in
`us-central1`. Build the web app with that environment's `.env.<mode>.local` (above) before deploying. If `region`
ever changes, change the rewrite with it. Deploy `firestore` and `hosting` only: the deny-all Storage rules apply
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
4. Apply, then check that `gcloud storage buckets describe gs://ustp-voting-prod-anchors` reports the policy as locked.

The production root has no default for `anchors_retention_locked`, so the decision is always written down.

## Things to know

- **Nothing here is easily undone.** KMS key rings and keys can never be deleted, so they and the anchors bucket have
  `prevent_destroy`; Firestore is only forgotten on destroy; Cloud Run services and Firestore have deletion protection.
  `terraform destroy` therefore stops at the keys by design.
- **Custom roles** (`ustpSecretCreator`, `ustpBallotPoolWorker`) keep their IDs reserved for weeks after deletion;
  undelete them rather than recreate them.
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
