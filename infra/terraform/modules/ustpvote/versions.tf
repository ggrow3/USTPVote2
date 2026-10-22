terraform {
  # 1.9+ for validations that refer to other variables (environment-dependent switches).
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 8.0, < 9.0"
    }
  }
}
