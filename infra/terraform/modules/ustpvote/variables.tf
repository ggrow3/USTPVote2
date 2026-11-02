variable "project_id" {
  description = "GCP project of this environment: ustpvote2-dev, -staging or -prod (design §15)."
  type        = string
}

variable "environment" {
  description = "dev, staging or prod. Only used by validations and labels; each root sets its switches explicitly."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}

variable "region" {
  description = "Region for Cloud Run, KMS, buckets, Scheduler and Tasks (design Q16). Must match the Hosting rewrite in firebase.json."
  type        = string
  default     = "us-central1"
}

variable "firestore_location" {
  description = "Location of the (default) Firestore database; null means the region. nam5 is the multi-region alternative. Fixed once created."
  type        = string
  default     = null
}

# --- Release ---------------------------------------------------------------------------------------------------------

variable "server_image" {
  description = "The server image, pinned by digest (…/server@sha256:<64 hex>), that the api and worker are created with; later releases come from the release workflow and Terraform ignores the image. Null skips the Cloud Run services and the Scheduler job, for the first apply before any image exists."
  type        = string
  default     = null

  validation {
    condition     = var.server_image == null || can(regex("@sha256:[0-9a-f]{64}$", var.server_image))
    error_message = "server_image must be pinned by digest (…@sha256:<64 hex digits>), never by tag."
  }
}

variable "bootstrap_system_admin_emails" {
  description = "BOOTSTRAP_SYSTEM_ADMIN_EMAILS (design §4): verified emails that become System Admins when their account is created. One is enough (a System Admin grants roles alone); set to [] once real admins exist."
  type        = list(string)
  default     = []
}

variable "deletable_account_emails" {
  description = "DELETABLE_ACCOUNT_EMAILS (design §4): primary emails of accounts a System Admin may delete from the People tab, if they are not members. Empty means none can be."
  type        = list(string)
  default     = []
}

variable "image_publishers" {
  description = "IAM members allowed to push images to the Artifact Registry repository, besides the release workflow's ustp-release."
  type        = list(string)
  default     = []
}

variable "github_repository" {
  description = "owner/name of the GitHub repository whose release workflow may act as ustp-release (release.tf)."
  type        = string
  default     = "ggrow3/USTPVote2"
}

variable "github_repository_id" {
  description = "Numeric ID of that repository (gh api repos/<owner>/<name> --jq .id). Matched instead of the name alone, since a name can be taken over after a rename or deletion."
  type        = string
  default     = "1427761058"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "github_repository_id is the repository's numeric ID."
  }
}

# --- Sign-in (design §4) ---------------------------------------------------------------------------------------------

variable "firebase_web_app_id" {
  description = "App ID of the project's Firebase web app (1:<number>:web:<hex>), registered once outside Terraform. Null until then; it registers the reCAPTCHA Enterprise key with App Check."
  type        = string
  default     = null
}

# --- Ledger anchors (design §8.4) ------------------------------------------------------------------------------------

variable "anchors_retention_days" {
  description = "How long anchor objects are retained, in days (design Q11; default 10 years). Once the policy is locked it can only be increased."
  type        = number
  default     = 3653

  validation {
    condition     = var.anchors_retention_days >= 1 && var.anchors_retention_days * 86400 < 3155760000
    error_message = "anchors_retention_days must be at least 1 and under 100 years."
  }
}

variable "anchors_retention_locked" {
  description = "Lock the anchors bucket's retention policy (Bucket Lock). IRREVERSIBLE: no anchor object, nor the bucket, can be deleted before retention expires, and the period can never be shortened. Production only."
  type        = bool
  default     = false

  validation {
    condition     = !var.anchors_retention_locked || var.environment == "prod"
    error_message = "The anchors retention policy is locked in production only (design §8.4, §15)."
  }
}

