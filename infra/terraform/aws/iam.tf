# Two IAM users per environment, without console access. Their access keys are made by hand (README "Email (Amazon
# SES)"), so no key is ever in this state.

# The worker's: send from the environment's address through its configuration set, read and delete its delivery
# reports, read the account, identity, configuration set and queues for the setup check, and take an address off SES's
# suppression list when its owner asks to try it again (design §6.8).
resource "aws_iam_user" "worker" {
  for_each = var.environments

  name = "ustpvote-worker-${each.key}"
  path = "/ustpvote/"
}

data "aws_iam_policy_document" "worker" {
  for_each = var.environments

  statement {
    sid     = "Send"
    actions = ["ses:SendEmail"]
    resources = [
      aws_sesv2_email_identity.domain[each.key].arn,
      aws_sesv2_configuration_set.mail[each.key].arn,
    ]
    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [local.from[each.key]]
    }
  }

  # SES has no resource for these.
  statement {
    sid       = "AccountAndSuppressionList"
    actions   = ["ses:GetAccount", "ses:GetSuppressedDestination", "ses:DeleteSuppressedDestination"]
    resources = ["*"]
  }

  statement {
    sid       = "ReadIdentity"
    actions   = ["ses:GetEmailIdentity"]
    resources = [aws_sesv2_email_identity.domain[each.key].arn]
  }

  statement {
    sid       = "ReadConfigurationSet"
    actions   = ["ses:GetConfigurationSet", "ses:GetConfigurationSetEventDestinations"]
    resources = [aws_sesv2_configuration_set.mail[each.key].arn]
  }

  statement {
    sid       = "ReadReports"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.events[each.key].arn]
  }

  statement {
    sid       = "WatchDeadLetters"
    actions   = ["sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.dead[each.key].arn]
  }
}

resource "aws_iam_user_policy" "worker" {
  for_each = var.environments

  name   = "ustpvote-worker"
  user   = aws_iam_user.worker[each.key].name
  policy = data.aws_iam_policy_document.worker[each.key].json
}

# Identity Platform's: its sign-in links, address confirmations and password resets go through SES's SMTP interface
# from the environment's address, and so through its default configuration set.
resource "aws_iam_user" "smtp" {
  for_each = var.environments

  name = "ustpvote-smtp-${each.key}"
  path = "/ustpvote/"
}

data "aws_iam_policy_document" "smtp" {
  for_each = var.environments

  statement {
    sid     = "SendThroughSmtp"
    actions = ["ses:SendRawEmail"]
    resources = [
      aws_sesv2_email_identity.domain[each.key].arn,
      aws_sesv2_configuration_set.mail[each.key].arn,
    ]
    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [local.from[each.key]]
    }
  }
}

resource "aws_iam_user_policy" "smtp" {
  for_each = var.environments

  name   = "ustpvote-smtp"
  user   = aws_iam_user.smtp[each.key].name
  policy = data.aws_iam_policy_document.smtp[each.key].json
}
