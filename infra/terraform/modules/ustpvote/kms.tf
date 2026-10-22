# Cloud KMS (design §7.3, §8.3). Key rings and keys can never be deleted from a project; `prevent_destroy` stops
# Terraform from destroying their versions, which would make every signature unverifiable against a live key and
# every ballot pool unreadable.

resource "google_kms_key_ring" "this" {
  project    = var.project_id
  name       = var.kms_key_ring
  location   = var.region
  depends_on = [google_project_service.this]

  lifecycle {
    prevent_destroy = true
  }
}

# Ledger blocks and approved rolls (design §8.3). Version 1 is created with the key; AUDIT_SIGNING_KEY_VERSION names it.
resource "google_kms_crypto_key" "audit_signing" {
  name     = "audit-signing"
  key_ring = google_kms_key_ring.this.id
  purpose  = "ASYMMETRIC_SIGN"
  labels   = local.labels

  version_template {
    algorithm        = "EC_SIGN_P256_SHA256"
    protection_level = var.kms_protection_level
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Only the worker signs, and only it reads the public key (it publishes it in signing_keys and the anchors bucket).
resource "google_kms_crypto_key_iam_member" "worker_audit_signing" {
  for_each = toset(["roles/cloudkms.signer", "roles/cloudkms.publicKeyViewer"])

  crypto_key_id = google_kms_crypto_key.audit_signing.id
  role          = each.value
  member        = google_service_account.worker.member
}

# Ballot-pool keys (design §7.3): no version until the worker creates one per secret election.
resource "google_kms_crypto_key" "ballot_pool" {
  name                          = "ballot-pool"
  key_ring                      = google_kms_key_ring.this.id
  purpose                       = "ASYMMETRIC_DECRYPT"
  skip_initial_version_creation = true
  destroy_scheduled_duration    = var.ballot_pool_destroy_scheduled_duration
  labels                        = local.labels

  version_template {
    algorithm        = "RSA_DECRYPT_OAEP_3072_SHA256"
    protection_level = var.kms_protection_level
  }

  lifecycle {
    prevent_destroy = true
  }
}

# The api encrypts ballots locally to an election's public key; it cannot decrypt.
resource "google_kms_crypto_key_iam_member" "api_ballot_pool" {
  crypto_key_id = google_kms_crypto_key.ballot_pool.id
  role          = "roles/cloudkms.publicKeyViewer"
  member        = google_service_account.api.member
}

# The worker creates a version per election, waits for it to be enabled, unwraps data keys when sealing, and destroys
# the version after certification or cancellation (design §7.3, §13 destroy-pool-key). No predefined role is this narrow.
resource "google_project_iam_custom_role" "ballot_pool_worker" {
  project     = var.project_id
  role_id     = "ustpBallotPoolWorker"
  title       = "USTPVote ballot-pool key versions"
  description = "Create, get, decrypt with and destroy versions of the ballot-pool key (design §7.3). Granted on that key only."
  permissions = [
    "cloudkms.cryptoKeyVersions.create",
    "cloudkms.cryptoKeyVersions.destroy",
    "cloudkms.cryptoKeyVersions.get",
    "cloudkms.cryptoKeyVersions.useToDecrypt",
  ]
  depends_on = [google_project_service.this]
}

resource "google_kms_crypto_key_iam_member" "worker_ballot_pool" {
  crypto_key_id = google_kms_crypto_key.ballot_pool.id
  role          = google_project_iam_custom_role.ballot_pool_worker.name
  member        = google_service_account.worker.member
}