variable "testing_mode" {
  description = "Let System Admins create test personas and act as them to rehearse elections (design §10.4). Never in production."
  type        = bool
  default     = false

  validation {
    condition     = !var.testing_mode || var.environment != "prod"
    error_message = "Testing mode is never on in production (design §10.4)."
  }
}

variable "anchors_public_read" {
  description = "Make anchor objects publicly readable (design §8.4 recommendation), so outsiders can keep copies and browsers can fetch them."
  type        = bool
  default     = false
}

# --- KMS (design §7.3, §8.3) -----------------------------------------------------------------------------------------

variable "kms_key_ring" {
  description = "Name of the key ring holding audit-signing, ballot-pool and attestor-signing. Key rings can never be deleted, so a name is used once per project and region."
  type        = string
  default     = "ustpvote"
}

variable "kms_protection_level" {
  description = "SOFTWARE or HSM, for every key. Fixed when a key is created."
  type        = string
  default     = "SOFTWARE"

  validation {
    condition     = contains(["SOFTWARE", "HSM"], var.kms_protection_level)
    error_message = "kms_protection_level must be SOFTWARE or HSM."
  }
}

variable "audit_signing_key_version" {
  description = "The audit-signing key version the worker signs with (AUDIT_SIGNING_KEY_VERSION). To rotate, create a version and raise this; old versions stay for verification."
  type        = number
  default     = 1
}

variable "ballot_pool_destroy_scheduled_duration" {
  description = "How long a destroyed ballot-pool key version stays restorable before it is gone for good (minimum 24 h). Short, so a certified election's pool and its backups become unreadable soon after (design §7.3). Only takes effect when the key is created."
  type        = string
  default     = "86400s"
}

# --- Binary Authorization (design §14) -------------------------------------------------------------------------------

variable "binauthz_dry_run" {
  description = "Binary Authorization only logs unattested images instead of blocking them. For dev."
  type        = bool
  default     = false

  validation {
    condition     = !var.binauthz_dry_run || var.environment != "prod"
    error_message = "Binary Authorization is enforced in production."
  }
}

variable "attestation_signers" {
  description = "IAM members allowed to sign attestations for the ustpvote-reviewed attestor, besides the release workflow's ustp-release."
  type        = list(string)
  default     = []
}

variable "binauthz_extra_attestors" {
  description = "Further attestors every image must also be attested by, as projects/<project>/attestors/<name> (for example Cloud Build's built-by-cloud-build)."
  type        = list(string)
  default     = []
}

# --- Worker tasks (design §13) ---------------------------------------------------------------------------------------

variable "task_enqueuers" {
  description = "Services allowed to enqueue Cloud Tasks for the worker: \"api\" and/or \"worker\". The api is added while room_model_enabled, whose questions it queues (room_model.tf)."
  type        = set(string)
  default     = []

  validation {
    condition     = alltrue([for s in var.task_enqueuers : contains(["api", "worker"], s)])
    error_message = "task_enqueuers may only contain \"api\" and \"worker\"."
  }
}

# --- The members' room (design §5.10) --------------------------------------------------------------------------------

variable "room_model_enabled" {
  description = "Run the members' room's self-hosted model (room_model.tf): a Cloud Run service with one NVIDIA L4 GPU (about $1.05 an hour while warm, scaling to zero), its models bucket and pull job, and the api queueing questions for the worker. Off: the room's chat and memory work, and /ask answers 503."
  type        = bool
  default     = false
}

variable "room_chat_model" {
  description = "The Ollama tag the room's assistant answers with. Gemma 4 26B A4B, quantization-aware 4-bit (16 GB), fits one L4 with room_model_context; gemma4:e4b is the smaller fallback."
  type        = string
  default     = "gemma4:26b-a4b-it-qat"
}

variable "room_embed_model" {
  description = "The Ollama tag the room's search embeds with: EmbeddingGemma, 768 dimensions, as the vector indexes in firestore.indexes.json expect."
  type        = string
  default     = "embeddinggemma"
}

