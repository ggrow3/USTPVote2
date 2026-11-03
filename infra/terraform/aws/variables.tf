variable "region" {
  description = "The SES region, the same in each environment's ses_region."
  type        = string
  default     = "us-east-1"
}

variable "environments" {
  description = <<-EOT
    Each environment that sends email, with its own sender domain: an SES identity of its own, whose default
    configuration set is the environment's, so mail Identity Platform sends through SES reaches that environment's
    queue only. `from` is the From address's local part (design §6.8).
  EOT
  type = map(object({
    domain = string
    from   = optional(string, "noreply")
  }))
  default = {
    dev     = { domain = "dev.transhumanist-party.org" }
    staging = { domain = "staging.transhumanist-party.org" }
    prod    = { domain = "transhumanist-party.org" }
  }

  validation {
    condition     = alltrue([for name, _ in var.environments : contains(["dev", "staging", "prod"], name)])
    error_message = "Environments are named dev, staging or prod, as the Google projects' are."
  }
}

variable "dmarc_report_address" {
  description = "A mailbox USTP reads, for the DMARC aggregate reports the advised record asks for (rua); empty: none."
  type        = string
  default     = ""
}
