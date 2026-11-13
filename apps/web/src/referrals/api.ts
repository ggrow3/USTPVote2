import type { MyReferrals, ReferralLeaderboard, ReferralPeriod } from 'ustp-domain';
import { api } from '../api.js';

/** The referrals context's API (design §5.18, §12): the only place its routes are written. */

/** The caller's own referral link and how many joined by it and wait. */
export function myReferrals(): Promise<MyReferrals> {
  return api<MyReferrals>('GET', '/v1/me/referrals');
}

/** Teams ranked by the people their members brought in, over the last `days` days (0: all time). Active members. */
export function referralLeaderboard(days: ReferralPeriod): Promise<ReferralLeaderboard> {
  return api<ReferralLeaderboard>('GET', `/v1/referrals/leaderboard?days=${days}`);
}
