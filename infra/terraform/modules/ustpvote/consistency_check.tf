# The platform consistency check (design §5.5): the worker sends an election's proposals to Claude (Anthropic's API),
# with the party's constitution, the Transhumanist Bill of Rights and the bylaws in force, and records what it finds
# inconsistent. Voters on a roll and Election Admins and Auditors may each ask once per election. Off unless
# consistency_check_enabled; it reads the same anthropic-api-key secret as the bylaws check (bylaws_check.tf), which
# needs a version first (README "Consistency check").

# Its own job, like the bylaws check's, so a review never holds up the tick or waits behind a bylaws check.
resource "google_cloud_scheduler_job" "consistency_checks" {
  count = local.deploy && var.consistency_check_enabled ? 1 : 0

  project          = var.project_id
  region           = var.region
  name             = "worker-consistency-checks"
  description      = "POST /tasks/consistency-checks on the worker every minute: run queued platform consistency checks (design §5.5, §13)."
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "300s"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker[0].uri}/tasks/consistency-checks"

    oidc_token {
      service_account_email = google_service_account.invoker.email
      audience              = google_cloud_run_v2_service.worker[0].uri
    }
  }

  depends_on = [google_cloud_run_v2_service_iam_member.worker_invoker]
}
