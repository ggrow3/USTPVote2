import type { Provider } from '@nestjs/common';
import { ReferralRepository } from './referral.repository.js';
import { ReferralCodes, ReferralsService } from './referrals.js';

/**
 * Everything the referrals context provides, for the API module to register (design §3.3, §5.18). Membership injects
 * `ReferralCodes` to learn whose link an applicant came by; the repository is the context's own.
 */
export const REFERRALS_PROVIDERS: Provider[] = [ReferralRepository, ReferralCodes, ReferralsService];
