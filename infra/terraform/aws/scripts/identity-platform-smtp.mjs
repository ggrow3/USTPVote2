#!/usr/bin/env node
// Sends an environment's Identity Platform email (sign-in links, address confirmations, password resets) through Amazon
// SES's SMTP interface from the environment's own address, or back through Google's sender with --off (infra README
// "SES sign-in mail"). It reads the SMTP user's access key on standard input, derives the SES SMTP password from it, and
// sets Identity Platform's custom SMTP; the key and password are never printed or written to disk. Needs gcloud signed
// in as someone who may change Identity Platform's configuration (Identity Toolkit Admin).
//
//   aws iam create-access-key --user-name ustpvote-smtp-dev --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text \
//     | node infra/terraform/aws/scripts/identity-platform-smtp.mjs --project ustpvote2-dev --from noreply@dev.transhumanist-party.org
//
//   node infra/terraform/aws/scripts/identity-platform-smtp.mjs --project ustpvote2-dev --off
//
// Only once the email setup check passes for the environment: while SES's account is in the sandbox, sign-in links
// would reach nobody.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    from: { type: 'string' },
    region: { type: 'string', default: 'us-east-1' },
    off: { type: 'boolean', default: false },
  },
});
if (!values.project || (!values.off && !values.from)) {
  console.error('usage: identity-platform-smtp.mjs --project <Google project> (--from <address> [--region us-east-1] | --off)');
  process.exit(2);
}

/**
 * The SES SMTP password for an IAM secret access key in a region (AWS's version 4 algorithm): an HMAC-SHA256 chain over
 * a fixed date, the region, "ses", "aws4_request" and "SendRawEmail", prefixed with the version byte 4, in base64.
 */
function smtpPassword(secretAccessKey, region) {
  let key = Buffer.from(`AWS4${secretAccessKey}`, 'utf8');
  for (const part of ['11111111', region, 'ses', 'aws4_request', 'SendRawEmail']) key = createHmac('sha256', key).update(part, 'utf8').digest();
  return Buffer.concat([Buffer.from([0x04]), key]).toString('base64');
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim().split(/\s+/);
}

const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
const sendEmail = values.off
  ? { method: 'DEFAULT' }
  : await (async () => {
      const [username, secret] = await readStdin();
      if (!username || !secret) throw new Error('give the access key ID and secret access key on standard input');
      return {
        method: 'CUSTOM_SMTP',
        smtp: {
          senderEmail: values.from,
          host: `email-smtp.${values.region}.amazonaws.com`,
          port: 587,
          username,
          password: smtpPassword(secret, values.region),
          securityMode: 'START_TLS',
        },
      };
    })();
const mask = values.off ? 'notification.sendEmail.method' : 'notification.sendEmail.method,notification.sendEmail.smtp';
const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(values.project)}/config?updateMask=${mask}`;
const res = await fetch(url, {
  method: 'PATCH',
  headers: { authorization: `Bearer ${token}`, 'x-goog-user-project': values.project, 'content-type': 'application/json' },
  body: JSON.stringify({ notification: { sendEmail } }),
});
if (!res.ok) {
  console.error(`Identity Platform answered ${res.status}: ${(await res.text()).slice(0, 500)}`);
  process.exit(1);
}
console.log(
  values.off
    ? `${values.project}: Identity Platform sends its email through Google's sender again.`
    : `${values.project}: Identity Platform sends its email through SES from ${values.from}. Send yourself a sign-in link, then see it on your Account page.`,
);
