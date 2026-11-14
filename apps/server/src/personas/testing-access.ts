import { requireOwnAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';

/**
 * Who uses the testing tools (design §10.4): System and Site Admins (each route's @Roles), as themselves, never while
 * acting as a test persona (the Test Site Admin holds the Site Admin role). They need the second factor every admin
 * route needs, which the guard has checked: a Site Admin needs none while the Site Admins' setting is off, here as
 * everywhere (the user's decision, 2026-11-14, reversing "always with two-step" of the same day).
 */
export function requireTestingAccess(ctx: RequestContext): void {
  requireOwnAccount(ctx);
}
