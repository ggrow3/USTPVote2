# Binary Authorization (design §14, §17): Cloud Run runs only images attested by the ustpvote-reviewed attestor. The
# release pipeline signs an attestation for an image digest after review, with the attestor-signing KMS key.

resource "google_kms_crypto_key" "attestor" {
  name     = "attestor-signing"
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

data "google_kms_crypto_key_version" "attestor" {
  crypto_key = google_kms_crypto_key.attestor.id
}

resource "google_container_analysis_note" "reviewed" {
  project = var.project_id
  name    = "ustpvote-reviewed"

  attestation_authority {
    hint {
      human_readable_name = "USTPVote reviewed release"
    }
  }

  depends_on = [google_project_service.this]
}

resource "google_binary_authorization_attestor" "reviewed" {
  project     = var.project_id
  name        = "ustpvote-reviewed"
  description = "Signed by the release pipeline for a reviewed server image digest."

  attestation_authority_note {
    note_reference = google_container_analysis_note.reviewed.name

    public_keys {
      id = data.google_kms_crypto_key_version.attestor.id

      pkix_public_key {
        public_key_pem      = data.google_kms_crypto_key_version.attestor.public_key[0].pem
        signature_algorithm = data.google_kms_crypto_key_version.attestor.public_key[0].algorithm
      }
    }
  }
}

# The Binary Authorization service agent reads the attestations attached to the note when Cloud Run deploys.
resource "google_container_analysis_note_iam_member" "binauthz_agent" {
  project = var.project_id
  note    = google_container_analysis_note.reviewed.name
  role    = "roles/containeranalysis.notes.occurrences.viewer"
  member  = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-binaryauthorization.iam.gserviceaccount.com"
}

resource "google_binary_authorization_policy" "this" {
  project                       = var.project_id
  global_policy_evaluation_mode = "ENABLE"

  default_admission_rule {
    evaluation_mode         = "REQUIRE_ATTESTATION"
    enforcement_mode        = var.binauthz_dry_run ? "DRYRUN_AUDIT_LOG_ONLY" : "ENFORCED_BLOCK_AND_AUDIT_LOG"
    require_attestations_by = concat([google_binary_authorization_attestor.reviewed.name], var.binauthz_extra_attestors)
  }
}

# --- Who may attest (gcloud container binauthz attestations sign-and-create) -----------------------------------------
# ustp-release (release.tf) and any further attestation_signers.

resource "google_kms_crypto_key_iam_member" "attestation_signers" {
  for_each = local.attestation_signers

  crypto_key_id = google_kms_crypto_key.attestor.id
  role          = "roles/cloudkms.signerVerifier"
  member        = each.value
}

resource "google_container_analysis_note_iam_member" "attestation_signers" {
  for_each = local.attestation_signers

  project = var.project_id
  note    = google_container_analysis_note.reviewed.name
  role    = "roles/containeranalysis.notes.attacher"
  member  = each.value
}

resource "google_project_iam_member" "attestation_signers" {
  for_each = local.attestation_signers

  project = var.project_id
  role    = "roles/containeranalysis.occurrences.editor"
  member  = each.value
}

resource "google_binary_authorization_attestor_iam_member" "attestation_signers" {
  for_each = local.attestation_signers

  project  = var.project_id
  attestor = google_binary_authorization_attestor.reviewed.name
  role     = "roles/binaryauthorization.attestorsViewer"
  member   = each.value
}
