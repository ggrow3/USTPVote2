import type { PublicSiteAnalytics, SignInLog, SiteAnalyticsInput, SiteAnalyticsRecord } from 'ustp-domain';
import { api } from '../api.js';

/** The sign-ins of the last `days` days, newest first (System Admins and Auditors). */
export function signInLog(days: number): Promise<SignInLog> {
  return api<SignInLog>('GET', `/v1/admin/security/sign-ins?days=${days}`);
}

/** The site's Google Analytics setting, with who changed it last (System Admins). */
export function siteAnalyticsSettings(): Promise<SiteAnalyticsRecord> {
  return api<SiteAnalyticsRecord>('GET', '/v1/admin/site-analytics');
}

/** Saves the measurement ID (null switches analytics off); refused (409) if someone saved since version `basedOn`. */
export function saveSiteAnalytics(input: SiteAnalyticsInput): Promise<SiteAnalyticsRecord> {
  return api<SiteAnalyticsRecord>('PUT', '/v1/admin/site-analytics', input);
}

/** What every page needs to load Google Analytics, signed in or not. */
export function publicSiteAnalytics(): Promise<PublicSiteAnalytics> {
  return api<PublicSiteAnalytics>('GET', '/v1/site-analytics', undefined, { actAs: null });
}
