variable "project_id" {
  description = "The production project."
  type        = string
  default     = "ustpvote2-prod"
}

variable "region" {
  description = "Design Q16. Must match firebase.json."
  type        = string
  default     = "us-central1"
}

variable "server_image" {
  description = "Image by digest that the services are created with, attested by ustpvote-reviewed; null on the first apply (no Cloud Run services yet). Releases come from the release workflow."
  type        = string
  default     = null
}

variable "bootstrap_system_admin_emails" {
  description = "Verified emails that become System Admins (one is enough); [] once real admins exist."
  type        = list(string)
  default     = []
}

variable "image_publishers" {
  description = "IAM members that push images, besides the release workflow's ustp-release."
  type        = list(string)
  default     = []
}

variable "firebase_web_app_id" {
  description = "App ID of the Firebase web app (README \"App Check and the web build\"); null until it exists."
  type        = string
  default     = null
}

variable "anchors_retention_days" {
  description = "Anchor retention in days (design Q11). Once locked it can only be increased."
  type        = number
  default     = 3653
}

# No default: production has to state the decision. true locks the policy IRREVERSIBLY on the next apply.
variable "anchors_retention_locked" {
  description = "Lock the anchors retention policy (Bucket Lock, design §8.4). Irreversible; see README \"Bucket Lock\"."
  type        = bool
}

variable "anchors_public_read" {
  description = "Publicly readable anchor objects (design §8.4 recommendation)."
  type        = bool
  default     = true
}

variable "attestation_signers" {
  description = "IAM members that sign Binary Authorization attestations, besides ustp-release."
  type        = list(string)
  default     = []
}

variable "task_enqueuers" {
  description = "Services that enqueue worker tasks: \"api\", \"worker\"."
  type        = set(string)
  default     = []
}

variable "operator_members" {
  description = "People with read-only operations roles (no Firestore data, no key use)."
  type        = list(string)
  default     = []
}

variable "alert_emails" {
  description = "Addresses for the KMS break-glass alert."
  type        = list(string)
  default     = []
}

variable "bylaws_check_enabled" {
  description = "Run the advisory bylaws check with Claude (design §5.2; README \"Bylaws check\")."
  type        = bool
  default     = false
}

variable "consistency_check_enabled" {
  description = "Run the platform consistency check with Claude, once per person per election (design §5.5; README \"Consistency check\")."
  type        = bool
  default     = false
}

variable "election_check_enabled" {
  description = "Run the election setup check with Claude, once per version of an election, whose notes every user sees (design §6.9; README \"Election setup check\")."
  type        = bool
  default     = false
}

variable "maps_enabled" {
  description = "Show a Google map on the Candidates page, with a browser key restricted to the web app's origins (design §5.8; README \"Candidates map\")."
  type        = bool
  default     = true
}

variable "web_origin" {
  description = "Where the web app is served, which election notices link to; empty for https://<project>.web.app (design §6.8)."
  type        = string
  default     = ""
}

variable "mail_transport" {
  description = "How the worker sends election notices: \"ses\" through Amazon SES, or \"off\" (design §6.8; README \"Election notices\")."
  type        = string
  default     = "off"
}

variable "notice_contact" {
  description = "Where the notices tell members to ask about an election: an email address or an https page; System Admins can set it in the app instead."
  type        = string
  default     = ""
}

variable "ses_region" {
  description = "AWS region of the SES identity and the bounce queue."
  type        = string
  default     = "us-east-1"
}

variable "ses_events_queue_url" {
  description = "URL of the SQS queue SES bounce reports arrive on; empty: bounces are not counted."
  type        = string
  default     = ""
}

variable "room_model_enabled" {
  description = "Run the members' room's self-hosted model on one NVIDIA L4 GPU, about $1.05 an hour while warm (design §5.10; README \"Members' room model\"). Off: /ask answers 503; the room's chat and memory work."
  type        = bool
  default     = false
}
