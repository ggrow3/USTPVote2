output "dns_records" {
  description = <<-EOT
    The records to publish wherever the party's domain is served, for each environment: three DKIM CNAMEs, the MAIL
    FROM domain's MX and SPF records, and an advised DMARC record (leave that out where the domain has one).
  EOT
  value = flatten([
    for env, cfg in var.environments : concat(
      [
        for token in aws_sesv2_email_identity.domain[env].dkim_signing_attributes[0].tokens : {
          env = env, purpose = "DKIM", type = "CNAME", name = "${token}._domainkey.${cfg.domain}", value = "${token}.dkim.amazonses.com"
        }
      ],
      [
        { env = env, purpose = "MAIL FROM", type = "MX", name = "mail.${cfg.domain}", value = "10 feedback-smtp.${var.region}.amazonses.com" },
        { env = env, purpose = "SPF", type = "TXT", name = "mail.${cfg.domain}", value = "v=spf1 include:amazonses.com ~all" },
        { env = env, purpose = "DMARC", type = "TXT", name = "_dmarc.${cfg.domain}", value = local.dmarc },
      ],
    )
  ])
}

output "mail_from" {
  description = "Each environment's From address, for its mail_from (with a display name, such as \"USTP Elections <...>\")."
  value       = local.from
}

output "configuration_sets" {
  description = "Each environment's configuration set, for its ses_configuration_set."
  value       = { for env, set in aws_sesv2_configuration_set.mail : env => set.configuration_set_name }
}

output "queue_urls" {
  description = "Each environment's delivery-report queue, for its ses_events_queue_url."
  value       = { for env, queue in aws_sqs_queue.events : env => queue.url }
}

output "worker_users" {
  description = "Each environment's worker IAM user, whose access key goes into its aws-ses-* secrets (scripts/worker-key.mjs)."
  value       = { for env, user in aws_iam_user.worker : env => user.name }
}

output "smtp_users" {
  description = "Each environment's Identity Platform SMTP user (scripts/identity-platform-smtp.mjs)."
  value       = { for env, user in aws_iam_user.smtp : env => user.name }
}

output "smtp_host" {
  description = "SES's SMTP endpoint in this region."
  value       = "email-smtp.${var.region}.amazonaws.com"
}
