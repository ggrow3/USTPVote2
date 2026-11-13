import { isReferralCode, landingFrom, REFERRAL_KEPT_DAYS, withoutLandingParams, type VisitFromInput } from 'ustp-domain';

/**
 * What the web app takes from the address someone arrives at (design §5.18, §10.7): a member's referral code, kept in
 * this browser until they apply (at most `REFERRAL_KEPT_DAYS`), and where the arrival came from, sent with the first
 * page of the tab as fields of their own, never the query. Both are then taken off the address, so a link copied or a
 * page reloaded is not counted again.
 */

const REFERRAL_KEY = 'ustp-referral';
const LANDED_KEY = 'ustp-landed';

interface Kept {
  readonly code: string;
  readonly at: string;
}

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null; // storage blocked
  }
}

/** Keeps a referral link's code; the newest link opened wins. */
export function keepReferral(code: unknown, now: Date = new Date()): void {
  if (!isReferralCode(code)) return;
  try {
    storage('local')?.setItem(REFERRAL_KEY, JSON.stringify({ code, at: now.toISOString() } satisfies Kept));
  } catch {
    // Full or blocked: the referral is not credited, nothing else changes.
  }
}

/** The kept code, while it is younger than `REFERRAL_KEPT_DAYS`; null otherwise. */
export function keptReferral(now: Date = new Date()): string | null {
  try {
    const raw = storage('local')?.getItem(REFERRAL_KEY);
    if (!raw) return null;
    const kept = JSON.parse(raw) as Partial<Kept>;
    const fresh = typeof kept.at === 'string' && now.getTime() - Date.parse(kept.at) < REFERRAL_KEPT_DAYS * 86_400_000;
    if (fresh && isReferralCode(kept.code)) return kept.code;
    forgetReferral();
    return null;
  } catch {
    return null;
  }
}

/** Forgets the kept code, once it went with an application. */
export function forgetReferral(): void {
  try {
    storage('local')?.removeItem(REFERRAL_KEY);
  } catch {
    // blocked
  }
}

/**
 * Where this tab's first page came from, once per tab (a reload keeps the tab's answer): null after the first time, or
 * where storage is blocked and it cannot be told.
 */
export function takeLanding(search: string, referrer: string, ownHost: string): VisitFromInput | null {
  const session = storage('session');
  if (!session) return null;
  try {
    if (session.getItem(LANDED_KEY)) return null;
    session.setItem(LANDED_KEY, '1');
  } catch {
    return null;
  }
  return landingFrom(search, referrer, ownHost);
}

export { withoutLandingParams };
