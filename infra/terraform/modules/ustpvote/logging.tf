# Audit logs and break-glass alerting (design §7.3, §14).

# KMS Data Access logs on: every signature, decryption and public-key read is recorded, so any decrypt is visible.
resource "google_project_iam_audit_config" "kms" {
  project = var.project_id
  service = "cloudkms.googleapis.com"

  audit_log_config {
    log_type = "ADMIN_READ"
  }
  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
}

# Firestore (datastore.googleapis.com) Data Access logs stay off: they would record document paths and write times,
# which pool encryption makes harmless but nobody needs (design §14). No audit config is declared for it on purpose; an
# allServices config set on a parent folder or organization would still turn them on.

# --- Sign-in traffic (design §10.7) --------------------------------------------------------------------------------

# Identity Platform's request logs (identity.tf) hold every sign-in attempt with its address, failed ones included,
# which the api never sees. The _Default bucket keeps them 30 days; this bucket keeps a copy as long as the app's own
# sign-in log keeps its records.
resource "google_logging_project_bucket_config" "sign_in_traffic" {
  project        = var.project_id
  location       = "global"
  bucket_id      = "sign-in-traffic"
  retention_days = var.sign_in_log_retention_days
  description    = "Identity Platform request logs: sign-ups, sign-ins and failed attempts with the caller's address (design §10.7)."

  depends_on = [google_project_service.this]
}

resource "google_logging_project_sink" "sign_in_traffic" {
  project                = var.project_id
  name                   = "sign-in-traffic"
  destination            = "logging.googleapis.com/${google_logging_project_bucket_config.sign_in_traffic.id}"
  filter                 = "resource.type=\"identitytoolkit_project\""
  unique_writer_identity = true
}

# --- Alert: a key used by someone other than the worker -------------------------------------------------------------

locals {
  kms_alert_filter = <<-EOT
    resource.type=("cloudkms_cryptokey" OR "cloudkms_keyring")
    resource.labels.key_ring_id="${google_kms_key_ring.this.name}"
    (
      (
        resource.labels.crypto_key_id=("${google_kms_crypto_key.audit_signing.name}" OR "${google_kms_crypto_key.ballot_pool.name}")
        protoPayload.methodName:("Decrypt" OR "Sign")
        protoPayload.authenticationInfo.principalEmail!="${google_service_account.worker.email}"
      )
      OR protoPayload.methodName:("SetIamPolicy" OR "DestroyCryptoKeyVersion" OR "RestoreCryptoKeyVersion")
    )
  EOT
}

resource "google_monitoring_notification_channel" "email" {
  for_each = toset(var.alert_emails)

  project      = var.project_id
  display_name = "USTPVote ${var.environment}: ${each.value}"
  type         = "email"

  labels = {
    email_address = each.value
  }

  depends_on = [google_project_service.this]
}

resource "google_monitoring_alert_policy" "kms_break_glass" {
  count = length(var.alert_emails) > 0 ? 1 : 0

  project      = var.project_id
  display_name = "USTPVote ${var.environment}: KMS key used outside the worker, version destroyed, or KMS IAM changed"
  combiner     = "OR"
  severity     = "CRITICAL"

  conditions {
    display_name = "Cloud KMS audit log entry"

    condition_matched_log {
      filter = local.kms_alert_filter
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
    auto_close = "604800s"
  }

  documentation {
    mime_type = "text/markdown"
    subject   = "USTPVote ${var.environment}: Cloud KMS activity to review"
    content   = <<-EOT
      Only the worker service account (`${google_service_account.worker.email}`) may sign with `audit-signing` or
      decrypt with `ballot-pool` (design §7.3, §14). This alert also fires when a ballot-pool key version is destroyed
      (expected after certification or cancellation; a destroyed version can be restored within
      ${var.ballot_pool_destroy_scheduled_duration}) and whenever IAM on the key ring or a key changes (expected after a
      Terraform apply that changes key IAM). Check the matching entry in Logs Explorer.
    EOT
  }

  notification_channels = [for channel in google_monitoring_notification_channel.email : channel.name]

  depends_on = [google_project_iam_audit_config.kms]
}
