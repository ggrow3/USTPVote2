# The members' room's model on Vertex AI (design §5.10; README "Members' room model"), for a project with no Cloud Run
# GPU quota (room_model_host = "vertex"). The same Ollama, Gemma and EmbeddingGemma as on Cloud Run, from the same
# bucket, on one g2-standard-8 machine with an NVIDIA L4 in this project, so nothing said in the room goes to an AI
# company. Vertex AI scales it to zero after room_model_idle_minutes without a question; the first question after that
# waits several minutes while a machine starts and copies the models in.
#
# Terraform makes the endpoint; the worker's tick deploys the model to it (Terraform has no resource for a custom
# model's deployment), from the description in ROOM_MODEL_VERTEX, and takes it away while the model server is switched
# off or the month's budget is spent. The worker estimates each wake-up before starting one and refuses any that would
# take the month past room_model_monthly_budget_usd; with billing_account set, Google Cloud's budget for Vertex AI in
# this project checks the real bill and, through Pub/Sub, has the worker stop the model once it reaches the same sum.

locals {
  # The endpoint's number: fixed, one per project and region.
  room_vertex_endpoint_id = "1000"
  room_vertex_endpoint    = "projects/${var.project_id}/locations/${var.region}/endpoints/${local.room_vertex_endpoint_id}"

  # A dedicated endpoint (scaling to zero needs one) answers only at its own address; /invoke passes any path through
  # to Ollama, so the worker calls the same OpenAI-compatible routes as on Cloud Run.
  room_vertex_url = local.room_model_on_vertex ? join("", [
    "https://${local.room_vertex_endpoint_id}.${var.region}-${data.google_project.this.number}.prediction.vertexai.goog",
    "/v1/${local.room_vertex_endpoint}/invoke",
  ]) : null

  # What the worker deploys, in the Vertex AI API's own shapes (a Model to upload, a DeployedModel to deploy it as),
  # and the figures its estimate uses. A change to any of it is uploaded or deployed anew by the worker.
  room_vertex_env = local.room_model_on_vertex ? {
    ROOM_MODEL_VERTEX = jsonencode({
      endpoint         = local.room_vertex_endpoint
      hourlyUsd        = var.room_model_hourly_usd
      idleMinutes      = var.room_model_idle_minutes
      monthlyBudgetUsd = var.room_model_monthly_budget_usd
      model = {
        labels = local.labels
        containerSpec = {
          imageUri = var.room_model_image
          env = [for k, v in merge(local.room_ollama_env, {
            OLLAMA_NOPRUNE     = "true"
            ROOM_MODELS_BUCKET = google_storage_bucket.room_models[0].name
          }) : { name = k, value = v }]
          ports             = [{ containerPort = 8080 }]
          invokeRoutePrefix = "/*"
          healthRoute       = "/"
          # Starting a machine and copying the models in takes several minutes.
          deploymentTimeout = "1800s"
        }
      }
      deployedModel = {
        serviceAccount = google_service_account.room_model[0].email
        dedicatedResources = {
          machineSpec = {
            machineType      = "g2-standard-8"
            acceleratorType  = "NVIDIA_L4"
            acceleratorCount = 1
          }
          minReplicaCount     = 0
          maxReplicaCount     = 1
          initialReplicaCount = 1
          spot                = var.room_model_spot
          scaleToZeroSpec = {
            minScaleupPeriod    = "300s"
            idleScaledownPeriod = "${var.room_model_idle_minutes * 60}s"
          }
        }
      }
    })
  } : {}

  room_vertex_budget = local.room_model_on_vertex && var.billing_account != null
}

