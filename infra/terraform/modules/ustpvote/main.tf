# USTPVote2 infrastructure for one environment (one GCP project, design §15). See ../../README.md.

data "google_project" "this" {
  project_id = var.project_id
}

locals {
  labels = {
    app         = "ustpvote"
    environment = var.environment
  }

  firestore_location = coalesce(var.firestore_location, var.region)

  # The Cloud Run services and the Scheduler job need an image; the first apply runs without one.
  deploy = var.server_image != null

  # election-approvals.ts names each tie-break seed secret `tiebreak-seed-<electionId>-<uuid>` (design §6.1).
  tiebreak_seed_prefix = "tiebreak-seed-"

  # Where the web app is served: election notices and the reporting MCP server link there.
  web_origin = var.web_origin != "" ? var.web_origin : "https://${var.project_id}.web.app"

  audit_signing_key_version = "${google_kms_crypto_key.audit_signing.id}/cryptoKeyVersions/${var.audit_signing_key_version}"

  service_members = {
    api    = google_service_account.api.member
    worker = google_service_account.worker.member
  }
}

# Required APIs. Never disabled on destroy: other things in the project may use them.
resource "google_project_service" "this" {
  for_each = toset([
    # Platform
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    # Reading the developer log (design §14, Logging): errors grouped by stack trace, and a request's lines by trace.
    "clouderrorreporting.googleapis.com",
    "cloudtrace.googleapis.com",
    "serviceusage.googleapis.com",
    # Runtime: services, data, keys, triggers (design §3)
    "cloudkms.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudtasks.googleapis.com",
    "firestore.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "vision.googleapis.com",
    # Sign-in, App Check, Hosting and rules (design §4, §14, §15)
    "firebase.googleapis.com",
    "firebaseappcheck.googleapis.com",
    "firebasehosting.googleapis.com",
    "firebaserules.googleapis.com",
    "identitytoolkit.googleapis.com",
    "recaptchaenterprise.googleapis.com",
    # Supply chain (design §14)
    "artifactregistry.googleapis.com",
    "binaryauthorization.googleapis.com",
    "cloudbuild.googleapis.com",
    "containeranalysis.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