variable "room_model_context" {
  description = "Ollama's context length in tokens for the room's model: the prompt (up to 40 sources, a few thousand tokens) and the answer, within the L4's memory beside the model."
  type        = number
  default     = 16384
}

variable "room_model_ollama_version" {
  description = "The ollama/ollama image tag the room's model runs (from Docker Hub, through the project's dockerhub repository)."
  type        = string
  default     = "0.40.5"
}

variable "room_model_memory" {
  description = "Memory of the room's model instance (at least 16Gi with a GPU)."
  type        = string
  default     = "16Gi"
}

# --- People (design §14) ---------------------------------------------------------------------------------------------

variable "operator_members" {
  description = "People who operate the environment (user:… or group:…). They get read-only roles with no Firestore data access and no use of KMS keys."
  type        = list(string)
  default     = []
}

variable "developer_data_members" {
  description = "People given Firestore data access (roles/datastore.user) for debugging. Refused in production, where no human has data access (design §14)."
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.developer_data_members) == 0 || var.environment != "prod"
    error_message = "No human gets Firestore data access in production (design §14)."
  }
}

variable "alert_emails" {
  description = "Addresses alerted when audit-signing or ballot-pool is used by anyone but the worker, a key version is destroyed or restored, or KMS IAM changes (design §14). Empty: no alert policy."
  type        = list(string)
  default     = []
}

variable "bylaws_check_enabled" {
  description = "Run the advisory bylaws check, which sends bylaws drafts to Anthropic's API (design §5.2). It waits for a System Admin to add the API key in the app (Admin › API keys, design §5.6)."
  type        = bool
  default     = false
}

variable "consistency_check_enabled" {
  description = "Run the platform consistency check, which voters on a roll and Election Admins and Auditors may each ask for once per election, and which sends the election's proposals to Anthropic's API (design §5.5). Uses the same Anthropic API key as the bylaws check, which a System Admin adds in the app."
  type        = bool
  default     = false
}

variable "election_check_enabled" {
  description = "Run the election setup check, which Election Admins and Auditors ask for once per version of an election, which sends its rules, offices and proposal texts with the current bylaws to Anthropic's API, and whose notes every user sees beside the contests once it is scheduled (design §6.9). Uses the same Anthropic API key as the bylaws check, which a System Admin adds in the app."
  type        = bool
  default     = false
}

variable "maps_enabled" {
  description = "Show a Google map on the Candidates page (design §5.8): enables the Maps JavaScript API and creates a browser key restricted to it and to the web app's origins (maps.tf). Google bills map loads beyond its monthly free usage."
  type        = bool
  default     = true
}

variable "fec_api_key" {
  description = "An api.data.gov key for the FEC's candidate lists on the Your area page (design §5.12). Free from api.data.gov; empty uses the FEC's shared DEMO_KEY, which allows only a few requests an hour. Not secret, but kept out of the api_env output."
  type        = string
  default     = ""
}

variable "openstates_api_key" {
  description = "An Open States API key, which lists state legislators on the Your area page (design §5.12). Free from open.pluralpolicy.com; empty leaves state legislators out. Not secret, but kept out of the api_env output."
  type        = string
  default     = ""
}

variable "civic_enabled" {
  description = "List the contests on the ballot from Google's Civic Information API on the Candidates and Your area pages (design §5.12): enables the API and creates a server key restricted to it, kept in Secret Manager for the api only (civic.tf). Free; Google has data only while an election is loaded."
  type        = bool
  default     = true
}

# --- Election notices (design §6.8) -----------------------------------------------------------------------------------

variable "web_origin" {
  description = "Where the web app is served (WEB_ORIGIN): election notices link to it, and in prod it is the one address search engines may crawl. Empty: the Firebase Hosting default, https://<project_id>.web.app."
  type        = string
  default     = ""

  validation {
    condition     = var.web_origin == "" || can(regex("^https://[^/?#]+$", var.web_origin))
    error_message = "web_origin is an https origin with nothing after the host, such as https://vote.example.org."
  }
}