resource "google_project_service" "room_vertex" {
  for_each = local.room_model_on_vertex ? toset(concat(
    ["aiplatform.googleapis.com"],
    local.room_vertex_budget ? ["billingbudgets.googleapis.com", "pubsub.googleapis.com"] : [],
  )) : toset([])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_vertex_ai_endpoint" "room_model" {
  count = local.room_model_on_vertex ? 1 : 0

  project                    = var.project_id
  name                       = local.room_vertex_endpoint_id
  display_name               = "room-model"
  description                = "The members' room's self-hosted model (design §5.10), deployed here by the worker."
  location                   = var.region
  region                     = var.region
  dedicated_endpoint_enabled = true
  labels                     = local.labels

  lifecycle {
    # The worker deploys to it and sets its traffic.
    ignore_changes = [traffic_split]

    precondition {
      condition     = var.room_model_image != null
      error_message = "room_model_host = \"vertex\" needs room_model_image: build infra/room-model first (README \"Members' room model\")."
    }
  }

  depends_on = [google_project_service.room_vertex]
}

# What the worker needs to deploy the model and call it: no more than this endpoint and the models uploaded for it.
resource "google_project_iam_custom_role" "room_model_deployer" {
  count = local.room_model_on_vertex ? 1 : 0

  project     = var.project_id
  role_id     = "ustpRoomModelDeployer"
  title       = "USTPVote room model deployer"
  description = "Lets the worker upload the members' room's model to Vertex AI, deploy it, take it away, and call it (design §5.10)."
  permissions = [
    "aiplatform.endpoints.get",
    "aiplatform.endpoints.deploy",
    "aiplatform.endpoints.undeploy",
    "aiplatform.endpoints.predict",
    "aiplatform.models.upload",
    "aiplatform.models.list",
    "aiplatform.models.get",
  ]

  depends_on = [google_project_service.room_vertex]
}

resource "google_project_iam_member" "room_model_deployer_worker" {
  count = local.room_model_on_vertex ? 1 : 0

  project = var.project_id
  role    = google_project_iam_custom_role.room_model_deployer[0].id
  member  = google_service_account.worker.member
}

# The model is deployed to run as its own account, which only reads the models bucket.
resource "google_service_account_iam_member" "room_model_worker_acts_as" {
  count = local.room_model_on_vertex ? 1 : 0

  service_account_id = google_service_account.room_model[0].name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.worker.member
}

# --- Google Cloud's budget for the model: the real bill, a backstop to the worker's estimate -------------------------

resource "google_pubsub_topic" "room_model_budget" {
  count = local.room_vertex_budget ? 1 : 0

  project = var.project_id
  name    = "room-model-budget"
  labels  = local.labels

  depends_on = [google_project_service.room_vertex]
}

resource "google_billing_budget" "room_model" {
  count = local.room_vertex_budget ? 1 : 0

  billing_account = var.billing_account
  display_name    = "${var.project_id} room model"

  # Vertex AI in this project, each calendar month.
  budget_filter {
    projects        = ["projects/${data.google_project.this.number}"]
    services        = ["services/C7E2-9256-1C43"]
    calendar_period = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(floor(var.room_model_monthly_budget_usd))
      nanos         = floor((var.room_model_monthly_budget_usd - floor(var.room_model_monthly_budget_usd)) * 1000000000)
    }
  }

  # Emails to the billing account's admins at half, 90% and all of it.
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  # Every update, a few times a day, to the worker, which stops the model once the cost reaches the budget.
  all_updates_rule {
    pubsub_topic   = google_pubsub_topic.room_model_budget[0].id
    schema_version = "1.0"
  }
}

resource "google_pubsub_subscription" "room_model_budget" {
  count = local.room_vertex_budget ? 1 : 0

  project                    = var.project_id
  name                       = "room-model-budget-worker"
  topic                      = google_pubsub_topic.room_model_budget[0].id
  ack_deadline_seconds       = 60
  message_retention_duration = "86400s"
  labels                     = local.labels

  push_config {
    push_endpoint = "${google_cloud_run_v2_service.worker[0].uri}/tasks/room-model-budget"

    # As the invoker, the one account the worker admits.
    oidc_token {
      service_account_email = google_service_account.invoker.email
      audience              = google_cloud_run_v2_service.worker[0].uri
    }
  }

  expiration_policy {
    ttl = ""
  }
}

# Pub/Sub's service agent signs the invoker's token for each push.
resource "google_service_account_iam_member" "room_model_budget_push" {
  count = local.room_vertex_budget ? 1 : 0

  service_account_id = google_service_account.invoker.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}
