import type {
  HomeQuoteInput,
  HomeQuoteRecord,
  NavigationRecord,
  NavigationSettingsInput,
  PublicHomeQuote,
  PublicNavigation,
} from 'ustp-domain';
import { api } from '../api.js';

/**
 * The governance context's API (design §10): what the web app shows each membership state and role, and the home
 * page quote (§10.5). The only place its routes are written.
 */

/** The settings every visitor's menu follows; no sign-in needed. */
export function navigation(): Promise<PublicNavigation> {
  return api<PublicNavigation>('GET', '/v1/navigation');
}

/** The quote on the home page; no sign-in needed. */
export function homeQuote(): Promise<PublicHomeQuote> {
  return api<PublicHomeQuote>('GET', '/v1/home-quote');
}

// --- System Admin ------------------------------------------------------------------------------------------------

/** The settings with who changed them last. */
export function navigationSettings(): Promise<NavigationRecord> {
  return api<NavigationRecord>('GET', '/v1/admin/navigation');
}

/** Saves the whole matrix; refused (409) if someone saved since version `basedOn`. */
export function saveNavigation(input: NavigationSettingsInput): Promise<NavigationRecord> {
  return api<NavigationRecord>('PUT', '/v1/admin/navigation', input);
}

/** The home page quote with who changed it last. */
export function homeQuoteSettings(): Promise<HomeQuoteRecord> {
  return api<HomeQuoteRecord>('GET', '/v1/admin/home-quote');
}

/** Saves the quote; refused (409) if someone saved since version `basedOn`. */
export function saveHomeQuote(input: HomeQuoteInput): Promise<HomeQuoteRecord> {
  return api<HomeQuoteRecord>('PUT', '/v1/admin/home-quote', input);
}