variable "mail_transport" {
  description = "How the worker sends election notices (MAIL_TRANSPORT): \"ses\" through Amazon SES, or \"off\". Before \"ses\": set up SES and add the two aws-ses-* secret versions (README \"Election notices\")."
  type        = string
  default     = "off"

  validation {
    condition     = contains(["off", "ses"], var.mail_transport)
    error_message = "mail_transport is \"off\" or \"ses\"."
  }
}

variable "mail_from" {
  description = "From header of election notices (MAIL_FROM). Its domain must be verified in SES. It takes no replies."
  type        = string
  default     = "USTP Elections <noreply@transhumanist-party.org>"
}

variable "mail_reply_to" {
  description = "Reply-To header of election notices (MAIL_REPLY_TO); empty for none, as agreed."
  type        = string
  default     = ""
}

variable "notice_contact" {
  description = "Where the notices tell members to ask about an election (NOTICE_CONTACT): an email address or an https page. The default for System Admins' setting in the app (Admin, Election emails); with neither, the worker mails nothing."
  type        = string
  default     = ""
}

variable "ses_region" {
  description = "AWS region of the SES identity, configuration set and bounce queue (SES_REGION)."
  type        = string
  default     = "us-east-1"
}

variable "ses_configuration_set" {
  description = "SES configuration set that publishes bounces to the SNS topic feeding the bounce queue (SES_CONFIGURATION_SET)."
  type        = string
  default     = "ustp-notices"
}

variable "ses_events_queue_url" {
  description = "URL of the SQS queue SES bounce reports arrive on (SES_EVENTS_QUEUE_URL); empty: bounces are not counted."
  type        = string
  default     = ""

  validation {
    condition     = var.ses_events_queue_url == "" || can(regex("^https://sqs\\.[a-z0-9-]+\\.amazonaws\\.com/[0-9]{12}/[A-Za-z0-9_-]+$", var.ses_events_queue_url))
    error_message = "ses_events_queue_url is an SQS queue URL, such as https://sqs.us-east-1.amazonaws.com/123456789012/ustp-notice-events."
  }
}

variable "ses_max_send_rate" {
  description = "Messages a second the worker sends through SES at most (SES_MAX_SEND_RATE), under the account's sending quota."
  type        = number
  default     = 10

  validation {
    condition     = var.ses_max_send_rate > 0
    error_message = "ses_max_send_rate must be positive."
  }
}

# --- Sizing ----------------------------------------------------------------------------------------------------------

variable "api_max_instances" {
  description = "Upper bound on api instances."
  type        = number
  default     = 10
}

variable "api_memory" {
  description = "Memory per api instance; photo normalization with sharp decodes images up to 5 MB."
  type        = string
  default     = "1Gi"
}

variable "worker_memory" {
  description = "Memory per worker instance. At 512Mi the first worker never finished loading its modules within the 60 s startup probe (the api took 11.5 s with 1Gi)."
  type        = string
  default     = "1Gi"
}

variable "worker_max_instances" {
  description = "Upper bound on worker instances. Overlapping ticks are safe (design §13), so this only caps cost."
  type        = number
  default     = 2
}

variable "mcp_max_instances" {
  description = "Upper bound on instances of the public reporting MCP server (design §3.4); caps what a flood of calls can cost."
  type        = number
  default     = 2
}

variable "sign_in_log_retention_days" {
  description = "Days the sign-in-traffic log bucket keeps Identity Platform's request logs; the app's own sign-in log keeps 180 (design §10.7)."
  type        = number
  default     = 180
}

variable "deletion_protection" {
  description = "Refuse to delete the Cloud Run services and the Firestore database."
  type        = bool
  default     = true
}
