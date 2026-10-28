import type { AccountPreferences, AccountPreferencesInput } from 'ustp-domain';
import { api } from '../api.js';

/** The caller's own display choices, such as the daily quote and joke (design §4.1). `GET /v1/me` returns them. */
export function savePreferences(input: AccountPreferencesInput): Promise<AccountPreferences> {
  return api<AccountPreferences>('PUT', '/v1/me/preferences', input);
}
