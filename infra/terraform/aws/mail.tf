# Amazon SES for the app's email (design §6.8), one AWS account for every environment. Each environment has its own
# sender domain, configuration set, topic, queue and IAM users, so no environment sees another's delivery reports.

locals {
  from = { for env, cfg in var.environments : env => "${cfg.from}@${cfg.domain}" }

  # What the configuration set publishes: everything about delivery, never opens or clicks (no tracking image, links
  # straight to the site).
  event_types = ["SEND", "REJECT", "BOUNCE", "COMPLAINT", "DELIVERY", "DELIVERY_DELAY", "RENDERING_FAILURE"]

  dmarc = var.dmarc_report_address == "" ? "v=DMARC1; p=none" : "v=DMARC1; p=none; rua=mailto:${var.dmarc_report_address}"
}

# Addresses that bounced for good are not mailed again from any environment. Complaints are suppressed by the app
# instead, for the mail it sends: here they would also stop a member's sign-in links after one "mark as spam".
resource "aws_sesv2_account_suppression_attributes" "this" {
  suppressed_reasons = ["BOUNCE"]
}

resource "aws_sesv2_configuration_set" "mail" {
  for_each = var.environments

  configuration_set_name = "ustp-mail-${each.key}"

  reputation_options {
    reputation_metrics_enabled = true
  }

  sending_options {
    sending_enabled = true
  }

  suppression_options {
    suppressed_reasons = ["BOUNCE"]
  }

  # No engagement tracking: whether anyone opened or clicked is not recorded.
  vdm_options {
    dashboard_options {
      engagement_metrics = "DISABLED"
    }
    guardian_options {
      optimized_shared_delivery = "DISABLED"
    }
  }
}

# The sender domain, signed with Easy DKIM, bouncing to its own MAIL FROM domain so SPF aligns, and sending through the
# environment's configuration set by default: Identity Platform's SMTP mail cannot name one.
resource "aws_sesv2_email_identity" "domain" {
  for_each = var.environments

  email_identity         = each.value.domain
  configuration_set_name = aws_sesv2_configuration_set.mail[each.key].configuration_set_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  for_each = var.environments

  email_identity         = aws_sesv2_email_identity.domain[each.key].email_identity
  mail_from_domain       = "mail.${each.value.domain}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

# Delivery reports: configuration set → SNS topic → SQS queue, which only the environment's worker reads; nothing from
# outside calls the api. A report the worker cannot record after five tries goes to the dead-letter queue.
resource "aws_sns_topic" "events" {
  for_each = var.environments

  name = "ustp-mail-events-${each.key}"
}

data "aws_iam_policy_document" "topic" {
  for_each = var.environments

  statement {
    sid       = "SesPublishesReports"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.events[each.key].arn]

    principals {
      type        = "Service"
      identifiers = ["ses.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [data.aws_caller_identity.this.account_id]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_sesv2_configuration_set.mail[each.key].arn]
    }
  }
}

resource "aws_sns_topic_policy" "events" {
  for_each = var.environments

  arn    = aws_sns_topic.events[each.key].arn
  policy = data.aws_iam_policy_document.topic[each.key].json
}

resource "aws_sqs_queue" "dead" {
  for_each = var.environments

  name                      = "ustp-mail-events-${each.key}-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "events" {
  for_each = var.environments

  name                       = "ustp-mail-events-${each.key}"
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead[each.key].arn
    maxReceiveCount     = 5
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "dead" {
  for_each = var.environments

  queue_url = aws_sqs_queue.dead[each.key].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.events[each.key].arn]
  })
}

data "aws_iam_policy_document" "queue" {
  for_each = var.environments

  statement {
    sid       = "TopicDeliversReports"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.events[each.key].arn]

    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_sns_topic.events[each.key].arn]
    }
  }
}

resource "aws_sqs_queue_policy" "events" {
  for_each = var.environments

  queue_url = aws_sqs_queue.events[each.key].id
  policy    = data.aws_iam_policy_document.queue[each.key].json
}

resource "aws_sns_topic_subscription" "events" {
  for_each = var.environments

  topic_arn            = aws_sns_topic.events[each.key].arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.events[each.key].arn
  raw_message_delivery = true

  depends_on = [aws_sqs_queue_policy.events]
}

resource "aws_sesv2_configuration_set_event_destination" "events" {
  for_each = var.environments

  configuration_set_name = aws_sesv2_configuration_set.mail[each.key].configuration_set_name
  event_destination_name = "to-sqs"

  event_destination {
    # Off unless set: the provider's default.
    enabled              = true
    matching_event_types = local.event_types

    sns_destination {
      topic_arn = aws_sns_topic.events[each.key].arn
    }
  }

  depends_on = [aws_sns_topic_policy.events]
}
