# Staging: ustpvote2-staging. Production settings except the anchors retention lock, so the bucket can still be
# emptied; developers may be given Firestore data access.

module "ustpvote" {
  source = "../../modules/ustpvote"

  project_id  = var.project_id
  environment = "staging"
  region      = var.region

  server_image                  = var.server_image
  bootstrap_system_admin_emails = var.bootstrap_system_admin_emails
  image_publishers              = var.image_publishers
  firebase_web_app_id           = var.firebase_web_app_id

  anchors_retention_days   = var.anchors_retention_days
  anchors_retention_locked = false
  anchors_public_read      = var.anchors_public_read

  binauthz_dry_run    = false
  attestation_signers = var.attestation_signers

  task_enqueuers         = var.task_enqueuers
  operator_members       = var.operator_members
  developer_data_members = var.developer_data_members
  alert_emails           = var.alert_emails

  bylaws_check_enabled = var.bylaws_check_enabled
}
