import type { AnthropicKeyStatus } from 'ustp-domain';
import { api } from '../api.js';

/** The Anthropic API key for the Claude checks (design §5.6). System Admins only; no route ever returns the key. */
const ROUTE = '/v1/admin/anthropic-key';

export function anthropicKeyStatus(): Promise<AnthropicKeyStatus> {
  return api<AnthropicKeyStatus>('GET', ROUTE);
}

/** Tries the key with Anthropic and keeps it in place of any before it; refused (422, 502) if Anthropic will not take it. */
export function addAnthropicKey(key: string): Promise<AnthropicKeyStatus> {
  return api<AnthropicKeyStatus>('PUT', ROUTE, { key });
}

export function removeAnthropicKey(): Promise<AnthropicKeyStatus> {
  return api<AnthropicKeyStatus>('DELETE', ROUTE);
}
