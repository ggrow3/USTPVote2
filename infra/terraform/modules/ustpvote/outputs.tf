# What the server, Firebase Hosting and the release pipeline need. See ../../README.md for the mapping.

output "project_id" {
  value = var.project_id
}

output "project_number" {
  value = data.google_project.this.number
}

output "region" {
  value = var.region
}

# --- Server configuration (apps/server/src/config.ts) ---------------------------------------------------------------

output "audit_signing_key_version" {
  description = "AUDIT_SIGNING_KEY_VERSION (worker)."
  value       = local.audit_signing_key_version
}

output "ballot_pool_key" {
  description = "BALLOT_POOL_KEY (api and worker)."
  value       = google_kms_crypto_key.ballot_pool.id
}

output "anchors_bucket" {
  description = "ANCHORS_BUCKET (api and worker)."
  value       = google_storage_bucket.anchors.name
}

output "photos_bucket" {
  description = "PHOTOS_BUCKET (api)."
  value       = google_storage_bucket.photos.name
}

output "videos_bucket" {
  description = "VIDEOS_BUCKET (api)."
  value       = google_storage_bucket.videos.name
}

output "api_env" {
  description = "Environment of the api service, except the people's addresses (BOOTSTRAP_SYSTEM_ADMIN_EMAILS, DELETABLE_ACCOUNT_EMAILS) and the Your area page's keys."
  value       = { for name, value in local.api_env : name => value if !contains(["BOOTSTRAP_SYSTEM_ADMIN_EMAILS", "DELETABLE_ACCOUNT_EMAILS", "FEC_API_KEY", "OPENSTATES_API_KEY"], name) }
}

output "worker_env" {
  description = "Environment of the worker service."
  value       = local.worker_env
}

# --- Services ----------------------------------------------------------------------------------------------------------

output "api_service" {
  description = "Firebase Hosting rewrite target for /v1/** (firebase.json: run.serviceId and run.region)."
  value = {
    serviceId = "api"
    region    = var.region
  }
}

output "api_url" {
  description = "The api's run.app URL (null until server_image is set). Browsers use it through Hosting, same-origin."
  value       = one(google_cloud_run_v2_service.api[*].uri)
}

output "worker_url" {
  description = "The worker's run.app URL (null until server_image is set); reachable only from inside the project."
  value       = one(google_cloud_run_v2_service.worker[*].uri)
}

output "mcp_url" {
  description = "The reporting MCP server's run.app URL (null until server_image is set). Clients use <site>/mcp, through Hosting."
  value       = one(google_cloud_run_v2_service.mcp[*].uri)
}

output "service_accounts" {
  description = "Runtime identities: api, worker, the reporting MCP server, and the invoker used by Cloud Scheduler and Cloud Tasks."
  value = {
    api     = google_service_account.api.email
    worker  = google_service_account.worker.email
    mcp     = google_service_account.mcp.email
    invoker = google_service_account.invoker.email
  }
}

output "tasks_queue" {
  description = "Cloud Tasks queue for one-off worker tasks (design §13)."
  value       = google_cloud_tasks_queue.worker.id
}

output "recaptcha_site_key" {
  description = "VITE_RECAPTCHA_ENTERPRISE_SITE_KEY for the web build (App Check)."
  value       = google_recaptcha_enterprise_key.web.name
}

# --- Public record (design §8.4) -------------------------------------------------------------------------------------

output "anchors_public_url" {
  description = "Base URL of the public anchor objects (v1/blocks/…, v1/keys/…), or null when they are private."
  value       = var.anchors_public_read ? "https://storage.googleapis.com/${google_storage_bucket.anchors.name}/" : null
}

# --- Release pipeline --------------------------------------------------------------------------------------------------

output "image_repository" {
  description = "Push the server image here as …/server, then deploy it by digest."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.server.repository_id}"
}

output "attestor" {
  description = "Binary Authorization attestor to attest each image digest with."
  value       = google_binary_authorization_attestor.reviewed.id
}

output "attestor_key_version" {
  description = "KMS key version for gcloud container binauthz attestations sign-and-create --keyversion."
  value       = data.google_kms_crypto_key_version.attestor.name
}

output "release_service_account" {
  description = "ustp-release, the identity of the release workflow."
  value       = google_service_account.release.email
}

output "github_environment_variables" {
  description = "Variables for this environment's GitHub environment, read by .github/workflows/release.yml."
  value       = { for name, value in local.github_environment_variables : name => value if value != null }
}
