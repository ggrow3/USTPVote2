# The public-records services' keys a System Admin adds in the app, under Admin › API keys (design §5.6), beside the
# Anthropic API key: the FEC's (api.data.gov), Open States' and Google Civic Information's, and the Bills page's
# Congress.gov and GovInfo key (design §5.14; without it the Bills page uses the FEC key). Each is optional. Terraform
# creates the secrets empty, so a key added in the app never passes through Terraform or its state; the app keeps it
# as the secret's only live version. A key added there is used in place of the deployment's own (fec_api_key,
# openstates_api_key, and civic.tf's generated key), which is used again once it is removed.
#
# Unlike the Anthropic key, the api reads these itself: it is the api that asks the services. So on these four
# secrets alone it may read the newest version (secretAccessor) as well as add and destroy versions
# (secretVersionManager). It reads them while running, about once a minute, so a change counts without a release.

locals {
  app_api_key_secrets = toset(["app-fec-api-key", "app-openstates-api-key", "app-civic-api-key", "app-congress-api-key"])
}

resource "google_secret_manager_secret" "app_api_key" {
  for_each = local.app_api_key_secrets

  project   = var.project_id
  secret_id = each.value
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.this]
}

resource "google_secret_manager_secret_iam_member" "api_app_api_key_versions" {
  for_each = local.app_api_key_secrets

  project   = var.project_id
  secret_id = google_secret_manager_secret.app_api_key[each.value].secret_id
  role      = "roles/secretmanager.secretVersionManager"
  member    = google_service_account.api.member
}

resource "google_secret_manager_secret_iam_member" "api_app_api_key_reader" {
  for_each = local.app_api_key_secrets

  project   = var.project_id
  secret_id = google_secret_manager_secret.app_api_key[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.api.member
}

# The worker reads the public bills on the Legislation page again from Congress.gov every six hours (design §5.14), so it
# reads the key the Bills page uses as the api does: the Congress.gov and GovInfo key added in the app, else the FEC key
# (any api.data.gov key works for Congress.gov). Reading only, on these two secrets alone.
locals {
  worker_bills_key_secrets = toset(["app-congress-api-key", "app-fec-api-key"])
}

resource "google_secret_manager_secret_iam_member" "worker_bills_key_reader" {
  for_each = local.worker_bills_key_secrets

  project   = var.project_id
  secret_id = google_secret_manager_secret.app_api_key[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.worker.member
}
