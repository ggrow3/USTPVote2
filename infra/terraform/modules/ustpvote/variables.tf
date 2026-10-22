variable "project_id" {
  description = "GCP project of this environment: ustp-voting-dev, -staging or -prod (design §15)."
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
  description = "Region for Cloud Run, KMS, buckets, Scheduler and Tasks (design Q16). Must match the Hosting rewrite in infra/firebase/firebase.json."
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
  description = "The server image, pinned by digest (…/server@sha256:<64 hex>), run by both api and worker. Null skips the Cloud Run services and the Scheduler job, for the first apply before any image exists."
  type        = string
  default     = null

  validation {
    condition     = var.server_image == null || can(regex("@sha256:[0-9a-f]{64}$", var.server_image))
    error_message = "server_image must be pinned by digest (…@sha256:<64 hex digits>), never by tag."
  }
}

variable "bootstrap_system_admin_emails" {
  description = "BOOTSTRAP_SYSTEM_ADMIN_EMAILS (design §4): verified emails that become System Admins when their account is created. List at least two; set to [] once real admins exist."
  type        = list(string)
  default     = []
}

variable "image_publishers" {
  description = "IAM members allowed to push images to the Artifact Registry repository (the build pipeline)."
  type        = list(string)
  default     = []
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
  description = "IAM members (the release pipeline after review) allowed to sign attestations for the ustpvote-reviewed attestor."
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
  description = "Services allowed to enqueue Cloud Tasks for the worker: \"api\" and/or \"worker\". Empty until code enqueues tasks (tally, email, destroy-pool-key)."
  type        = set(string)
  default     = []

  validation {
    condition     = alltrue([for s in var.task_enqueuers : contains(["api", "worker"], s)])
    error_message = "task_enqueuers may only contain \"api\" and \"worker\"."
  }
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

variable "worker_max_instances" {
  description = "Upper bound on worker instances. Overlapping ticks are safe (design §13), so this only caps cost."
  type        = number
  default     = 2
}

variable "deletion_protection" {
  description = "Refuse to delete the Cloud Run services and the Firestore database."
  type        = bool
  default     = true
}
