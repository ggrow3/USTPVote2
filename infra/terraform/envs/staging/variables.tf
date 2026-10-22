variable "project_id" {
  description = "The staging project."
  type        = string
  default     = "ustp-voting-staging"
}

variable "region" {
  description = "Design Q16. Must match infra/firebase/firebase.json."
  type        = string
  default     = "us-central1"
}

variable "server_image" {
  description = "Server image by digest; null on the first apply (no Cloud Run services yet)."
  type        = string
  default     = null
}

variable "bootstrap_system_admin_emails" {
  description = "At least two verified emails that become System Admins; [] once real admins exist."
  type        = list(string)
  default     = []
}

variable "image_publishers" {
  description = "IAM members that push images (the build pipeline)."
  type        = list(string)
  default     = []
}

variable "anchors_retention_days" {
  description = "Anchor retention in days (unlocked here, so it can be changed or removed)."
  type        = number
  default     = 3653
}

variable "anchors_public_read" {
  description = "Publicly readable anchor objects (design §8.4 recommendation)."
  type        = bool
  default     = true
}

variable "attestation_signers" {
  description = "IAM members that sign Binary Authorization attestations."
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
