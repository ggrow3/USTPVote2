# The advisory bylaws check (design §5.2): the worker sends a draft to Claude (Anthropic's API) and records what it
# flags. Off unless bylaws_check_enabled; turning it on needs a version in the anthropic-api-key secret first
# (README "Bylaws check").

# Holds the Anthropic API key. Terraform creates the secret but never its value: a person adds it as a version, so the
# key stays out of Terraform state. Only the worker reads it (worker_secret_accessor), as ANTHROPIC_API_KEY.
resource "google_secret_manager_secret" "anthropic_api_key" {
  project   = var.project_id
  secret_id = "anthropic-api-key"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.this]
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
