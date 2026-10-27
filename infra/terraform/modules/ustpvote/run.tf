# The api and worker Cloud Run services: one image, two entrypoints, two service accounts (design §3.1, §15).
#
# server_image is the image the services are created with. After that the release workflow (release.tf) rolls them
# onto each new attested image, and Terraform leaves the image alone, so an apply never rolls a release back.
#
# Environment variables are named exactly as apps/server/src/config.ts reads them; each service gets the ones it
# uses. Nothing here sets APP_CHECK_ENFORCED, ADMIN_MFA_REQUIRED, PHOTO_CHECKER, SECRET_STORE, AUDIT_SIGNER,
# BALLOT_POOL or an emulator host, so every safety switch keeps its production default (design §4). BYLAWS_CHECKER is
# "claude" or "off" (bylaws_check.tf), never the emulator-only stand-in.

locals {
  # api: Secret Manager (creating tie-break seeds), encrypting ballots to an election's pool key, Auditor verification
  # of anchors, profile photos, bootstrap System Admins, and testing mode, which the api also refuses in prod.
  api_env = merge(
    {
      GOOGLE_CLOUD_PROJECT          = var.project_id
      DEPLOYMENT_ENVIRONMENT        = var.environment
      BALLOT_POOL_KEY               = google_kms_crypto_key.ballot_pool.id
      ANCHORS_BUCKET                = google_storage_bucket.anchors.name
      PHOTOS_BUCKET                 = google_storage_bucket.photos.name
      BOOTSTRAP_SYSTEM_ADMIN_EMAILS = join(",", var.bootstrap_system_admin_emails)
      BYLAWS_CHECKER                = local.bylaws_checker
    },
    var.testing_mode ? { TESTING_MODE = "true" } : {},
  )

  # worker: Secret Manager (reading seeds at tally), signing ledger blocks and rolls, pool key versions and sealing,
  # writing anchors, running bylaws checks (with ANTHROPIC_API_KEY from Secret Manager, below), and sending election
  # notices, which link to the web app (design §6.8).
  worker_env = merge(
    {
      GOOGLE_CLOUD_PROJECT      = var.project_id
      DEPLOYMENT_ENVIRONMENT    = var.environment
      AUDIT_SIGNING_KEY_VERSION = local.audit_signing_key_version
      BALLOT_POOL_KEY           = google_kms_crypto_key.ballot_pool.id
      ANCHORS_BUCKET            = google_storage_bucket.anchors.name
      BYLAWS_CHECKER            = local.bylaws_checker
      WEB_ORIGIN                = var.web_origin != "" ? var.web_origin : "https://${var.project_id}.web.app"
    },
    var.mail_from != "" ? { MAIL_FROM = var.mail_from } : {},
    var.mail_reply_to != "" ? { MAIL_REPLY_TO = var.mail_reply_to } : {},
    # Rehearsals' notices go to the outbox in testing mode (design §10.4), so the worker must know it is on too.
    var.testing_mode ? { TESTING_MODE = "true" } : {},
  )

  # The api queues bylaws checks and the worker runs them, so both must agree.
  bylaws_checker = var.bylaws_check_enabled ? "claude" : "off"
}

# --- api ---------------------------------------------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "api" {
  count = local.deploy ? 1 : 0

  # Firebase Hosting rewrites /v1/** to the service ID `api` in this region (firebase.json), and
  # reaches it over the internet, so ingress is open.
  project             = var.project_id
  name                = "api"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.deletion_protection
  labels              = local.labels

  binary_authorization {
    use_default = true
  }

  template {
    service_account                  = google_service_account.api.email
    timeout                          = "60s"
    max_instance_request_concurrency = 80
    labels                           = local.labels

    scaling {
      min_instance_count = 0
      max_instance_count = var.api_max_instances
    }

    containers {
      image   = var.server_image
      command = ["node"]
      args    = ["dist/main-api.js"]

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = var.api_memory
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = {
          for name, value in local.api_env : name => value
          if name != "BOOTSTRAP_SYSTEM_ADMIN_EMAILS" || length(var.bootstrap_system_admin_emails) > 0
        }
        content {
          name  = env.key
          value = env.value
        }
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
        period_seconds    = 2
        timeout_seconds   = 2
        failure_threshold = 30
      }
    }
  }

  depends_on = [google_binary_authorization_policy.this, google_firestore_database.default]

  lifecycle {
    ignore_changes = [client, client_version, template[0].containers[0].image]
  }
}

# Anyone may invoke the api: Firebase Hosting proxies to it unauthenticated, and the api itself requires an ID token
# and an App Check token on every route that is not @Public() (design §4).
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  count = local.deploy ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# --- worker ------------------------------------------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "worker" {
  count = local.deploy ? 1 : 0

  # Internal traffic only: Cloud Scheduler and Cloud Tasks in the same project count as internal. On top of that only
  # the invoker account may call it (below), so its /tasks routes need no sign-in of their own (design §13).
  project             = var.project_id
  name                = "worker"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = var.deletion_protection
  labels              = local.labels

  binary_authorization {
    use_default = true
  }

  template {
    service_account                  = google_service_account.worker.email
    timeout                          = "300s"
    max_instance_request_concurrency = 4
    labels                           = local.labels

    scaling {
      min_instance_count = 0
      max_instance_count = var.worker_max_instances
    }

    containers {
      image   = var.server_image
      command = ["node"]
      args    = ["dist/main-worker.js"]

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = var.worker_memory
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.worker_env
        content {
          name  = env.key
          value = env.value
        }
      }

      # Read when an instance starts, so a new key version takes effect on the next release or restart.
      dynamic "env" {
        for_each = var.bylaws_check_enabled ? [google_secret_manager_secret.anthropic_api_key.secret_id] : []
        content {
          name = "ANTHROPIC_API_KEY"
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
        period_seconds    = 2
        timeout_seconds   = 2
        failure_threshold = 30
      }
    }
  }

  depends_on = [google_binary_authorization_policy.this, google_firestore_database.default]

  lifecycle {
    ignore_changes = [client, client_version, template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_service_iam_member" "worker_invoker" {
  count = local.deploy ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.worker[0].name
  role     = "roles/run.invoker"
  member   = google_service_account.invoker.member
}

# --- Releases ----------------------------------------------------------------------------------------------------------

# ustp-release (release.tf) rolls both services onto each new attested image. run.developer on a service cannot change
# who may invoke it; Binary Authorization still refuses any image without an attestation.
resource "google_cloud_run_v2_service_iam_member" "release" {
  for_each = local.deploy ? {
    api    = google_cloud_run_v2_service.api[0].name
    worker = google_cloud_run_v2_service.worker[0].name
  } : {}

  project  = var.project_id
  location = var.region
  name     = each.value
  role     = "roles/run.developer"
  member   = google_service_account.release.member
}
