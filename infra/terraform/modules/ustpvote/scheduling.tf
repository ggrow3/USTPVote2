# Worker triggers (design §3.1, §13): one Cloud Scheduler job for all periodic work, a Cloud Tasks queue for one-off
# work. Both call the worker with an OIDC token for the invoker account.

resource "google_cloud_scheduler_job" "tick" {
  count = local.deploy ? 1 : 0

  project          = var.project_id
  region           = var.region
  name             = "worker-tick"
  description      = "POST /tasks/tick on the worker every minute (design §13)."
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "120s"

  # A failed tick answers 500 and Scheduler records it; the next tick, a minute later, retries everything.
  retry_config {
    retry_count = 0
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker[0].uri}/tasks/tick"

    oidc_token {
      service_account_email = google_service_account.invoker.email
      audience              = google_cloud_run_v2_service.worker[0].uri
    }
  }

  depends_on = [google_cloud_run_v2_service_iam_member.worker_invoker]
}

# For tally, email and destroy-pool-key tasks (design §13). Nothing enqueues yet; see task_enqueuers.
resource "google_cloud_tasks_queue" "worker" {
  project  = var.project_id
  name     = "worker"
  location = var.region

  rate_limits {
    max_dispatches_per_second = 5
    max_concurrent_dispatches = 5
  }

  retry_config {
    max_attempts = 20
    min_backoff  = "10s"
    max_backoff  = "600s"
  }

  depends_on = [google_project_service.this]
}

resource "google_cloud_tasks_queue_iam_member" "enqueuers" {
  for_each = var.task_enqueuers

  project  = var.project_id
  location = google_cloud_tasks_queue.worker.location
  name     = google_cloud_tasks_queue.worker.name
  role     = "roles/cloudtasks.enqueuer"
  member   = local.service_members[each.value]
}

# Creating a task with an OIDC token for the invoker account requires acting as that account.
resource "google_service_account_iam_member" "enqueuers_act_as_invoker" {
  for_each = var.task_enqueuers

  service_account_id = google_service_account.invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = local.service_members[each.value]
}
