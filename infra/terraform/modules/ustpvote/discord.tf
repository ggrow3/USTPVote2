# The party's Discord bot (design §10.18): the app posts what happens on the site (news, votes, events, bills, courses)
# to the party's Discord server. This secret holds the bot's token. Terraform creates it but never its value: a System
# Admin adds the token in the app (Admin › API keys), which keeps it as the only live version, so the token stays out
# of Terraform state. The api may add and destroy versions but never read one (api_discord_token_versions); the worker
# reads the newest (worker_secret_accessor, iam.tf) each time it posts, so a token added or removed counts from the
# next tick without a restart.
#
# Nothing else is needed to run the bot: it is a step of the worker's tick, and posts only once a Communications Admin
# switches it on in the app (Admin › Communications › Discord). Until this is applied, the admin pages say the server
# cannot look at the secret yet.
resource "google_secret_manager_secret" "discord_bot_token" {
  project   = var.project_id
  secret_id = "discord-bot-token"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.this]
}

# The api keeps the token a System Admin pastes, after trying it with Discord, as the newest version and destroys the
# older ones. secretVersionManager adds, lists and destroys versions but has no secretmanager.versions.access, so the
# internet-facing api can never read a token back.
resource "google_secret_manager_secret_iam_member" "api_discord_token_versions" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.discord_bot_token.secret_id
  role      = "roles/secretmanager.secretVersionManager"
  member    = google_service_account.api.member
}
