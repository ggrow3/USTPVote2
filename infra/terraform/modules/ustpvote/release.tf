# The release workflow (.github/workflows/release.yml; design §14, §15). GitHub Actions jobs running in this
# environment's GitHub environment exchange their OIDC token for the ustp-release service account through Workload
# Identity Federation; there is no service account key. ustp-release may push the server image, attest it for Binary
# Authorization, deploy the Firestore rules and indexes, roll the api, worker and mcp onto the image and deploy the web
# app to Firebase Hosting. It cannot change IAM, read or write Firestore documents or use any other key: infrastructure
# changes stay with whoever runs Terraform.

locals {
  # Static keys, so for_each is known on the first plan; the value refers to the account, so its grants wait for it.
  image_publishers    = merge({ for m in var.image_publishers : m => m }, { release = google_service_account.release.member })
  attestation_signers = merge({ for m in var.attestation_signers : m => m }, { release = google_service_account.release.member })

  # Read by release.yml from this environment's GitHub environment (output github_environment_variables). The web build
  # fetches the Firebase web app's public config with its ID; it is left out until firebase_web_app_id is set.
  github_environment_variables = {
    GCP_PROJECT_ID                 = var.project_id
    GCP_REGION                     = var.region
    GCP_IMAGE                      = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.server.repository_id}/server"
    GCP_WORKLOAD_IDENTITY_PROVIDER = google_iam_workload_identity_pool_provider.github.name
    GCP_RELEASE_SERVICE_ACCOUNT    = google_service_account.release.email
    GCP_ATTESTOR_KEY_VERSION       = data.google_kms_crypto_key_version.attestor.name
    FIREBASE_WEB_APP_ID            = var.firebase_web_app_id
    RECAPTCHA_SITE_KEY             = google_recaptcha_enterprise_key.web.name
  }
}

resource "google_service_account" "release" {
  project      = var.project_id
  account_id   = "ustp-release"
  display_name = "USTPVote release"
  description  = "GitHub Actions release workflow: the server image, Firestore rules and indexes, Hosting (design §15)."
  depends_on   = [google_project_service.this]
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "OIDC tokens from GitHub Actions in ${var.github_repository}."
  depends_on                = [google_project_service.this]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "ustpvote2-release"
  display_name                       = "USTPVote2 release workflow"
  description                        = "release.yml on main, GitHub environment ${var.environment}."

  # Only the release workflow as it is on main, running in the GitHub environment named after this environment, in this
  # repository. The repository is matched by its numeric ID, which survives renames and is never reused.
  attribute_condition = join(" && ", [
    "assertion.repository_id == '${var.github_repository_id}'",
    "assertion.workflow_ref == '${var.github_repository}/.github/workflows/release.yml@refs/heads/main'",
    "assertion.environment == '${var.environment}'",
  ])

  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.environment" = "assertion.environment"
  }

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "release_github" {
  service_account_id = google_service_account.release.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.environment/${var.environment}"
}

# A new revision runs as its service's account, so deploying one needs actAs on that account. The services themselves
# grant ustp-release run.developer (run.tf); pushing and attesting are granted with the image repository (storage.tf)
# and the attestor (binauthz.tf).
resource "google_service_account_iam_member" "release_act_as" {
  for_each = {
    api    = google_service_account.api.name
    worker = google_service_account.worker.name
    mcp    = google_service_account.mcp.name
  }

  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.release.member
}

# The release deploys the Firestore rules and indexes before the services and the web app after them, with the Firebase
# CLI (design §15). Definitions only: index and rules admin neither read nor write a document. Hosting Admin also lets
# the CLI find the default site and read the web app's public config for the build (firebase.projects.get and
# firebase.clients.get). Service Usage Consumer lets the CLI check that the Firestore API is enabled, billed to this
# project; it cannot enable or disable an API.
resource "google_project_iam_member" "release_firebase" {
  for_each = toset([
    "roles/datastore.indexAdmin",
    "roles/firebasehosting.admin",
    "roles/firebaserules.admin",
    "roles/serviceusage.serviceUsageConsumer",
  ])

  project = var.project_id
  role    = each.value
  member  = google_service_account.release.member
}
