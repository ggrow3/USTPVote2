import { z } from 'zod';
import { deny, OK, type Check } from './check.js';

/**
 * The Anthropic API key the Claude checks use (design §5.6). A System Admin adds it in the app; the server keeps it as
 * the newest version of this Secret Manager secret, which Terraform creates empty, and nothing in the app reads it back.
 * Only the worker reads it, when it runs a check.
 */
export const ANTHROPIC_KEY_SECRET = 'anthropic-api-key';

/** How many of the key's last characters the app shows, so a System Admin can match it in Anthropic's Console. */
export const ANTHROPIC_KEY_HINT_CHARACTERS = 4;

/** `PUT /v1/admin/anthropic-key`. The key's shape is checked by `checkAnthropicKey`, so no message repeats it. */
export const anthropicKeySchema = z.object({ key: z.string().trim().min(1).max(500) }).strict();
export type AnthropicKeyInput = z.infer<typeof anthropicKeySchema>;

/**
 * Whether a pasted key looks like an Anthropic API key, before anything is sent anywhere: a mistaken paste (another
 * service's secret) must never reach Anthropic. An Admin API key manages the whole Anthropic organization and cannot
 * run a check, so it is refused too. Anthropic itself then says whether the key works (`AnthropicKeyTester`).
 */
export function checkAnthropicKey(key: string): Check {
  if (/\s/.test(key)) return deny('an API key has no spaces or line breaks: paste only the key');
  if (key.startsWith('sk-ant-admin')) {
    return deny('this is an Admin API key, which manages the whole Anthropic organization; add an ordinary API key instead');
  }
  if (!key.startsWith('sk-ant-')) return deny('Anthropic API keys start with "sk-ant-"; this does not look like one');
  if (key.length < 40) return deny('this is too short to be an Anthropic API key; copy all of it');
  return OK;
}

export function anthropicKeyHint(key: string): string {
  return key.slice(-ANTHROPIC_KEY_HINT_CHARACTERS);
}

/** How a check is switched in this deployment (`BYLAWS_CHECKER`, `CONSISTENCY_CHECKER`), which only its configuration changes. */
export type ClaudeCheckSwitch = 'claude' | 'stub' | 'off';

/** `anthropic_key/current`: who added the key in use through the app, and when. Never the key, which only Secret Manager holds. */
export interface AnthropicKeyRecord {
  /** The Secret Manager version it was added as, to tell it from a key added another way since. */
  readonly version: string;
  readonly hint: string;
  readonly addedAt: string;
  readonly addedBy: string;
  /** Their name (or email) when they added it, for the panel. */
  readonly addedByName: string;
}

/** `GET /v1/admin/anthropic-key`: whether a key is set and the switches, never the key. */
export interface AnthropicKeyStatus {
  readonly set: boolean;
  /** When the key in use was added, as Secret Manager has it. */
  readonly addedAt: string | null;
  /** Who added it in the app, and its last characters; both null for a key added outside the app (with gcloud, say). */
  readonly addedBy: { readonly accountId: string; readonly name: string } | null;
  readonly hint: string | null;
  readonly checks: { readonly bylaws: ClaudeCheckSwitch; readonly consistency: ClaudeCheckSwitch };
  /** Whether a key is tried with Anthropic before it is kept (always, except with the emulators). */
  readonly tried: boolean;
}

/** `anthropic_key.changed`: a key was added (replacing any before it) or removed. Never the key or its hint. */
export interface AnthropicKeyChangedPayload {
  readonly change: 'added' | 'removed';
}
