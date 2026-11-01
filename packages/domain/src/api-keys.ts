import { z } from 'zod';
import { ANTHROPIC_KEY_HINT_CHARACTERS } from './anthropic-key.js';
import { deny, OK, type Check } from './check.js';

/**
 * The keys of the public-records services the Candidates and Your area pages ask (design §5.6, §5.12), which a System
 * Admin may add under Admin › API keys beside the Anthropic API key. Each is optional: without one, the deployment's
 * own key is used (set in Terraform), and without that the service is left out (the FEC falls back to its shared
 * DEMO_KEY, which allows few lookups an hour).
 */
export const API_KEY_NAMES = ['fec', 'openstates', 'civic'] as const;
export type ApiKeyName = (typeof API_KEY_NAMES)[number];

/**
 * The Secret Manager secret holding the key added in the app, which Terraform creates empty (`api_keys.tf`). Apart from
 * the deployment's own (`FEC_API_KEY`, `OPENSTATES_API_KEY`, and `google-civic-api-key`, which Terraform makes), so
 * removing a key added here goes back to the deployment's.
 */
export const API_KEY_SECRETS: Readonly<Record<ApiKeyName, string>> = {
  fec: 'app-fec-api-key',
  openstates: 'app-openstates-api-key',
  civic: 'app-civic-api-key',
};

export const apiKeyNameSchema = z.enum(API_KEY_NAMES);

/** `PUT /v1/admin/api-keys/{name}`. The key's shape is checked by `checkApiKey`, so no message repeats it. */
export const apiKeySchema = z.object({ key: z.string().trim().min(1).max(500) }).strict();
export type ApiKeyInput = z.infer<typeof apiKeySchema>;

/** Each service's key as it hands them out: an api.data.gov key, an Open States key (a UUID), a Google API key. */
const SHAPES: Readonly<Record<ApiKeyName, { readonly pattern: RegExp; readonly says: string }>> = {
  fec: { pattern: /^[A-Za-z0-9]{40}$/, says: 'api.data.gov keys are 40 letters and digits' },
  openstates: { pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, says: 'Open States keys look like 1b2c3d4e-0000-…, 36 characters' },
  civic: { pattern: /^AIza[0-9A-Za-z_-]{35}$/, says: 'Google API keys start with "AIza" and are 39 characters' },
};

/**
 * Whether a pasted key looks like one of that service's, before anything is sent anywhere: a key pasted into the wrong
 * card (the Anthropic key, another service's) must never reach that service. The service itself then says whether the
 * key works (`ApiKeyTester`).
 */
export function checkApiKey(name: ApiKeyName, key: string): Check {
  if (/\s/.test(key)) return deny('an API key has no spaces or line breaks: paste only the key');
  if (key.startsWith('sk-ant-')) return deny('this is an Anthropic API key, which goes in the Anthropic API key card');
  if (name === 'fec' && key === 'DEMO_KEY') return deny('this is the FEC’s shared demo key, which is used anyway when no key is set: add your own api.data.gov key');
  const shape = SHAPES[name];
  return shape.pattern.test(key) ? OK : deny(`this does not look like the right key: ${shape.says}`);
}

export function apiKeyHint(key: string): string {
  return key.slice(-ANTHROPIC_KEY_HINT_CHARACTERS);
}

/** `api_keys/{name}`: who added the key in use through the app, and when. Never the key, which only Secret Manager holds. */
export interface ApiKeyRecord {
  /** The Secret Manager version it was added as, to tell it from a key added another way since. */
  readonly version: string;
  readonly hint: string;
  readonly addedAt: string;
  readonly addedBy: string;
  /** Their name (or email) when they added it, for the panel. */
  readonly addedByName: string;
}

/** Where the key in use comes from: added in the app, the deployment's own (Terraform), or none. */
export type ApiKeySource = 'app' | 'deployment' | 'none';

/** One service's key, as `GET /v1/admin/api-keys` gives it: never the key. */
export interface ApiKeyStatus {
  readonly name: ApiKeyName;
  readonly source: ApiKeySource;
  /** When the key added in the app was added, as Secret Manager has it. */
  readonly addedAt: string | null;
  /** Who added it in the app, and its last characters; both null for a key added outside the app (with gcloud, say). */
  readonly addedBy: { readonly accountId: string; readonly name: string } | null;
  readonly hint: string | null;
  /** Whether the deployment has a key of its own, which is used again once the one added here is removed. */
  readonly deploymentKey: boolean;
}

export interface ApiKeysStatus {
  readonly keys: readonly ApiKeyStatus[];
  /** Whether a key is tried with its service before it is kept (always, except with the emulators). */
  readonly tried: boolean;
}

/** `api_key.changed`: which service's key was added (replacing any before it) or removed. Never the key or its hint. */
export interface ApiKeyChangedPayload {
  readonly key: ApiKeyName;
  readonly change: 'added' | 'removed';
}
