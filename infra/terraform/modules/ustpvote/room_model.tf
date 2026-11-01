# The members' room's model (design §5.10): a self-hosted Ollama server with Gemma for the assistant's answers and
# EmbeddingGemma for its search, on one NVIDIA L4 GPU in this project, so nothing said in the room goes to an AI company
# (the room's terms promise it). Only the worker's account may call it. It runs on a Cloud Run service (here) or, where
# the project has no Cloud Run GPU quota, on a Vertex AI endpoint (room_model_host = "vertex", room_model_vertex.tf).
# Either way it scales to zero after it idles, and the first question after a quiet spell waits while it starts and
# loads the models, which live in a bucket of their own (fetched once by the room-model-pull job, README "Members' room
# model").
#
# The api queues each question as a Cloud Task on the worker queue (scheduling.tf), since an answer can take longer than
# a request through Hosting may wait; the worker calls the model and posts the answer in the room.
#
# Off unless room_model_enabled: ROOM_MODEL is then "off", /ask answers 503, and the room's chat and memory still work.

locals {
  room_model_enabled      = local.deploy && var.room_model_enabled
  room_model_on_cloud_run = local.room_model_enabled && var.room_model_host == "cloud-run"
  room_model_on_vertex    = local.room_model_enabled && var.room_model_host == "vertex"

  # Ollama's image through the project's own Docker Hub proxy (below), pinned to a release.
  room_model_image = "${var.region}-docker.pkg.dev/${var.project_id}/dockerhub/ollama/ollama:${var.room_model_ollama_version}"

  room_model_url = local.room_model_on_cloud_run ? google_cloud_run_v2_service.room_model[0].uri : local.room_vertex_url

  # The api builds the model's settings too (it reports which model the room runs, and on Vertex AI what it has cost
  # this month) and queues questions for the worker.
  room_api_env = local.room_model_enabled ? merge({
    ROOM_MODEL     = "ollama"
    ROOM_MODEL_URL = local.room_model_url
    TASKS_QUEUE    = google_cloud_tasks_queue.worker.id
    WORKER_URL     = google_cloud_run_v2_service.worker[0].uri
    TASKS_INVOKER  = google_service_account.invoker.email
  }, local.room_vertex_env) : { ROOM_MODEL = "off" }

  room_worker_env = local.room_model_enabled ? merge({
    ROOM_MODEL       = "ollama"
    ROOM_MODEL_URL   = local.room_model_url
    ROOM_CHAT_MODEL  = var.room_chat_model
    ROOM_EMBED_MODEL = var.room_embed_model
  }, local.room_vertex_env) : { ROOM_MODEL = "off" }

  # What the server and the pull job give Ollama: the models from the bucket, kept loaded while the instance lives, a
  # context that fits the L4's 24 GB beside the 16 GB model, and one request at a time.
  room_ollama_env = {
    OLLAMA_MODELS         = "/models"
    OLLAMA_KEEP_ALIVE     = "-1"
    OLLAMA_CONTEXT_LENGTH = tostring(var.room_model_context)
    OLLAMA_NUM_PARALLEL   = "1"
  }
}

resource "google_service_account" "room_model" {
  count = var.room_model_enabled ? 1 : 0

  project      = var.project_id
  account_id   = "ustp-room-model"
  display_name = "USTPVote members' room model"
  description  = "Runs the room's self-hosted model (design §5.10). Reads and fetches the model files; nothing else."
}

# The model files (about 17 GB): written by the pull job, read by the model (Cloud Run mounts it, writable too, since
# Ollama makes its folders when it starts, before the pull job has filled the bucket; on Vertex AI it is copied in).
resource "google_storage_bucket" "room_models" {
  count = var.room_model_enabled ? 1 : 0

  project                     = var.project_id
  name                        = "${var.project_id}-room-models"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true
  labels                      = local.labels

  depends_on = [google_project_service.this]
}

resource "google_storage_bucket_iam_member" "room_models" {
  count = var.room_model_enabled ? 1 : 0

  bucket = google_storage_bucket.room_models[0].name
  role   = "roles/storage.objectUser"
  member = google_service_account.room_model[0].member
}

