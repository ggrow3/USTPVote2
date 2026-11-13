variable "project_id" {
  description = "The development project."
  type        = string
  default     = "ustpvote2-dev"
}

variable "region" {
  description = "Design Q16. Must match firebase.json."
  type        = string
  default     = "us-central1"
}

variable "server_image" {
  description = "Image by digest that the services are created with; null on the first apply (no Cloud Run services yet). Releases come from the release workflow."
  type        = string
  default     = null
}

variable "bootstrap_system_admin_emails" {
  description = "Verified emails that become System Admins (one is enough); [] once real admins exist."
  type        = list(string)
  default     = []
}

variable "deletable_account_emails" {
  description = "Primary emails of accounts a System Admin may delete, if they are not members; [] for none."
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
  description = "Anchor retention in days (unlocked here, so it can be changed or removed)."
  type        = number
  default     = 3653
}

variable "anchors_public_read" {
  description = "Publicly readable anchor objects (design §8.4)."
  type        = bool
  default     = false
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
  description = "People with read-only operations roles."
  type        = list(string)
  default     = []
}

variable "developer_data_members" {
  description = "People with Firestore data access for debugging (never in prod)."
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

variable "fec_api_key" {
  description = "An api.data.gov key for the Your area page's FEC candidate lists; empty uses the shared DEMO_KEY (design §5.12; README \"Your area records\")."
  type        = string
  default     = ""
}

variable "openstates_api_key" {
  description = "An Open States API key for the Your area page's state legislators; empty leaves them out (design §5.12; README \"Your area records\")."
  type        = string
  default     = ""
}

variable "civic_enabled" {
  description = "List the ballot's contests from Google's Civic Information API on the Candidates and Your area pages, with a server key kept in Secret Manager (design §5.12; README \"Your area records\")."
  type        = bool
  default     = true
}

variable "web_origin" {
  description = "Where the web app is served, which election notices link to; empty for https://<project>.web.app (design §6.8)."
  type        = string
  default     = ""
}

variable "mail_transport" {
  description = "How the worker sends election notices: \"ses\" through Amazon SES, or \"off\" (design §6.8; README \"Email (Amazon SES)\")."
  type        = string
  default     = "off"
}

variable "notice_contact" {
  description = "Where the notices tell members to ask about an election: an email address or an https page; System Admins can set it in the app instead."
  type        = string
  default     = ""
}

variable "ses_region" {
  description = "AWS region of the SES identity and the delivery-report queue."
  type        = string
  default     = "us-east-1"
}

variable "ses_events_queue_url" {
  description = "URL of the SQS queue SES delivery reports arrive on (infra/terraform/aws's queue_urls output); needed with \"ses\"."
  type        = string
  default     = ""
}

variable "ses_configuration_set" {
  description = "This environment's SES configuration set (infra/terraform/aws's configuration_sets output)."
  type        = string
  default     = "ustp-mail-dev"
}

variable "mail_from" {
  description = "From header of the app's email: this environment's address (infra/terraform/aws's mail_from output)."
  type        = string
  default     = "USTP Elections <noreply@dev.transhumanist-party.org>"
}

variable "room_model_enabled" {
  description = "Run the members' room's self-hosted model on one NVIDIA L4 GPU, about $1.05 an hour while warm (design §5.10; README \"Members' room model\"). Off: /ask answers 503; the room's chat and memory work."
  type        = bool
  default     = false
}
