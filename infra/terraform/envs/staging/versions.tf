terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.8"
    }
  }

  # Created by hand once per environment (README "Bringing an environment up").
  backend "gcs" {
    bucket = "ustpvote2-staging-tfstate"
    prefix = "terraform"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
