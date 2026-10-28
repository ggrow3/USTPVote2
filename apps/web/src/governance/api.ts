import type {
  ClickTarget,
  DiscordLive,
  HomeQuoteInput,
  HomeQuoteRecord,
  Hub,
  HubClickCount,
  HubRecord,
  NavigationRecord,
  NavigationSettingsInput,
  PublicHomeQuote,
  PublicHub,
  PublicNavigation,
} from 'ustp-domain';
import { api, apiUpload } from '../api.js';

/**
 * The governance context's API (design §10): what the web app shows each membership state and role, the home page
 * quote (§10.5) and the home page hub (§10.6). The only place its routes are written.
 */

/** The settings every visitor's menu follows; no sign-in needed. */
export function navigation(): Promise<PublicNavigation> {
  return api<PublicNavigation>('GET', '/v1/navigation');
}

/** The quote on the home page; no sign-in needed. */
export function homeQuote(): Promise<PublicHomeQuote> {
  return api<PublicHomeQuote>('GET', '/v1/home-quote');
}

/** The hub as visitors see it; no sign-in needed. */
export function hub(): Promise<PublicHub> {
  return api<PublicHub>('GET', '/v1/hub');
}

/** How many are online in the party's Discord server, as the API last read it from Discord. */
export function discordLive(): Promise<DiscordLive> {
  return api<DiscordLive>('GET', '/v1/hub/discord');
}

/** Where an uploaded logo is served; its ID never changes, so browsers keep it. */
export function hubLogoUrl(logo: string): string {
  return `/v1/hub/logo/${logo}`;
}

/**
 * Counts a click on the hub: no sign-in and no body, only what was clicked. `keepalive` lets it finish while the page
 * goes to the link; a failure is ignored, as a missed count must never stop anyone following a link.
 */
export function countHubClick(target: ClickTarget): void {
  void fetch(`/v1/hub/clicks/${encodeURIComponent(target)}`, { method: 'POST', keepalive: true }).catch(() => undefined);
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

/** The hub with who changed it last, hidden and unfinished links included. */
export function hubSettings(): Promise<HubRecord> {
  return api<HubRecord>('GET', '/v1/admin/hub');
}

/** Saves the whole hub; refused (409) if someone saved since version `basedOn`. */
export function saveHub(input: Hub & { readonly basedOn: number }): Promise<HubRecord> {
  return api<HubRecord>('PUT', '/v1/admin/hub', input);
}

/** Uploads a logo; it shows once the hub is saved with the ID this gives. */
export function uploadHubLogo(file: Blob): Promise<{ logo: string }> {
  return apiUpload<{ logo: string }>('/v1/admin/hub/logo', file);
}

/** How often each link, icon and the Discord button were followed: in total and in the last 30 days. */
export function hubClicks(): Promise<HubClickCount[]> {
  return api<HubClickCount[]>('GET', '/v1/admin/hub/clicks');
}
