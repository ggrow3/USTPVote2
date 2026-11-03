import { z } from 'zod';

/**
 * Sign-in traffic and site analytics, for auditing and security (design §10.7). The sign-in log
 * is personal data: it never enters the public ledger, only System Admins and Auditors read it, and each record
 * expires after `SIGN_IN_RETENTION_DAYS`.
 */

/** How long a sign-in record is kept before Firestore's TTL deletes it. */
export const SIGN_IN_RETENTION_DAYS = 180;

/** The most a forwarded-address chain and a user agent may hold in a record; anything longer is cut. */
export const SIGN_IN_LIMITS = { forwardedFor: 10, userAgent: 300 } as const;

/**
 * `sign_ins/{uid}_{authTime}`: one sign-in, as the api first saw it. A sign-in is a new `auth_time` on an ID token:
 * signing in, or re-authenticating before an approval. Refreshing a token keeps its `auth_time` and adds nothing.
 */
export interface SignInRecord {
  readonly id: string;
  readonly uid: string;
  /**
   * The person's USTP account; null for a login that has no account yet (the first step of Register). Read back with
   * the account the login has by then.
   */
  readonly accountId: string | null;
  readonly email: string | null;
  /** `firebase.sign_in_provider`: `password`, `google.com`, `microsoft.com`, `apple.com`, `emailLink`. */
  readonly provider: string;
  /** Signed in with a second factor. */
  readonly mfa: boolean;
  /** When they signed in (`auth_time`), ISO 8601. */
  readonly signedInAt: string;
  /** When the api first saw that sign-in, ISO 8601. */
  readonly seenAt: string;
  /** The client's address as the proxies in front of the api reported it (`clientAddress`); null if none. */
  readonly ip: string | null;
  /** The whole X-Forwarded-For chain, left to right, so the address chosen can be checked. */
  readonly forwardedFor: readonly string[];
  readonly userAgent: string | null;
}

/** `GET /v1/admin/security/sign-ins`: the sign-ins seen in the last `days` days, newest first. */
export interface SignInLog {
  readonly days: number;
  readonly signIns: readonly SignInRecord[];
  /** More sign-ins happened in the period than `SIGN_IN_LOG_MAX` (the oldest are left out). */
  readonly truncated: boolean;
}

/** The periods the sign-in log can be read for, in days, and the most records one read returns. */
export const SIGN_IN_LOG_PERIODS = [1, 7, 30, 90, 180] as const;
export const SIGN_IN_LOG_MAX = 2000;

/**
 * The client's address from the request's X-Forwarded-For chain and the socket's peer. Each proxy appends the address
 * it received the request from, so the last `trustedHops` entries were written by the proxies in front of the api
 * (Firebase Hosting and Cloud Run's front end), the entry before them is the client's, and anything further left came
 * from the client itself and may be forged. With fewer entries than that, the first one is taken.
 */
export function clientAddress(
  forwardedFor: string | readonly string[] | undefined,
  peer: string | undefined,
  trustedHops: number,
): { readonly ip: string | null; readonly chain: readonly string[] } {
  const raw = typeof forwardedFor === 'string' ? forwardedFor : (forwardedFor ?? []).join(',');
  const chain = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(-SIGN_IN_LIMITS.forwardedFor);
  if (chain.length === 0) return { ip: peer ? stripMappedV4(peer) : null, chain };
  const index = chain.length - 1 - trustedHops;
  return { ip: stripMappedV4(chain[index >= 0 ? index : 0]!), chain };
}

/** `::ffff:203.0.113.5` is the IPv4 address 203.0.113.5. */
function stripMappedV4(address: string): string {
  return address.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
}

/** A short "Chrome on Windows" from a user agent, for the log's table; the whole string stays in the record. */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown';
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const system = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? 'Other';
}

// --- Site analytics (Google Analytics 4) -------------------------------------------------------------------------------

/** A Google Analytics 4 measurement ID, e.g. `G-ABC123XYZ9`. */
export const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,16}$/;

export interface SiteAnalytics {
  /** Null: no Google Analytics on the site (the default). */
  readonly measurementId: string | null;
}

/** `site_analytics/current`; version 0 (never saved) is the default, analytics off. */
export interface SiteAnalyticsRecord extends SiteAnalytics {
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

/** `GET /v1/site-analytics`: what every page needs to load Google Analytics, without who changed it. */
export type PublicSiteAnalytics = SiteAnalytics & { readonly version: number };

export const DEFAULT_SITE_ANALYTICS: SiteAnalytics = { measurementId: null };

/** `PUT /v1/admin/site-analytics`: the new setting, and the version it was edited from. */
export const siteAnalyticsSchema = z.object({
  basedOn: z.number().int().min(0),
  measurementId: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(MEASUREMENT_ID_PATTERN, 'a Google Analytics measurement ID looks like G-ABC123XYZ9'))
    .nullable(),
});
export type SiteAnalyticsInput = z.infer<typeof siteAnalyticsSchema>;

/** `analytics.changed`: the setting's new version and measurement ID (null: switched off). */
export interface SiteAnalyticsChangedPayload {
  readonly version: number;
  readonly measurementId: string | null;
}

/**
 * Pages Google Analytics never sees (design §10.7): the ballot and its receipts, checking a receipt, signing in, the
 * account emails' links (§4), the account page and the admin console. Analytics counts the public pages only.
 */
export const ANALYTICS_EXCLUDED_PATHS = ['/ballot', '/verify', '/signin', '/email-action', '/account', '/admin'] as const;

export function analyticsAllowed(path: string): boolean {
  return !ANALYTICS_EXCLUDED_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}
