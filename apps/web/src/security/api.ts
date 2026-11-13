import type { PageVisitReport, PublicSiteAnalytics, SignInLog, SiteAnalyticsInput, SiteAnalyticsRecord, VisitFromInput } from 'ustp-domain';
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

/** Hits per page over the last `days` days, and who opened each page (System Admins and Auditors). */
export function pageVisitReport(days: number): Promise<PageVisitReport> {
  return api<PageVisitReport>('GET', `/v1/admin/page-visits?days=${days}`);
}

/**
 * Tells the api a page was opened (design §10.7): signed in, as the person themself even while acting as a test
 * persona; signed out, to be counted only. With the first page of a tab, where it came from (`from`), never the query.
 */
export function sendPageVisit(path: string, signedIn: boolean, from?: VisitFromInput | null): Promise<void> {
  return api<void>('POST', signedIn ? '/v1/page-visits' : '/v1/public/page-visits', { path, ...(from && { from }) }, { actAs: null });
}

/** What every page needs to load Google Analytics, signed in or not. */
export function publicSiteAnalytics(): Promise<PublicSiteAnalytics> {
  return api<PublicSiteAnalytics>('GET', '/v1/site-analytics', undefined, { actAs: null });
}
