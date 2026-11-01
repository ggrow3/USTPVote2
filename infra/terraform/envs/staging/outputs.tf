output "audit_signing_key_version" {
  description = "AUDIT_SIGNING_KEY_VERSION (worker)."
  value       = module.ustpvote.audit_signing_key_version
}

output "ballot_pool_key" {
  description = "BALLOT_POOL_KEY (api and worker)."
  value       = module.ustpvote.ballot_pool_key
}

output "anchors_bucket" {
  description = "ANCHORS_BUCKET (api and worker)."
  value       = module.ustpvote.anchors_bucket
}

output "photos_bucket" {
  description = "PHOTOS_BUCKET (api)."
  value       = module.ustpvote.photos_bucket
}

output "videos_bucket" {
  description = "VIDEOS_BUCKET (api)."
  value       = module.ustpvote.videos_bucket
}

output "api_env" {
  description = "Environment of the api service, except BOOTSTRAP_SYSTEM_ADMIN_EMAILS."
  value       = module.ustpvote.api_env
}

output "worker_env" {
  description = "Environment of the worker service."
  value       = module.ustpvote.worker_env
}

output "api_service" {
  description = "Firebase Hosting rewrite target for /v1/**."
  value       = module.ustpvote.api_service
}

output "api_url" {
  value = module.ustpvote.api_url
}

output "worker_url" {
  value = module.ustpvote.worker_url
}

output "service_accounts" {
  value = module.ustpvote.service_accounts
}

output "tasks_queue" {
  value = module.ustpvote.tasks_queue
}

output "recaptcha_site_key" {
  value = module.ustpvote.recaptcha_site_key
}

output "anchors_public_url" {
  value = module.ustpvote.anchors_public_url
}

output "image_repository" {
  value = module.ustpvote.image_repository
}

output "attestor" {
  value = module.ustpvote.attestor
}

output "attestor_key_version" {
  value = module.ustpvote.attestor_key_version
}

output "release_service_account" {
  value = module.ustpvote.release_service_account
}

output "github_environment_variables" {
  description = "Variables for the GitHub environment staging (infra/terraform/README.md, Release workflow)."
  value       = module.ustpvote.github_environment_variables
}
