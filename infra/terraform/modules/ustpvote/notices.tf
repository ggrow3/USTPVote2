# The app's email by Amazon SES (design §6.8): the worker emails each roll when voting opens, reminds those who have
# not voted a day before it closes, and reads delivery reports from an SQS queue. The AWS side (sender domain,
# configuration set, SNS topic, SQS queue, IAM users) is the separate Terraform root infra/terraform/aws, applied by hand
# (README "Email (Amazon SES)").
#
# The worker's AWS access key lives in these two secrets. Terraform creates them but never their values: a person adds
# each as a version, so the key stays out of Terraform state. Only the worker reads them (worker_secret_accessor), as
# AWS_SES_ACCESS_KEY_ID and AWS_SES_SECRET_ACCESS_KEY; the api never sends mail and gets neither.

resource "google_secret_manager_secret" "aws_ses_access_key_id" {
  project   = var.project_id
  secret_id = "aws-ses-access-key-id"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.this]
}

resource "google_secret_manager_secret" "aws_ses_secret_access_key" {
  project   = var.project_id
  secret_id = "aws-ses-secret-access-key"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.this]
}

locals {
  ses = var.mail_transport == "ses"

  # Both services: the api shows how notices go out and the contact in the editor's preview; the worker sends.
  notices_env = merge(
    { MAIL_TRANSPORT = var.mail_transport },
    var.notice_contact != "" ? { NOTICE_CONTACT = var.notice_contact } : {},
  )

  # Worker only: the headers, SES and its delivery-report queue. The access key comes from the secrets above (run.tf).
  notices_worker_env = merge(
    { MAIL_FROM = var.mail_from },
    var.mail_reply_to != "" ? { MAIL_REPLY_TO = var.mail_reply_to } : {},
    local.ses ? {
      SES_REGION            = var.ses_region
      SES_CONFIGURATION_SET = var.ses_configuration_set
      SES_EVENTS_QUEUE_URL  = var.ses_events_queue_url
      SES_MAX_SEND_RATE     = tostring(var.ses_max_send_rate)
    } : {},
  )

  # Mounted only when the worker sends through SES: Cloud Run will not start with a secret that has no version.
  notices_worker_secrets = local.ses ? {
    AWS_SES_ACCESS_KEY_ID     = google_secret_manager_secret.aws_ses_access_key_id.secret_id
    AWS_SES_SECRET_ACCESS_KEY = google_secret_manager_secret.aws_ses_secret_access_key.secret_id
  } : {}
}