# Docker Hub through Artifact Registry, so Cloud Run pulls Ollama's image from the project, cached, rather than from
# Docker Hub on each cold start.
resource "google_artifact_registry_repository" "dockerhub" {
  count = var.room_model_enabled ? 1 : 0

  project       = var.project_id
  location      = var.region
  repository_id = "dockerhub"
  format        = "DOCKER"
  mode          = "REMOTE_REPOSITORY"
  description   = "Docker Hub, for Ollama's image (the members' room's model, design §5.10)."
  labels        = local.labels

  remote_repository_config {
    docker_repository {
      public_repository = "DOCKER_HUB"
    }
  }

  depends_on = [google_project_service.this]
}

resource "google_cloud_run_v2_service" "room_model" {
  count = local.room_model_on_cloud_run ? 1 : 0

  # The worker calls it at its run.app address with an ID token; nobody else holds run.invoker, so its open ingress
  # admits no one else. It runs a third-party image pinned to a release rather than one the release pipeline attests
  # (design §14), so it does not ask Binary Authorization; it holds no secrets and its account can only read its models.
  project             = var.project_id
  name                = "room-model"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.deletion_protection
  labels              = local.labels

  template {
    service_account                  = google_service_account.room_model[0].email
    timeout                          = "300s"
    max_instance_request_concurrency = 4
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    gpu_zonal_redundancy_disabled    = true
    labels                           = local.labels

    # One GPU at most: a new project gets 3 L4s in a region without asking, shared by every service there.
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    node_selector {
      accelerator = "nvidia-l4"
    }

    volumes {
      name = "models"
      gcs {
        bucket    = google_storage_bucket.room_models[0].name
        read_only = false
      }
    }

    containers {
      image = local.room_model_image

      ports {
        container_port = 8080
      }

      dynamic "env" {
        for_each = merge(local.room_ollama_env, { OLLAMA_HOST = "0.0.0.0:8080", OLLAMA_NOPRUNE = "true" })
        content {
          name  = env.key
          value = env.value
        }
      }

      volume_mounts {
        name       = "models"
        mount_path = "/models"
      }

      # A GPU needs CPU always allocated (instance-based billing); the service still scales to zero.
      resources {
        limits = {
          cpu              = "4"
          memory           = var.room_model_memory
          "nvidia.com/gpu" = "1"
        }
        cpu_idle          = false
        startup_cpu_boost = true
      }

      startup_probe {
        tcp_socket {
          port = 8080
        }
        period_seconds    = 5
        timeout_seconds   = 5
        failure_threshold = 48
      }
    }
  }

  depends_on = [google_storage_bucket_iam_member.room_models, google_artifact_registry_repository.dockerhub]
}

resource "google_cloud_run_v2_service_iam_member" "room_model_worker" {
  count = local.room_model_on_cloud_run ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.room_model[0].name
  role     = "roles/run.invoker"
  member   = google_service_account.worker.member
}

# Fetches the models into the bucket: run it once after the first apply and again after changing either model
# (`gcloud run jobs execute room-model-pull --region <region> --wait`; README "Members' room model"). No GPU needed.
# Ollama downloads each file in parallel parts written out of order, which stall on a Cloud Storage mount (tried on dev,
# 2026-10-30), so it pulls into the instance's own memory and the finished files are then copied to the bucket in one
# pass each.
resource "google_cloud_run_v2_job" "room_model_pull" {
  count = local.room_model_enabled ? 1 : 0

  project             = var.project_id
  name                = "room-model-pull"
  location            = var.region
  deletion_protection = var.deletion_protection
  labels              = local.labels

  template {
    task_count = 1

    template {
      service_account       = google_service_account.room_model[0].email
      timeout               = "3600s"
      max_retries           = 1
      execution_environment = "EXECUTION_ENVIRONMENT_GEN2"

      volumes {
        name = "models"
        gcs {
          bucket    = google_storage_bucket.room_models[0].name
          read_only = false
        }
      }

      containers {
        image   = local.room_model_image
        command = ["/bin/sh", "-c"]
        args    = ["OLLAMA_MODELS=/tmp/models ollama serve & sleep 10 && ollama pull ${var.room_chat_model} && ollama pull ${var.room_embed_model} && cp -r /tmp/models/. /models/"]

        dynamic "env" {
          for_each = local.room_ollama_env
          content {
            name  = env.key
            value = env.value
          }
        }

        volume_mounts {
          name       = "models"
          mount_path = "/models"
        }

        # The models (about 16 GB) are held in the instance's in-memory disk until they are copied to the bucket.
        resources {
          limits = {
            cpu    = "8"
            memory = "32Gi"
          }
        }
      }
    }
  }

  depends_on = [google_storage_bucket_iam_member.room_models, google_artifact_registry_repository.dockerhub]
}
