# Development: ustpvote2-dev. Unlocked anchors retention, Binary Authorization in dry run, testing mode on, developers
# may be given Firestore data access.

module "ustpvote" {
  source = "../../modules/ustpvote"

  project_id  = var.project_id
  environment = "dev"
  region      = var.region

  server_image                  = var.server_image
  bootstrap_system_admin_emails = var.bootstrap_system_admin_emails
  image_publishers              = var.image_publishers
  firebase_web_app_id           = var.firebase_web_app_id

  anchors_retention_days   = var.anchors_retention_days
  anchors_retention_locked = false
  anchors_public_read      = var.anchors_public_read

  binauthz_dry_run    = true
  attestation_signers = var.attestation_signers

  # System Admins can rehearse elections with test personas (design §10.4).
  testing_mode = true

  task_enqueuers         = var.task_enqueuers
  operator_members       = var.operator_members
  developer_data_members = var.developer_data_members
  alert_emails           = var.alert_emails

  bylaws_check_enabled      = var.bylaws_check_enabled
  consistency_check_enabled = var.consistency_check_enabled
  election_check_enabled    = var.election_check_enabled

  # The Candidates page's Google map (design §5.8; README "Candidates map").
  maps_enabled = var.maps_enabled

  # The Your area page's public records (design §5.12; README "Your area records").
  fec_api_key        = var.fec_api_key
  openstates_api_key = var.openstates_api_key
  civic_enabled      = var.civic_enabled

  # The members' room's self-hosted model, one L4 GPU (design §5.10; README "Members' room model"): on Vertex AI on dev,
  # which has no Cloud Run GPU quota, within a monthly budget.
  room_model_enabled            = var.room_model_enabled
  room_model_host               = var.room_model_host
  room_model_image              = var.room_model_image
  room_model_idle_minutes       = var.room_model_idle_minutes
  room_model_monthly_budget_usd = var.room_model_monthly_budget_usd
  room_model_spot               = var.room_model_spot
  billing_account               = var.billing_account

  # Election notices (design §6.8; README "Election notices").
  web_origin           = var.web_origin
  mail_transport       = var.mail_transport
  notice_contact       = var.notice_contact
  ses_region           = var.ses_region
  ses_events_queue_url = var.ses_events_queue_url
}
