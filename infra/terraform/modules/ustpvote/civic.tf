# The ballot on the Candidates and Your area pages (design §5.12): the Civic Information API's contests and candidates
# for a ZIP code, which only the api asks for. Google has them only while an election is loaded (from the Voting
# Information Project) and drops them after election day. Terraform creates a server key that works only for that API
# and keeps it in Secret Manager, where only the api reads it (GOOGLE_CIVIC_API_KEY, run.tf); the key is in Terraform
# state, like the Maps key. The api never hands it to a browser. Off with civic_enabled = false: the pages then list
# the FEC's candidates and admins' entries without the ballot.

resource "google_project_service" "civic" {
  # apikeys.googleapis.com is maps.tf's too; enabling it twice changes nothing, and neither disables it on destroy.
  for_each = var.civic_enabled ? toset(["apikeys.googleapis.com", "civicinfo.googleapis.com"]) : toset([])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_apikeys_key" "civic" {
  count = var.civic_enabled ? 1 : 0

  project      = var.project_id
  name         = "civic-server"
  display_name = "Google Civic ballot data for the api (server)"

  restrictions {
    api_targets {
      service = "civicinfo.googleapis.com"
    }
  }

  depends_on = [google_project_service.civic]
}

resource "google_secret_manager_secret" "civic_api_key" {
  count = var.civic_enabled ? 1 : 0

  project   = var.project_id
  secret_id = "google-civic-api-key"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.this]
}

resource "google_secret_manager_secret_version" "civic_api_key" {
  count = var.civic_enabled ? 1 : 0

  secret      = google_secret_manager_secret.civic_api_key[0].id
  secret_data = google_apikeys_key.civic[0].key_string
}

# The api reads this one secret, and no other: it has no project-wide access to secrets (iam.tf).
resource "google_secret_manager_secret_iam_member" "api_civic_key" {
  count = var.civic_enabled ? 1 : 0

  project   = var.project_id
  secret_id = google_secret_manager_secret.civic_api_key[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.api.member
}

locals {
  # Mounted on the api only when there is a key: Cloud Run will not start with a secret that has no version.
  civic_api_secrets = var.civic_enabled ? { GOOGLE_CIVIC_API_KEY = google_secret_manager_secret.civic_api_key[0].secret_id } : {}
}
