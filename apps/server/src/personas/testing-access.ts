import { ForbiddenException } from '@nestjs/common';
import { PROBLEM_TYPES } from 'ustp-domain';
import { requireOwnAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';

/**
 * Who uses the testing tools (design §10.4): System and Site Admins (each route's @Roles), as themselves, never while
 * acting as a test persona (the Test Site Admin holds the Site Admin role), and always signed in with a second factor,
 * even a Site Admin whom the Site Admins' setting lets use their other tools without one (the user's decision,
 * 2026-11-14): personas can approve elections, so whoever makes or drives them has two-step.
 */
export function requireTestingAccess(ctx: RequestContext): void {
  requireOwnAccount(ctx);
  if (ctx.secondFactorWaived) {
    throw new ForbiddenException({ message: 'the testing tools require two-step verification', type: PROBLEM_TYPES.mfaRequired });
  }
}
