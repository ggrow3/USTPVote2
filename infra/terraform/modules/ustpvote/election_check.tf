# The election setup check (design §6.9): the worker sends an election's rules, the offices it fills and its proposal
# texts to Claude (Anthropic's API), with the current bylaws, and records where the setup may not match them. An
# Election Admin or Auditor asks for it, once per version of an election; once the election is scheduled, every user
# sees its notes beside the contests. Off unless election_check_enabled; it uses the same Anthropic API key as the bylaws
# check (bylaws_check.tf), which a System Admin adds in the app (README "Election setup check").

# Its own job, like the bylaws and consistency checks', so a review never holds up the tick or waits behind another check.
resource "google_cloud_scheduler_job" "election_checks" {
  count = local.deploy && var.election_check_enabled ? 1 : 0

  project          = var.project_id
  region           = var.region
  name             = "worker-election-checks"
  description      = "POST /tasks/election-checks on the worker every minute: run queued election setup checks (design §6.9, §13)."
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "300s"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker[0].uri}/tasks/election-checks"

    oidc_token {
      service_account_email = google_service_account.invoker.email
      audience              = google_cloud_run_v2_service.worker[0].uri
    }
  }

  depends_on = [google_cloud_run_v2_service_iam_member.worker_invoker]
}
