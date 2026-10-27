# Production: ustpvote2-prod. Binary Authorization enforced, no human Firestore data access, and the anchors
# retention lock decided explicitly (README "Bucket Lock").

module "ustpvote" {
  source = "../../modules/ustpvote"

  project_id  = var.project_id
  environment = "prod"
  region      = var.region

  server_image                  = var.server_image
  bootstrap_system_admin_emails = var.bootstrap_system_admin_emails
  image_publishers              = var.image_publishers
  firebase_web_app_id           = var.firebase_web_app_id

  anchors_retention_days   = var.anchors_retention_days
  anchors_retention_locked = var.anchors_retention_locked
  anchors_public_read      = var.anchors_public_read

  binauthz_dry_run    = false
  attestation_signers = var.attestation_signers

  task_enqueuers   = var.task_enqueuers
  operator_members = var.operator_members
  alert_emails     = var.alert_emails

  bylaws_check_enabled = var.bylaws_check_enabled

  # Election notices (design §6.7).
  web_origin    = var.web_origin
  mail_from     = var.mail_from
  mail_reply_to = var.mail_reply_to
}
