# Buckets (design §5.3, §8.4, §10.10) and the image repository. Bucket names follow the emulator defaults in config.ts.

# --- Ledger anchors (design §8.4) ------------------------------------------------------------------------------------

resource "google_storage_bucket" "anchors" {
  project                     = var.project_id
  name                        = "${var.project_id}-anchors"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = var.anchors_public_read ? "inherited" : "enforced"
  force_destroy               = false
  labels                      = local.labels

  # Locking is irreversible (see anchors_retention_locked); unlocked, a project owner can still remove the policy.
  retention_policy {
    retention_period = var.anchors_retention_days * 86400
    is_locked        = var.anchors_retention_locked
  }

  # Public anchors are fetched by other sites' browsers, such as a verifier or a mirror.
  dynamic "cors" {
    for_each = var.anchors_public_read ? [1] : []
    content {
      origin          = ["*"]
      method          = ["GET", "HEAD"]
      response_header = ["Content-Type"]
      max_age_seconds = 3600
    }
  }

  depends_on = [google_project_service.this]

  lifecycle {
    prevent_destroy = true
  }
}

# The worker creates anchors with ifGenerationMatch: 0 and reads an existing one back to compare a retried write and
# record its generation. Neither role can delete, and overwriting an object needs storage.objects.delete, so the worker
# can only add (and the retention policy stops everyone else from removing).
resource "google_storage_bucket_iam_member" "anchors_worker" {
  for_each = toset(["roles/storage.objectCreator", "roles/storage.objectViewer"])

  bucket = google_storage_bucket.anchors.name
  role   = each.value
  member = google_service_account.worker.member
}

# The Auditor verification (GET /v1/admin/audit/verify, in the api) downloads every anchor and checks its generation.
resource "google_storage_bucket_iam_member" "anchors_api" {
  bucket = google_storage_bucket.anchors.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.api.member
}

resource "google_storage_bucket_iam_member" "anchors_public" {
  count = var.anchors_public_read ? 1 : 0

  bucket = google_storage_bucket.anchors.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# --- Profile photos (design §5.3) ------------------------------------------------------------------------------------

resource "google_storage_bucket" "photos" {
  project                     = var.project_id
  name                        = "${var.project_id}-profile-photos"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  # A replaced, rejected or removed photo is gone at once, not kept restorable for the default 7 days.
  soft_delete_policy {
    retention_duration_seconds = 0
  }

  depends_on = [google_project_service.this]
}

# The api stores normalized photos, serves them through authenticated routes and deletes replaced or rejected ones.
resource "google_storage_bucket_iam_member" "photos_api" {
  bucket = google_storage_bucket.photos.name
  role   = "roles/storage.objectUser"
  member = google_service_account.api.member
}

# --- Uploaded videos (design §10.10) ----------------------------------------------------------------------------------

# The videos admins upload for lessons, news posts, the press kit and the hub, kept a part at a time as sent and played
# back through the api, never read from the bucket by a browser.
resource "google_storage_bucket" "videos" {
  project                     = var.project_id
  name                        = "${var.project_id}-videos"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  depends_on = [google_project_service.this]
}

# The api stores each part once and reads parts back to play them; it neither overwrites nor deletes them.
resource "google_storage_bucket_iam_member" "videos_api" {
  for_each = toset(["roles/storage.objectCreator", "roles/storage.objectViewer"])

  bucket = google_storage_bucket.videos.name
  role   = each.value
  member = google_service_account.api.member
}

# --- Server image ------------------------------------------------------------------------------------------------------

resource "google_artifact_registry_repository" "server" {
  project       = var.project_id
  location      = var.region
  repository_id = "ustpvote"
  format        = "DOCKER"
  description   = "The server image run by the api and worker services."
  labels        = local.labels

  docker_config {
    immutable_tags = true
  }

  depends_on = [google_project_service.this]
}

# ustp-release (release.tf) and any further image_publishers.
resource "google_artifact_registry_repository_iam_member" "publishers" {
  for_each = local.image_publishers

  project    = var.project_id
  location   = google_artifact_registry_repository.server.location
  repository = google_artifact_registry_repository.server.name
  role       = "roles/artifactregistry.writer"
  member     = each.value
}
