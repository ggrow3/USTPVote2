# Sign-in and App Check (design §4, §14). Creating the Identity Platform config upgrades the project's Firebase
# Authentication to Identity Platform, which cannot be undone. Set outside Terraform (README "Identity Platform"):
# the password policy, which this provider cannot set, and the Google, Microsoft and Apple providers, whose OAuth
# clients are registered with those companies.

locals {
  # localhost only outside production: local web builds can then sign in against dev and staging.
  web_domains = concat(
    ["${var.project_id}.web.app", "${var.project_id}.firebaseapp.com"],
    var.environment == "prod" ? [] : ["localhost"],
  )
}

resource "google_identity_platform_config" "this" {
  project            = var.project_id
  authorized_domains = local.web_domains

  sign_in {
    allow_duplicate_emails = false

    # Password or email link (passwordless): passwordRequired = false allows both.
    email {
      enabled           = true
      password_required = false
    }

    # The api refuses phone and anonymous tokens anyway.
    phone_number {
      enabled = false
    }
    anonymous {
      enabled = false
    }
  }

  # Authenticator-app (TOTP) second factors for admins; SMS stays off (no enabled_providers).
  mfa {
    state = "ENABLED"

    provider_configs {
      state = "ENABLED"

      totp_provider_config {
        adjacent_intervals = 5
      }
    }
  }

  # Every request to Identity Platform (sign-ups, sign-ins, failed attempts, password resets) with the caller's
  # address, in Cloud Logging; kept in the sign-in-traffic bucket (logging.tf, design §10.7).
  monitoring {
    request_logging {
      enabled = true
    }
  }

  depends_on = [google_project_service.this]
}

# App Check's attestation provider for the web app (VITE_RECAPTCHA_ENTERPRISE_SITE_KEY).
resource "google_recaptcha_enterprise_key" "web" {
  project      = var.project_id
  display_name = "USTPVote web (App Check)"
  labels       = local.labels

  web_settings {
    integration_type  = "SCORE"
    allow_amp_traffic = false
    allowed_domains   = local.web_domains
  }

  depends_on = [google_project_service.this]
}

# Registered once the Firebase web app exists (firebase_web_app_id). The api enforces App Check itself, so console
# enforcement is not needed (README "App Check and the web build").
resource "google_firebase_app_check_recaptcha_enterprise_config" "web" {
  count = var.firebase_web_app_id == null ? 0 : 1

  project  = var.project_id
  app_id   = var.firebase_web_app_id
  site_key = google_recaptcha_enterprise_key.web.name
}
