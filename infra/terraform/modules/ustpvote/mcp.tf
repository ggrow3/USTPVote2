# The reporting MCP server (design §3.4): read-only election reports for any AI assistant, at <site>/mcp through
# Firebase Hosting (firebase.json). The server image's third entrypoint, apps/mcp/dist/main.js, serving MCP's
# Streamable HTTP transport.
#
# It reads only the public api, through the site, as any visitor does, so its service account holds no role at all:
# no Firestore, KMS, Secret Manager or storage. Anyone may invoke it, because the data is public and Hosting proxies
# to it unauthenticated; max_instance_count caps what a flood of calls can cost.

resource "google_service_account" "mcp" {
  project      = var.project_id
  account_id   = "ustp-mcp"
  display_name = "USTPVote reporting MCP server"
  description  = "Cloud Run mcp: read-only reports from the public api. Holds no roles (design §3.4)."
  depends_on   = [google_project_service.this]
}

resource "google_cloud_run_v2_service" "mcp" {
  count = local.deploy ? 1 : 0

  project             = var.project_id
  name                = "mcp"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.deletion_protection
  labels              = local.labels

  binary_authorization {
    use_default = true
  }

  template {
    service_account = google_service_account.mcp.email
    # Firebase Hosting gives a proxied request 60 s; a first audit report scans the public ledger.
    timeout                          = "60s"
    max_instance_request_concurrency = 40
    labels                           = local.labels

    scaling {
      min_instance_count = 0
      max_instance_count = var.mcp_max_instances
    }

    containers {
      image   = var.server_image
      command = ["node"]
      args    = ["/app/apps/mcp/dist/main.js", "--http", "--host", "0.0.0.0"]

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      # The site, not the api's run.app URL: reports link there, and the CSV's links name the host it was fetched from.
      env {
        name  = "USTP_SITE"
        value = local.web_origin
      }

      startup_probe {
        http_get {
          path = "/health"
        }
        period_seconds    = 2
        timeout_seconds   = 2
        failure_threshold = 30
      }
    }
  }

  depends_on = [google_binary_authorization_policy.this]

  lifecycle {
    ignore_changes = [client, client_version, template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_service_iam_member" "mcp_public" {
  count = local.deploy ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.mcp[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
