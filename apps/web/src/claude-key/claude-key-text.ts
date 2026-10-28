import type { AnthropicKeyStatus, ClaudeCheckSwitch } from 'ustp-domain';

export type ClaudeCheck = keyof AnthropicKeyStatus['checks'];

export const CHECK_NAMES: Readonly<Record<ClaudeCheck, string>> = {
  bylaws: 'Bylaws check',
  consistency: 'Platform consistency check',
  election: 'Election setup check',
};

/** The Terraform setting that switches each check on, for whoever runs the deployment. */
const SWITCHES: Readonly<Record<ClaudeCheck, string>> = {
  bylaws: 'bylaws_check_enabled',
  consistency: 'consistency_check_enabled',
  election: 'election_check_enabled',
};

export const INTRO =
  "The bylaws check, the platform consistency check and the election setup check send texts to Claude, Anthropic's AI " +
  "model, with the party's Anthropic API key. The key is kept in Google Secret Manager, and once it is saved nobody can " +
  "see it here, System Admins included: only its last four characters are shown, to match it with the keys in " +
  "Anthropic's Console.";

const day = (iso: string, locale?: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

/** Whether a key is set and, for one added here, which and by whom. */
export function keyStatusText(status: AnthropicKeyStatus, locale?: string): string {
  if (!status.set) return 'No key is set, so no Claude check can run.';
  const added = status.addedAt ? ` on ${day(status.addedAt, locale)}` : '';
  if (!status.addedBy) return `A key is set. It was added${added} outside this app, so who added it is not known here.`;
  return `A key is set. It ends in ${status.hint} and was added${added} by ${status.addedBy.name}.`;
}

/** Where one check stands: on and ready, waiting for a key, the stand-in, or off in the deployment's settings. */
export function switchText(check: ClaudeCheck, sw: ClaudeCheckSwitch, set: boolean): string {
  if (sw === 'claude') return set ? 'On: it runs with this key.' : 'On, but it cannot run until a key is added.';
  if (sw === 'stub') return 'Runs a stand-in for local testing, which does not use the key.';
  return `Off in this deployment's settings (${SWITCHES[check]} in Terraform). A key added here is used once it is switched on.`;
}

export function triedText(tried: boolean): string {
  return tried
    ? 'A key is tried with Anthropic before it is saved, and one Anthropic does not accept is not kept.'
    : 'With the emulators a key is saved without being tried with Anthropic.';
}

export function savedAnnouncement(status: AnthropicKeyStatus): string {
  return status.hint ? `Key saved. It ends in ${status.hint}.` : 'Key saved.';
}

export const REMOVE_CONFIRM =
  'The Claude checks stop until a System Admin adds a key again, and checks waiting to run will fail. The key stays ' +
  "valid at Anthropic: to revoke it, delete it in Anthropic's Console too.";

/** A server or domain reason ("anthropic did not accept…") as the sentence under the field. */
export function asSentence(reason: string): string {
  const text = reason.charAt(0).toUpperCase() + reason.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
