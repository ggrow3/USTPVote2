# Service accounts and their project-level roles (design §1 "Least privilege per service", §14). Rights on one key,
# bucket, queue or service are granted next to that resource. Account IDs need at least 6 characters, hence `ustp-`.

resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = "ustp-api"
  display_name = "USTPVote api"
  description  = "Cloud Run api: client-facing. Cannot sign, cannot decrypt ballots (design §7.3, §8.3)."
  depends_on   = [google_project_service.this]
}

resource "google_service_account" "worker" {
  project      = var.project_id
  account_id   = "ustp-worker"
  display_name = "USTPVote worker"
  description  = "Cloud Run worker: election clock, sealing, ledger signing, anchoring (design §13)."
  depends_on   = [google_project_service.this]
}

resource "google_service_account" "invoker" {
  project      = var.project_id
  account_id   = "ustp-worker-invoker"
  display_name = "USTPVote worker invoker"
  description  = "Identity of Cloud Scheduler and Cloud Tasks calls to the worker; its only right is invoking it (design §13)."
  depends_on   = [google_project_service.this]
}

# --- Firestore: both services, nobody else in production (design §11, §14) -------------------------------------------

resource "google_project_iam_member" "firestore" {
  for_each = local.service_members

  project = var.project_id
  role    = "roles/datastore.user"
  member  = each.value
}

# --- api ---------------------------------------------------------------------------------------------------------------

# verifyIdToken(token, checkRevoked) on admin routes and casting looks the user up in Identity Platform (design §4).
resource "google_project_iam_member" "api_auth_viewer" {
  project = var.project_id
  role    = "roles/firebaseauth.viewer"
  member  = google_service_account.api.member
}

# Deleting an account on the deployment's deletion list deletes its logins from Identity Platform first (design §4).
# roles/firebaseauth.admin would also let it create and change users and read the password hash config.
resource "google_project_iam_custom_role" "login_deleter" {
  project     = var.project_id
  role_id     = "ustpLoginDeleter"
  title       = "USTPVote login deleter"
  description = "Delete Identity Platform users; the api deletes only the logins of an account it deletes (design §4)."
  permissions = ["firebaseauth.users.delete"]
  depends_on  = [google_project_service.this]
}

resource "google_project_iam_member" "api_login_deleter" {
  project = var.project_id
  role    = google_project_iam_custom_role.login_deleter.name
  member  = google_service_account.api.member
}

# Tie-break seeds (design §6.1): the api creates one secret per scheduling attempt and adds the seed as its version.
# No predefined role holds only secrets.create; it creates an empty secret and reveals nothing.
resource "google_project_iam_custom_role" "secret_creator" {
  project     = var.project_id
  role_id     = "ustpSecretCreator"
  title       = "USTPVote secret creator"
  description = "Create (empty) secrets; adding and reading versions is granted separately (design §6.1)."
  permissions = ["secretmanager.secrets.create"]
  depends_on  = [google_project_service.this]
}

resource "google_project_iam_member" "api_secret_creator" {
  project = var.project_id
  role    = google_project_iam_custom_role.secret_creator.name
  member  = google_service_account.api.member
}

# Adding versions, only to tie-break seed secrets. The api never reads a seed back: the worker reveals it at tally.
resource "google_project_iam_member" "api_seed_versions" {
  project = var.project_id
  role    = "roles/secretmanager.secretVersionAdder"
  member  = google_service_account.api.member

  condition {
    title       = "tie-break seeds only"
    description = "Secrets named ${local.tiebreak_seed_prefix}* (design §6.1)"
    expression  = "resource.name.startsWith(\"projects/${data.google_project.this.number}/secrets/${local.tiebreak_seed_prefix}\")"
  }
}

