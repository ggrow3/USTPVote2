# The advisory bylaws check (design §5.2): the worker sends a draft to Claude (Anthropic's API) and records what it
# flags. Off unless bylaws_check_enabled; it runs once a System Admin adds the Anthropic API key in the app (README
# "Bylaws check").

# Holds the Anthropic API key, for this check and the platform consistency check (consistency_check.tf). Terraform
# creates the secret but never its value: a System Admin adds the key in the app (Admin › API keys, design §5.6), which
# keeps it as the only live version, so the key stays out of Terraform state. The api may add and destroy versions but
# never read one (api_anthropic_key_versions); the worker reads the newest (worker_secret_accessor) each time it runs
# checks, so a key added or removed counts from the next run without a restart.
resource "google_secret_manager_secret" "anthropic_api_key" {
  project   = var.project_id
  secret_id = "anthropic-api-key"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.this]
}

# The api keeps the key a System Admin pastes, after trying it with Anthropic, as the newest version and destroys the
# older ones. secretVersionManager adds, lists and destroys versions but has no secretmanager.versions.access, so the
# internet-facing api can never read a key back.
resource "google_secret_manager_secret_iam_member" "api_anthropic_key_versions" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.anthropic_api_key.secret_id
  role      = "roles/secretmanager.secretVersionManager"
  member    = google_service_account.api.member
}

# Its own job rather than a tick step: a review takes a minute or two, longer than the tick's deadline, and must never
# hold up opening, closing or sealing elections. The deadline matches the worker's request timeout.
resource "google_cloud_scheduler_job" "bylaws_checks" {
  count = local.deploy && var.bylaws_check_enabled ? 1 : 0

  project          = var.project_id
  region           = var.region
  name             = "worker-bylaws-checks"
  description      = "POST /tasks/bylaws-checks on the worker every minute: run queued bylaws checks (design §5.2, §13)."
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "300s"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker[0].uri}/tasks/bylaws-checks"

    oidc_token {
      service_account_email = google_service_account.invoker.email
      audience              = google_cloud_run_v2_service.worker[0].uri
    }
  }

  depends_on = [google_cloud_run_v2_service_iam_member.worker_invoker]
}
