#!/usr/bin/env node
// Gives an environment's worker a new Amazon SES access key (infra README "SES worker key"): creates one for its IAM
// user with the AWS CLI, and adds it on standard input as the newest version of the aws-ses-* secrets in its Google
// project. The secret key is never printed, logged or written to disk. Run with an AWS login that may create the user's
// keys and a gcloud login that may add secret versions:
//
//   node infra/terraform/aws/scripts/worker-key.mjs --env dev --project ustpvote2-dev
//
// Then roll the worker so it reads the new versions, and delete the old key (`aws iam list-access-keys`).
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { env: { type: 'string' }, project: { type: 'string' } } });
if (!['dev', 'staging', 'prod'].includes(values.env ?? '') || !values.project) {
  console.error('usage: node worker-key.mjs --env <dev|staging|prod> --project <Google project ID>');
  process.exit(2);
}

/** Runs a CLI, handing it `input` on standard input; its errors go to the terminal, its output comes back. */
function run(command, args, input) {
  const out = spawnSync(command, args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
    // The AWS CLI and gcloud are .cmd files on Windows. Nothing secret is in the arguments.
    shell: process.platform === 'win32',
  });
  if (out.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(' ')} failed (exit ${out.status})`);
  return out.stdout;
}

const user = `ustpvote-worker-${values.env}`;
const { AccessKey: key } = JSON.parse(run('aws', ['iam', 'create-access-key', '--user-name', user, '--output', 'json']));
for (const [secret, value] of [
  ['aws-ses-access-key-id', key.AccessKeyId],
  ['aws-ses-secret-access-key', key.SecretAccessKey],
]) {
  run('gcloud', ['secrets', 'versions', 'add', secret, '--project', values.project, '--data-file=-'], value);
}
console.log(`${user}'s new access key ${key.AccessKeyId} is the latest version of both aws-ses-* secrets in ${values.project}.`);
console.log('Roll the worker so it reads them, then delete the old key in IAM.');
