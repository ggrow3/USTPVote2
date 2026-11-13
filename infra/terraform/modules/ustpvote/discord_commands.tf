# The Discord bot's slash commands (design §10.18, "Slash commands"): the server image's fourth entrypoint,
# apps/discord/dist/main.js. Discord sends each command and button press to <this service>/interactions, signed, and
# waits three seconds for the answer, so this is a small service of its own rather than a route of the api, which
# starts too slowly from cold.
#
# It reads only the public api, through the site, as any visitor does, and the key it checks Discord's signatures with
# is public too (the worker reads it from Discord and the api serves it), so its service account holds no role at all:
# no Firestore, KMS, Secret Manager or storage. Anyone may invoke it, because Discord calls it from the internet; a
# request Discord did not sign is answered 401 and nothing else. max_instance_count caps what a flood of calls can cost.
#
# Discord calls the run.app address directly, not through Firebase Hosting: one hop fewer inside the three seconds, and
# a release can go out to an environment where this has not been applied yet (release.yml rolls it only if it exists).
# The worker tells Discord the address and the commands by itself, once a token is set (DISCORD_INTERACTIONS_URL,
# run.tf); nobody pastes it into Discord's Developer Portal.

resource "google_service_account" "discord" {
  project      = var.project_id
  account_id   = "ustp-discord"
  display_name = "USTPVote Discord commands"
  description  = "Cloud Run discord: answers the Discord bot's slash commands from the public api. Holds no roles (design §10.18)."
  depends_on   = [google_project_service.this]
}

resource "google_cloud_run_v2_service" "discord" {
  count = local.deploy ? 1 : 0

  project             = var.project_id
  name                = "discord"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.deletion_protection
  labels              = local.labels

  binary_authorization {
    use_default = true
  }

  template {
    service_account = google_service_account.discord.email
    # Discord gives up after three seconds; the service answers by then or not at all.
    timeout                          = "10s"
    max_instance_request_concurrency = 80
    labels                           = local.labels

    scaling {
      min_instance_count = var.discord_min_instances
      max_instance_count = var.discord_max_instances
    }

    containers {
      image   = var.server_image
      command = ["node"]
      args    = ["/app/apps/discord/dist/main.js", "--host", "0.0.0.0"]

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      # The site, not the api's run.app URL: answers link there, and Hosting serves the public api under /v1.
      env {
        name  = "USTP_SITE"
        value = local.web_origin
      }

      startup_probe {
        http_get {
          path = "/health"
        }
        period_seconds    = 1
        timeout_seconds   = 1
        failure_threshold = 30
      }
    }
  }

  depends_on = [google_binary_authorization_policy.this]

  lifecycle {
    ignore_changes = [client, client_version, template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_service_iam_member" "discord_public" {
  count = local.deploy ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.discord[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

locals {
  # Where Discord sends commands. The worker tells Discord; the api shows it on the Discord admin page.
  discord_env = local.deploy ? { DISCORD_INTERACTIONS_URL = "${google_cloud_run_v2_service.discord[0].uri}/interactions" } : {}
}