# Deleting a deleted election's seed (design §6.1), only tie-break seeds. No predefined role holds secrets.delete
# without secrets management. Adding versions already lets the api spoil a seed, so this widens nothing.
resource "google_project_iam_custom_role" "secret_deleter" {
  project     = var.project_id
  role_id     = "ustpSecretDeleter"
  title       = "USTPVote secret deleter"
  description = "Delete secrets; granted only for tie-break seeds, which go with a deleted election (design §6.1)."
  permissions = ["secretmanager.secrets.delete"]
  depends_on  = [google_project_service.this]
}

resource "google_project_iam_member" "api_seed_deleter" {
  project = var.project_id
  role    = google_project_iam_custom_role.secret_deleter.name
  member  = google_service_account.api.member

  condition {
    title       = "tie-break seeds only"
    description = "Secrets named ${local.tiebreak_seed_prefix}* (design §6.1)"
    expression  = "resource.name.startsWith(\"projects/${data.google_project.this.number}/secrets/${local.tiebreak_seed_prefix}\")"
  }
}

# --- worker ------------------------------------------------------------------------------------------------------------

# Reads tie-break seeds when tallying (design §9, §13) and, later, the email provider's credentials.
# The email setup check reads how Identity Platform sends its email (design §10.12). No predefined role holds only this:
# firebaseauth.viewer would also let the worker read every user.
resource "google_project_iam_custom_role" "auth_config_viewer" {
  project     = var.project_id
  role_id     = "ustpAuthConfigViewer"
  title       = "USTPVote Identity Platform configuration viewer"
  description = "Read Identity Platform's configuration, not its users (design §10.12)."
  permissions = ["firebaseauth.configs.get"]
  depends_on  = [google_project_service.this]
}

resource "google_project_iam_member" "worker_auth_config_viewer" {
  project = var.project_id
  role    = google_project_iam_custom_role.auth_config_viewer.name
  member  = google_service_account.worker.member
}

# The welcome email to a member a Membership Admin added carries Identity Platform's email sign-in link for their
# address (design §5.13): the worker asks for it as it sends (generateSignInWithEmailLink, accounts:sendOobCode with
# returnOobLink). No predefined role holds only this; firebaseauth.admin would also let it change and delete users.
resource "google_project_iam_custom_role" "sign_in_link_maker" {
  project     = var.project_id
  role_id     = "ustpSignInLinkMaker"
  title       = "USTPVote sign-in link maker"
  description = "Make Identity Platform's email links; the worker makes only added members' welcome sign-in links (design §5.13)."
  permissions = ["firebaseauth.users.sendEmail"]
  depends_on  = [google_project_service.this]
}

resource "google_project_iam_member" "worker_sign_in_link_maker" {
  project = var.project_id
  role    = google_project_iam_custom_role.sign_in_link_maker.name
  member  = google_service_account.worker.member
}

resource "google_project_iam_member" "worker_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = google_service_account.worker.member
}

# --- People (design §14) -----------------------------------------------------------------------------------------------
# Operators can see services, logs (including KMS Data Access logs), metrics, schedules, key metadata and IAM, but not
# Firestore documents or any key's cryptographic use. Basic roles (Viewer, Editor, Owner) include Firestore data access,
# so in production no person should hold them standing.

locals {
  operator_roles = toset([
    "roles/cloudkms.viewer",
    "roles/cloudscheduler.viewer",
    "roles/iam.securityReviewer",
    "roles/logging.privateLogViewer",
    "roles/monitoring.viewer",
    "roles/run.viewer",
  ])
}

resource "google_project_iam_member" "operators" {
  for_each = {
    for pair in setproduct(toset(var.operator_members), local.operator_roles) : "${pair[0]} ${pair[1]}" => {
      member = pair[0]
      role   = pair[1]
    }
  }

  project = var.project_id
  role    = each.value.role
  member  = each.value.member
}

resource "google_project_iam_member" "developer_data" {
  for_each = toset(var.developer_data_members)

  project = var.project_id
  role    = "roles/datastore.user"
  member  = each.value
}
