terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.71"
    }
  }

  # The prod project's state bucket (created by hand, README "Bringing an environment up"), under a prefix of its own.
  # This state holds no secret: the access keys and the SMTP password are made outside Terraform.
  backend "gcs" {
    bucket = "ustpvote2-prod-tfstate"
    prefix = "aws-mail"
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      app        = "ustpvote"
      managed-by = "terraform"
    }
  }
}

data "aws_caller_identity" "this" {}
