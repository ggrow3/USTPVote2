import { createParamDecorator, ForbiddenException, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Role } from 'ustp-domain';
import type { RequestContext } from './principal.js';

declare module 'fastify' {
  interface FastifyRequest {
    ctx?: RequestContext;
  }
}

export const PUBLIC_KEY = 'ustp:public';
export const ROLES_KEY = 'ustp:roles';
export const CHECK_REVOKED_KEY = 'ustp:check-revoked';
export const APP_CHECKED_KEY = 'ustp:app-checked';

/** No sign-in required. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * On a public route, still require a valid App Check token where App Check is enforced, as signed-in routes do: for
 * routes anyone may write to (the suggestions form, design §10.7), so a script cannot post to them from anywhere.
 */
export const AppChecked = () => SetMetadata(APP_CHECKED_KEY, true);

/**
 * The caller must hold at least one of these roles. Also implies multi-factor sign-in and a revocation check on
 * the ID token (design §4).
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Also check that the ID token has not been revoked, as admin routes do (casting a ballot, design §7.1). */
export const CheckRevoked = () => SetMetadata(CHECK_REVOKED_KEY, true);

/** The authenticated caller. */
export const Ctx = createParamDecorator((_: unknown, host: ExecutionContext): RequestContext => {
  const ctx = host.switchToHttp().getRequest<FastifyRequest>().ctx;
  if (!ctx) throw new Error('Ctx used on a route without authentication');
  return ctx;
});

/** For routes about the caller's own logins: refused while a System Admin acts as a test persona (design §10.4). */
export function requireOwnAccount(ctx: RequestContext): void {
  if (ctx.operator) throw new ForbiddenException('stop acting as a test persona first');
}

/** The caller's accountId; 403 until they have created their account. */
export function requireAccount(ctx: RequestContext): string {
  if (!ctx.accountId) throw new ForbiddenException('create your account first (POST /v1/accounts)');
  return ctx.accountId;
}
