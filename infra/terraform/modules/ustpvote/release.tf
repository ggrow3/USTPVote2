# The release workflow (.github/workflows/release.yml; design §14, §15). GitHub Actions jobs running in this
# environment's GitHub environment exchange their OIDC token for the ustp-release service account through Workload
# Identity Federation; there is no service account key. ustp-release may push the server image, attest it for Binary
# Authorization and roll the api and worker onto it. It cannot change IAM, read Firestore or use any other key:
# infrastructure changes stay with whoever runs Terraform.

locals {
  # Static keys, so for_each is known on the first plan; the value refers to the account, so its grants wait for it.
  image_publishers    = merge({ for m in var.image_publishers : m => m }, { release = google_service_account.release.member })
  attestation_signers = merge({ for m in var.attestation_signers : m => m }, { release = google_service_account.release.member })
}

resource "google_service_account" "release" {
  project      = var.project_id
  account_id   = "ustp-release"
  display_name = "USTPVote release"
  description  = "GitHub Actions release workflow: pushes, attests and deploys the server image (design §15)."
  depends_on   = [google_project_service.this]
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "OIDC tokens from GitHub Actions in ${var.github_repository}."
  depends_on                = [google_project_service.this]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "ustpvote2-release"
  display_name                       = "USTPVote2 release workflow"
  description                        = "release.yml on main, GitHub environment ${var.environment}."

  # Only the release workflow as it is on main, running in the GitHub environment named after this environment, in this
  # repository. The repository is matched by its numeric ID, which survives renames and is never reused.
  attribute_condition = join(" && ", [
    "assertion.repository_id == '${var.github_repository_id}'",
    "assertion.workflow_ref == '${var.github_repository}/.github/workflows/release.yml@refs/heads/main'",
    "assertion.environment == '${var.environment}'",
  ])

  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.environment" = "assertion.environment"
  }

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "release_github" {
  service_account_id = google_service_account.release.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.environment/${var.environment}"
}

# A new revision runs as its service's account, so deploying one needs actAs on that account. The services themselves
# grant ustp-release run.developer (run.tf); pushing and attesting are granted with the image repository (storage.tf)
# and the attestor (binauthz.tf).
resource "google_service_account_iam_member" "release_act_as" {
  for_each = {
    api    = google_service_account.api.name
    worker = google_service_account.worker.name
  }

  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.release.member
}
